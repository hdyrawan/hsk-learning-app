import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, syncConfigured } from "./supabaseClient";
import { mergeGame, gameSig, isEmptyGame, emptyGame } from "./gamification";
import {
  mergeProgressMaps,
  mergeCustomWords,
  mergeSettings,
  progressDiffers,
  progressRecordToRow,
  localWordToRow,
  settingsToRow,
  rowResetAt,
  chunk,
} from "./syncCore";

/* Optional cross-device sync.
 *
 * Rules that keep this safe to bolt onto a local-first app:
 *   - Signed out, nothing here runs. The app is unchanged.
 *   - Signing in MERGES; it never replaces local data outright. The one
 *     exception is switching to a DIFFERENT account, where the user is asked.
 *   - Writes are debounced and only send rows that actually changed.
 *   - Progress conflicts resolve per card on lastReviewed, so a device that has
 *     been offline cannot roll back the other device's study.
 *   - Settings resolve on when they were last changed, never "this device wins".
 *   - "Reset progress" is a timestamp; anything reviewed before it is dropped
 *     on every device, so a reset is not undone by the next pull.
 *   - A device never uploads until it has pulled at least once this session.
 *   - The gamification log (XP, achievements) merges per field and never goes
 *     through the settings last-write-wins; see gamification.js mergeGame.
 *
 * Everything the async code needs is read through refs, so callbacks are never
 * stale and none of them depend on React state identity.
 */

const PAGE = 1000;
const PUSH_BATCH = 500;
const DELETE_BATCH = 100;
const DEBOUNCE_MS = 2500;
const RETRY_MS = 15000;
const PULL_EVERY_MS = 30000;

const OWNER_KEY = "hsk-sync-owner";          // account whose data is in this browser
const RESET_KEY = "hsk-progress-reset-at";   // last "reset all progress"
const SETTINGS_AT_KEY = "hsk-settings-at";   // last time a synced setting changed
const META_KEY = "hsk-sync-meta";

function readStr(key) { try { return localStorage.getItem(key) || ""; } catch { return ""; } }
function writeStr(key, v) { try { localStorage.setItem(key, v); } catch { /* ignore */ } }
function readNum(key) { return Number(readStr(key)) || 0; }
function writeNum(key, n) { writeStr(key, String(n)); }

async function selectAll(table, userId, orderCol) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

function wordChanged(a, b) {
  if (!a) return true;
  return a.updatedAt !== b.updatedAt
    || a.hanzi !== b.hanzi
    || a.pinyin !== b.pinyin
    || a.meaning !== b.meaning
    || a.partOfSpeech !== b.partOfSpeech
    || a.exampleHanzi !== b.exampleHanzi
    || a.examplePinyin !== b.examplePinyin
    || a.exampleEnglish !== b.exampleEnglish;
}

function settingsFrom(st) {
  return {
    darkMode: st.darkMode,
    reverseMode: st.reverseMode,
    levels: st.levels,
    goal: st.goal,
    streak: st.streak,
    bestScores: st.bestScores,
  };
}
const settingsSig = (s) => JSON.stringify([s.darkMode, s.reverseMode, s.levels, s.goal, s.streak, s.bestScores]);

/** Upload exactly what it is given. Pure I/O; reads no hook state. */
async function pushRows(userId, o) {
  const { progress, words, progressIds, wordIds, deletedWords, dropProgressIds, settings, reset, game } = o;

  const progRows = progressIds.filter((id) => progress[id]).map((id) => progressRecordToRow(userId, id, progress[id]));
  for (const batch of chunk(progRows, PUSH_BATCH)) {
    const { error } = await supabase.from("card_progress").upsert(batch, { onConflict: "user_id,card_id" });
    if (error) throw error;
  }

  // Progress rows of deleted custom words must not linger on the server.
  const dropIds = [...new Set([...deletedWords.map((w) => String(w.id)), ...dropProgressIds])];
  for (const batch of chunk(dropIds, DELETE_BATCH)) {
    const { error } = await supabase.from("card_progress").delete().eq("user_id", userId).in("card_id", batch);
    if (error) throw error;
  }

  const wordRows = wordIds.map((id) => words.get(String(id))).filter(Boolean).map((w) => localWordToRow(userId, w));
  const tombRows = deletedWords.map((w) => localWordToRow(userId, w, true));
  for (const batch of chunk([...wordRows, ...tombRows], PUSH_BATCH)) {
    const { error } = await supabase.from("custom_words").upsert(batch, { onConflict: "user_id,id" });
    if (error) throw error;
  }

  // A reset: drop every server row at or before it, and record when.
  if (reset) {
    const { error } = await supabase.from("card_progress").delete()
      .eq("user_id", userId).lte("last_reviewed", reset);
    if (error) throw error;
    if (!settings) {
      // Only the reset marker changed; leave the stored settings untouched.
      const { error: e2 } = await supabase.from("user_settings")
        .update({ progress_reset_at: reset }).eq("user_id", userId);
      if (e2) throw e2;
    }
  }

  if (settings) {
    const { error } = await supabase.from("user_settings").upsert(
      settingsToRow(userId, settings.values, settings.at, settings.resetAt),
      { onConflict: "user_id" }
    );
    if (error) throw error;
  }

  // Last, so the settings row is guaranteed to exist.
  if (game) {
    const { error } = await supabase.from("user_settings").update({ game }).eq("user_id", userId);
    if (error) throw error;
  }
}

