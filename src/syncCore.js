/* Pure sync logic: record mapping and merge rules.
 *
 * Deliberately dependency-free and side-effect-free so it can be unit tested
 * outside the browser (scripts/test_sync_merge.js). No Supabase import here.
 *
 * Merge model:
 *   progress     per card, last write wins on lastReviewed
 *   custom words union by id, newer updatedAt wins, tombstones respected
 *   settings     first sync on a device adopts the account's settings
 */

export const CUSTOM_PREFIX = "custom-";

/* ---------- progress: local record <-> database row ---------- */

export function rowToProgressRecord(row) {
  return {
    level: Number(row.level) || 0,
    ease: typeof row.ease === "number" ? row.ease : Number(row.ease) || 2.5,
    interval: Number(row.interval_days) || 0,
    reps: Number(row.reps) || 0,
    lapses: Number(row.lapses) || 0,
    nextReview: Number(row.next_review) || 0,
    lastReviewed: Number(row.last_reviewed) || 0,
    correctCount: Number(row.correct_count) || 0,
    incorrectCount: Number(row.incorrect_count) || 0,
  };
}

export function progressRecordToRow(userId, cardId, s) {
  return {
    user_id: userId,
    card_id: String(cardId),
    level: s.level || 0,
    ease: typeof s.ease === "number" ? s.ease : 2.5,
    interval_days: s.interval || 0,
    reps: s.reps || 0,
    lapses: s.lapses || 0,
    next_review: s.nextReview || 0,
    last_reviewed: s.lastReviewed || 0,
    correct_count: s.correctCount || 0,
    incorrect_count: s.incorrectCount || 0,
    client_updated_at: new Date(s.lastReviewed || Date.now()).toISOString(),
  };
}

/** True when two local progress records differ in anything worth uploading. */
export function progressDiffers(a, b) {
  if (!a || !b) return true;
  return a.lastReviewed !== b.lastReviewed
    || a.level !== b.level
    || a.nextReview !== b.nextReview
    || a.reps !== b.reps
    || a.lapses !== b.lapses
    || a.correctCount !== b.correctCount
    || a.incorrectCount !== b.incorrectCount;
}

/**
 * Merge a local progress map with rows from the server.
 * Returns the merged map plus the card ids whose merged record is newer than
 * the server copy, i.e. the only rows that need uploading.
 *
 * opts.resetAt    a "reset all progress" happened at this time; any record last
 *                 reviewed at or before it is discarded on both sides.
 * opts.excludeIds cards that must not come back (deleted custom words).
 */
export function mergeProgressMaps(localMap = {}, remoteRows = [], opts = {}) {
  const resetAt = opts.resetAt || 0;
  const exclude = new Set((opts.excludeIds || []).map(String));
  const alive = (rec) => rec && (!resetAt || (rec.lastReviewed || 0) > resetAt);

  const remoteById = new Map();
  for (const row of remoteRows) {
    const id = String(row.card_id);
    const rec = rowToProgressRecord(row);
    if (!exclude.has(id) && alive(rec)) remoteById.set(id, rec);
  }

  const merged = {};
  const pushIds = [];
  const localIds = Object.keys(localMap).filter((id) => !exclude.has(id) && alive(localMap[id]));
  const localSet = new Set(localIds);
  const ids = new Set([...localIds, ...remoteById.keys()]);

  for (const id of ids) {
    const local = localSet.has(id) ? localMap[id] : undefined;
    const remote = remoteById.get(id);
    const localTs = local ? local.lastReviewed || 0 : -1;
    const remoteTs = remote ? remote.lastReviewed || 0 : -1;

    let winner;
    if (!remote) winner = local;
    else if (!local) winner = remote;
    else winner = remoteTs > localTs ? remote : local;

    merged[id] = winner;
    if (!remote || (winner.lastReviewed || 0) > remoteTs) pushIds.push(id);
  }

  return { merged, pushIds };
}

/* ---------- custom words: local word <-> database row ---------- */

export function rowToLocalWord(row) {
  const w = {
    id: String(row.id),
    hanzi: row.hanzi || "",
    pinyin: row.pinyin || "",
    meaning: row.meaning || "",
    partOfSpeech: row.part_of_speech || "noun",
    source: "custom",
    level: "custom",
    updatedAt: row.client_updated_at ? Date.parse(row.client_updated_at) || 0 : 0,
  };
  if (row.example_hanzi) w.exampleHanzi = row.example_hanzi;
  if (row.example_pinyin) w.examplePinyin = row.example_pinyin;
  if (row.example_english) w.exampleEnglish = row.example_english;
  return w;
}

