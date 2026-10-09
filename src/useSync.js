import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, syncConfigured } from "./supabaseClient";
import {
  mergeProgressMaps,
  mergeCustomWords,
  mergeSettings,
  progressRecordToRow,
  localWordToRow,
  settingsToRow,
  chunk,
} from "./syncCore";

/* Optional cross-device sync.
 *
 * Rules that keep this safe to bolt onto a local-first app:
 *   - Signed out, nothing here runs. The app is unchanged.
 *   - Signing in MERGES; it never replaces local data outright.
 *   - Writes are debounced and only send rows that actually changed.
 *   - Progress conflicts resolve per card on lastReviewed, so a device that has
 *     been offline cannot roll back the other device's study.
 */

const PAGE = 1000;
const PUSH_BATCH = 500;
const DEBOUNCE_MS = 2500;
const SYNC_META_KEY = "hsk-sync-meta";

function readSyncMeta() {
  try { return JSON.parse(localStorage.getItem(SYNC_META_KEY) || "{}"); } catch { return {}; }
}
function writeSyncMeta(meta) {
  try { localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
}

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

export function useSync(state) {
  const {
    progress, setProgress,
    customWords, setCustomWords,
    deletedCustomWords, setDeletedCustomWords,
    darkMode, setDarkMode,
    reverseMode, setReverseMode,
    levels, setLevels,
    goal, setGoal,
    ready = true,
  } = state;

  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | syncing | synced | error
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [lastError, setLastError] = useState("");

  // Debounced handlers read through this so they never act on stale state.
  const live = useRef({});
  live.current = {
    progress, customWords, deletedCustomWords,
    darkMode, reverseMode, levels, goal,
  };

  const snapshot = useRef({ progress: {}, customWords: [] });
  const activeUserId = useRef(null);
  const busy = useRef(false);
  const timer = useRef(null);

  const pushRows = useCallback(async (userId, progressIds, wordIds, deletedWords, pushSettings) => {
    if (progressIds.length) {
      const rows = progressIds.map((id) =>
        progressRecordToRow(userId, id, live.current.progress[id]));
      for (const batch of chunk(rows, PUSH_BATCH)) {
        const { error } = await supabase.from("card_progress")
          .upsert(batch, { onConflict: "user_id,card_id" });
        if (error) throw error;
      }
    }

    const byId = new Map(live.current.customWords.map((w) => [String(w.id), w]));
    const wordRows = wordIds.map((id) => localWordToRow(userId, byId.get(String(id)))).filter(Boolean);
    const tombRows = deletedWords.map((w) => localWordToRow(userId, w, true));
    for (const batch of chunk([...wordRows, ...tombRows], PUSH_BATCH)) {
      const { error } = await supabase.from("custom_words")
        .upsert(batch, { onConflict: "user_id,id" });
      if (error) throw error;
    }

    if (pushSettings) {
      const { error } = await supabase.from("user_settings").upsert(
        settingsToRow(userId, {
          darkMode: live.current.darkMode,
          reverseMode: live.current.reverseMode,
          levels: live.current.levels,
          goal: live.current.goal,
        }),
        { onConflict: "user_id" }
      );
      if (error) throw error;
    }
  }, []);

  const takeSnapshot = useCallback(() => {
    snapshot.current = {
      progress: { ...live.current.progress },
      customWords: live.current.customWords.map((w) => ({ ...w })),
    };
  }, []);

  /** Full pull, merge, then upload anything the server is missing or has stale. */
  const fullSync = useCallback(async ({ silent = false } = {}) => {
    if (!supabase || !session || busy.current) return;
    busy.current = true;
    if (!silent) setStatus("syncing");
    setLastError("");
    try {
      const userId = session.user.id;
      const [progressRows, wordRows, settingsRes] = await Promise.all([
        selectAll("card_progress", userId, "card_id"),
        selectAll("custom_words", userId, "id"),
        supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
      ]);
      if (settingsRes.error) throw settingsRes.error;

      // First sync of this account on this device adopts the account settings;
      // afterwards this device is authoritative.
      const adoptRemoteSettings = readSyncMeta().userId !== userId;

      const p = mergeProgressMaps(live.current.progress, progressRows);
      const w = mergeCustomWords(
        live.current.customWords,
        wordRows,
        live.current.deletedCustomWords.map((x) => x.id)
      );
      const s = mergeSettings(
        {
          darkMode: live.current.darkMode,
          reverseMode: live.current.reverseMode,
          levels: live.current.levels,
          goal: live.current.goal,
        },
        settingsRes.data,
        adoptRemoteSettings
      );

      setProgress(p.merged);
      setCustomWords(w.merged);
      if (adoptRemoteSettings && settingsRes.data) {
        setDarkMode(s.settings.darkMode);
        setReverseMode(s.settings.reverseMode);
        setLevels(s.settings.levels);
        setGoal(s.settings.goal);
      }

      await pushRows(userId, p.pushIds, w.pushIds, live.current.deletedCustomWords, s.push);

      // Tombstones have been delivered; the server now owns those deletions.
      if (live.current.deletedCustomWords.length) setDeletedCustomWords([]);

      snapshot.current = {
        progress: { ...p.merged },
        customWords: w.merged.map((x) => ({ ...x })),
      };
      writeSyncMeta({ userId, lastSyncAt: Date.now() });
      setLastSyncAt(Date.now());
      setStatus("synced");
    } catch (e) {
      setLastError(String((e && e.message) || e));
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }, [session, setProgress, setCustomWords, setDeletedCustomWords,
      setDarkMode, setReverseMode, setLevels, setGoal, pushRows]);

  /** Incremental upload: only rows that differ from the last snapshot. */
  const pushChanges = useCallback(async () => {
    if (!supabase || !session || busy.current) return;
    busy.current = true;
    setStatus("syncing");
    setLastError("");
    try {
      const userId = session.user.id;
      const prev = snapshot.current;

      const changedProgress = [];
      for (const [id, rec] of Object.entries(live.current.progress)) {
        const before = prev.progress[id];
        if (!before || before.lastReviewed !== rec.lastReviewed) changedProgress.push(id);
      }

      const prevWords = new Map(prev.customWords.map((w) => [String(w.id), w]));
      const changedWords = live.current.customWords
        .filter((w) => wordChanged(prevWords.get(String(w.id)), w))
        .map((w) => String(w.id));

      await pushRows(userId, changedProgress, changedWords, live.current.deletedCustomWords, true);
      if (live.current.deletedCustomWords.length) setDeletedCustomWords([]);

      takeSnapshot();
      writeSyncMeta({ userId, lastSyncAt: Date.now() });
      setLastSyncAt(Date.now());
      setStatus("synced");
    } catch (e) {
      setLastError(String((e && e.message) || e));
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }, [session, pushRows, setDeletedCustomWords, takeSnapshot]);

  const scheduleSync = useCallback(() => {
    if (!supabase || !session || !ready) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { pushChanges(); }, DEBOUNCE_MS);
  }, [session, pushChanges, ready]);

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
    if (!supabase || !session || !ready) return;
    if (activeUserId.current === session.user.id) return;
    activeUserId.current = session.user.id;
    fullSync();
  }, [session, fullSync, ready]);

  /* --- push local changes in the background --- */
  useEffect(() => {
    scheduleSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, customWords, deletedCustomWords, darkMode, reverseMode, levels, goal, session]);

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
    await supabase.auth.signOut();
    activeUserId.current = null;
    writeSyncMeta({});
    setLastSyncAt(0);
    setStatus("idle");
  }, []);

  return {
    available: syncConfigured,
    session,
    email: session?.user?.email || "",
    status,
    lastSyncAt,
    lastError,
    signIn,
    signOut,
    syncNow: () => fullSync(),
  };
}