export function useSync(state) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | syncing | synced | error
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [lastError, setLastError] = useState("");

  const st = useRef(state);
  st.current = state;
  const userId = session?.user?.id || null;
  const sessionRef = useRef(null);
  sessionRef.current = session;

  const snapshot = useRef({ progress: {}, words: new Map() }); // what the server is known to have
  const syncedUser = useRef(null);       // user this session has pulled for
  const activeUserId = useRef(null);
  const busy = useRef(false);
  const pending = useRef(false);         // a push was requested while busy
  const timer = useRef(null);
  const lastPull = useRef(0);
  const fn = useRef({});

  const resetAt = useRef(readNum(RESET_KEY));
  const resetDelivered = useRef(0);      // resetAt the server is known to have
  const settingsAt = useRef(readNum(SETTINGS_AT_KEY));
  const settingsDelivered = useRef(0);
  const sigRef = useRef(null);
  const gameDelivered = useRef("");      // signature of the game log the server has

  const setSettingsAt = (at) => { settingsAt.current = at; writeNum(SETTINGS_AT_KEY, at); };

  const scheduleSync = useCallback((delay = DEBOUNCE_MS) => {
    clearTimeout(timer.current);                     // always, even when signed out
    if (!supabase || !sessionRef.current || !st.current.ready) return;
    timer.current = setTimeout(() => fn.current.pushChanges(), delay);
  }, []);

  const finishRun = useCallback((failed) => {
    busy.current = false;
    if (failed) scheduleSync(RETRY_MS);
    else if (pending.current) scheduleSync(300);
    pending.current = false;
  }, [scheduleSync]);

  /* Full pull, merge, then upload anything the server is missing or has stale. */
  const fullSync = useCallback(async ({ silent = false } = {}) => {
    const sess = sessionRef.current;
    if (!supabase || !sess || busy.current) return;
    busy.current = true;
    if (!silent) setStatus("syncing");
    setLastError("");
    let failed = false;
    try {
      const uid = sess.user.id;
      const [progressRows, wordRows, settingsRes] = await Promise.all([
        selectAll("card_progress", uid, "card_id"),
        selectAll("custom_words", uid, "id"),
        supabase.from("user_settings").select("*").eq("user_id", uid).maybeSingle(),
      ]);
      if (settingsRes.error) throw settingsRes.error;
      const remoteSettings = settingsRes.data;

      // Read local state only now, after the awaits, so study done while the
      // request was in flight is part of the merge instead of being overwritten.
      const cur = st.current;
      let local = {
        progress: cur.progress,
        words: cur.customWords,
        deleted: cur.deletedCustomWords,
        settingsAt: settingsAt.current,
        resetAt: resetAt.current,
        game: cur.game,
      };

      // Local data belongs to another account: ask before mixing the two.
      const owner = readStr(OWNER_KEY);
      if (owner && owner !== uid) {
        const hasData = Object.keys(local.progress).length > 0 || local.words.length > 0;
        const startFresh = !hasData || window.confirm(
          "This device still holds study data from a different account.\n\n" +
          "OK: start fresh with this account's data (the other account keeps its own copy in the cloud).\n" +
          "Cancel: merge this device's data into this account."
        );
        if (startFresh) {
          local = { progress: {}, words: [], deleted: [], settingsAt: 0, resetAt: 0, game: emptyGame() };
          cur.setProgress({});
          cur.setCustomWords([]);
          cur.setDeletedCustomWords([]);
          cur.setGame(emptyGame());
        }
      }

      const remoteReset = rowResetAt(remoteSettings);
      const effectiveReset = Math.max(local.resetAt, remoteReset);

      const w = mergeCustomWords(local.words, wordRows, local.deleted.map((x) => x.id));
      const p = mergeProgressMaps(local.progress, progressRows, {
        resetAt: effectiveReset,
        excludeIds: w.deletedIds,
      });
      const s = mergeSettings(settingsFrom(cur), local.settingsAt, remoteSettings);

      const remoteGame = remoteSettings?.game || null;
      const mergedGame = mergeGame(local.game, remoteGame);
      const pushGame = !isEmptyGame(mergedGame) && gameSig(mergedGame) !== gameSig(remoteGame);

      // Server-side leftovers: progress of words deleted on another device.
      const remoteProgressIds = new Set(progressRows.map((r) => String(r.card_id)));
      const dropProgressIds = w.deletedIds.filter((id) => remoteProgressIds.has(String(id)));

      // Re-merge against the live state when applying, in case a card was
      // answered between reading it above and this update.
      cur.setProgress((now) => mergeProgressMaps(now, progressRows, {
        resetAt: effectiveReset,
        excludeIds: w.deletedIds,
      }).merged);
      cur.setCustomWords(w.merged);
      cur.setGame((now) => mergeGame(now, mergedGame));
      if (s.adopted) {
        sigRef.current = settingsSig(s.settings);   // adopting is not a local change
        cur.setDarkMode(s.settings.darkMode);
        cur.setReverseMode(s.settings.reverseMode);
        cur.setLevels(s.settings.levels);
        cur.setGoal(s.settings.goal);
        if (s.settings.streak) cur.setStreak(s.settings.streak);
        if (s.settings.bestScores) cur.setBestScores(s.settings.bestScores);
      }
      resetAt.current = effectiveReset;
      writeNum(RESET_KEY, effectiveReset);
      setSettingsAt(s.at);

      const resetPending = effectiveReset > remoteReset;
      const sentDeleted = local.deleted;
      await pushRows(uid, {
        progress: p.merged,
        words: new Map(w.merged.map((x) => [String(x.id), x])),
        progressIds: p.pushIds,
        wordIds: w.pushIds,
        deletedWords: sentDeleted,
        dropProgressIds,
        settings: s.push ? { values: s.settings, at: s.at, resetAt: effectiveReset } : null,
        reset: resetPending ? effectiveReset : 0,
        game: pushGame ? mergedGame : null,
      });

      if (sentDeleted.length) {
        const sent = new Set(sentDeleted.map((x) => x.id));
        cur.setDeletedCustomWords((prev) => prev.filter((x) => !sent.has(x.id)));
      }

      snapshot.current = {
        progress: { ...p.merged },
        words: new Map(w.merged.map((x) => [String(x.id), { ...x }])),
      };
      resetDelivered.current = effectiveReset;
      gameDelivered.current = gameSig(mergedGame);
      settingsDelivered.current = s.at;
      syncedUser.current = uid;
      writeStr(OWNER_KEY, uid);
      writeStr(META_KEY, JSON.stringify({ userId: uid, lastSyncAt: Date.now() }));
      lastPull.current = Date.now();
      setLastSyncAt(Date.now());
      setStatus("synced");
    } catch (e) {
      failed = true;
      setLastError(String((e && e.message) || e));
      setStatus("error");
    } finally {
      finishRun(failed);
    }
  }, [finishRun]);

  /* Incremental upload: only rows that differ from what the server is known to have. */
  const pushChanges = useCallback(async () => {
    const sess = sessionRef.current;
    if (!supabase || !sess) return;
    if (busy.current) { pending.current = true; return; }
    // Never upload before this session has pulled: a blind upload could roll
    // back newer data from another device.
    if (syncedUser.current !== sess.user.id) { fn.current.fullSync({ silent: true }); return; }

    const cur = st.current;
    const prev = snapshot.current;

    const changedProgress = Object.keys(cur.progress).filter((id) => progressDiffers(prev.progress[id], cur.progress[id]));
    const changedWords = cur.customWords
      .filter((w) => wordChanged(prev.words.get(String(w.id)), w))
      .map((w) => String(w.id));
    const deletedWords = cur.deletedCustomWords;
    const resetPending = resetAt.current > resetDelivered.current;
    const settingsPending = settingsAt.current > settingsDelivered.current;
    const gameNow = cur.game;
    const gameSigNow = gameSig(gameNow);
    const gamePending = !isEmptyGame(gameNow) && gameSigNow !== gameDelivered.current;

    if (!changedProgress.length && !changedWords.length && !deletedWords.length
        && !resetPending && !settingsPending && !gamePending) return;

    busy.current = true;
    setStatus("syncing");
    setLastError("");
    let failed = false;
    try {
      const uid = sess.user.id;
      const progressNow = { ...cur.progress };
      const wordsNow = new Map(cur.customWords.map((w) => [String(w.id), { ...w }]));
      const at = settingsAt.current;
      const reset = resetAt.current;

      await pushRows(uid, {
        progress: progressNow,
        words: wordsNow,
        progressIds: changedProgress,
        wordIds: changedWords,
        deletedWords,
        dropProgressIds: [],
        settings: settingsPending ? { values: settingsFrom(cur), at, resetAt: reset } : null,
        reset: resetPending ? reset : 0,
        game: gamePending ? gameNow : null,
      });

      // Record only what was actually sent; anything changed mid-request is
      // still different from the snapshot and goes out on the next run.
      const nextProgress = { ...prev.progress };
      for (const id of changedProgress) nextProgress[id] = progressNow[id];
      const nextWords = new Map(prev.words);
      for (const id of changedWords) nextWords.set(id, wordsNow.get(id));
      snapshot.current = { progress: nextProgress, words: nextWords };

      if (deletedWords.length) {
        const sent = new Set(deletedWords.map((x) => x.id));
        cur.setDeletedCustomWords((p) => p.filter((x) => !sent.has(x.id)));
      }
      if (gamePending) gameDelivered.current = gameSigNow;
      if (resetPending || settingsPending) {
        resetDelivered.current = reset;
        settingsDelivered.current = at;
      }
      writeStr(META_KEY, JSON.stringify({ userId: uid, lastSyncAt: Date.now() }));
      setLastSyncAt(Date.now());
      setStatus("synced");
    } catch (e) {
      failed = true;
      setLastError(String((e && e.message) || e));
      setStatus("error");
    } finally {
      finishRun(failed);
    }
  }, [finishRun]);

  fn.current = { fullSync, pushChanges };

  /* --- session lifecycle --- */
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSession(data.session ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  /* --- first sync after sign-in --- */
  useEffect(() => {
    if (!supabase || !userId || !state.ready) return;
    if (activeUserId.current === userId) return;
    activeUserId.current = userId;
    fn.current.fullSync();
  }, [userId, state.ready]);

  /* --- track when a synced setting last changed (drives settings merge) --- */
  const sig = settingsSig(settingsFrom(state));
  useEffect(() => {
    if (sigRef.current === null) { sigRef.current = sig; return; }
    if (sigRef.current !== sig) { sigRef.current = sig; setSettingsAt(Date.now()); }
  }, [sig]);

  /* --- push local changes in the background --- */
  useEffect(() => {
    scheduleSync();
  }, [state.progress, state.customWords, state.deletedCustomWords, state.game, sig, userId, scheduleSync]);

  /* --- stay fresh: pull when the tab returns, retry when the network does --- */
  useEffect(() => {
    if (!supabase) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !sessionRef.current) return;
      if (Date.now() - lastPull.current > PULL_EVERY_MS) fn.current.fullSync({ silent: true });
    };
    const onOnline = () => scheduleSync(500);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [scheduleSync]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const signIn = useCallback(async (email) => {
    if (!supabase) return "Sync is not configured.";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return error ? error.message : null;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    clearTimeout(timer.current);
    // Best effort: get unsent changes to the server while the token is valid.
    try { await fn.current.pushChanges(); } catch { /* ignore */ }
    for (let i = 0; i < 20 && busy.current; i++) await new Promise((r) => setTimeout(r, 100));
    clearTimeout(timer.current);
    await supabase.auth.signOut();
    activeUserId.current = null;
    syncedUser.current = null;
    pending.current = false;
    writeStr(META_KEY, "{}");
    setLastSyncAt(0);
    setLastError("");
    setStatus("idle");
  }, []);

  /* "Reset all progress": clears locally and records WHEN, so the reset also
   * reaches the server and other devices instead of being pulled back. */
  const resetProgress = useCallback(() => {
    const at = Date.now();
    resetAt.current = at;
    writeNum(RESET_KEY, at);
    st.current.setProgress({});
    snapshot.current = { ...snapshot.current, progress: {} };
    scheduleSync(300);
  }, [scheduleSync]);

  return {
    available: syncConfigured,
    session,
    email: session?.user?.email || "",
    status,
    lastSyncAt,
    lastError,
    signIn,
    signOut,
    resetProgress,
    syncNow: () => fn.current.fullSync(),
  };
}