export function localWordToRow(userId, w, deleted = false) {
  const row = {
    user_id: userId,
    id: String(w.id),
    hanzi: w.hanzi || "",
    pinyin: w.pinyin || "",
    meaning: w.meaning || "",
    part_of_speech: w.partOfSpeech || null,
    example_hanzi: w.exampleHanzi || null,
    example_pinyin: w.examplePinyin || null,
    example_english: w.exampleEnglish || null,
    deleted,
    client_updated_at: new Date(w.updatedAt || Date.now()).toISOString(),
  };
  return row;
}

/**
 * Merge a local custom-word list with rows from the server.
 * Tombstones are ids this device has deleted; they must never be resurrected
 * by a stale server row, and the server has to be told about them.
 */
export function mergeCustomWords(localList = [], remoteRows = [], tombstones = []) {
  const deleted = new Set(tombstones.map(String));
  const remoteById = new Map();

  for (const row of remoteRows) {
    const id = String(row.id);
    // a soft-deleted row on any device is authoritative
    if (row.deleted) { deleted.add(id); continue; }
    remoteById.set(id, rowToLocalWord(row));
  }

  const localById = new Map(localList.map((w) => [String(w.id), w]));
  const merged = [];
  const pushIds = [];

  for (const [id, remoteWord] of remoteById) {
    if (deleted.has(id)) continue;
    const localWord = localById.get(id);
    if (!localWord) { merged.push(remoteWord); continue; }

    const localTs = localWord.updatedAt || 0;
    const remoteTs = remoteWord.updatedAt || 0;
    if (remoteTs > localTs) {
      merged.push(remoteWord);
    } else {
      merged.push(localWord);
      if (localTs > remoteTs) pushIds.push(id);
    }
  }

  for (const localWord of localList) {
    const id = String(localWord.id);
    if (deleted.has(id) || remoteById.has(id)) continue;
    merged.push(localWord);
    pushIds.push(id);
  }

  return { merged, pushIds, deletedIds: [...deleted] };
}

/* ---------- settings ---------- */

export const DEFAULT_LEVELS = [3];

export function settingsToRow(userId, settings, updatedAt, resetAt = 0) {
  const { darkMode, reverseMode, levels, goal, streak, bestScores } = settings;
  return {
    user_id: userId,
    dark_mode: !!darkMode,
    reverse_mode: !!reverseMode,
    levels,
    goal,
    streak: streak || null,
    best_scores: bestScores || null,
    progress_reset_at: resetAt || 0,
    client_updated_at: new Date(updatedAt || Date.now()).toISOString(),
  };
}

/** Fields the row lacks (older rows) fall back to the local value. */
export function rowToSettings(row, fallback = {}) {
  const streak = row.streak && typeof row.streak.count === "number" ? row.streak : fallback.streak;
  const bestScores = row.best_scores && typeof row.best_scores === "object" ? row.best_scores : fallback.bestScores;
  return {
    darkMode: !!row.dark_mode,
    reverseMode: !!row.reverse_mode,
    levels: Array.isArray(row.levels) ? row.levels : DEFAULT_LEVELS,
    goal: Number(row.goal) || 20,
    streak,
    bestScores,
  };
}

export function rowResetAt(row) {
  return row ? Number(row.progress_reset_at) || 0 : 0;
}

export function rowSettingsAt(row) {
  return row && row.client_updated_at ? Date.parse(row.client_updated_at) || 0 : 0;
}

/**
 * Settings are last-write-wins on the time they were last changed. A device
 * that has never changed a setting (localAt 0) adopts the account's, and a
 * stale device can no longer overwrite settings changed elsewhere.
 *
 * Returns { settings, at, push, adopted }.
 */
export function mergeSettings(local, localAt, remoteRow) {
  if (!remoteRow) return { settings: local, at: localAt || Date.now(), push: true, adopted: false };
  const remoteAt = rowSettingsAt(remoteRow);
  if (remoteAt > (localAt || 0)) {
    return { settings: rowToSettings(remoteRow, local), at: remoteAt, push: false, adopted: true };
  }
  return { settings: local, at: localAt || 0, push: (localAt || 0) > remoteAt, adopted: false };
}

/** Split an array into batches, for chunked upserts. */
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
