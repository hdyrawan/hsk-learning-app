/* Pure gamification logic: XP, player level, daily activity log, achievements.
 *
 * Dependency-free so it can be unit tested outside the browser
 * (scripts/test_gamification.js), like syncCore.js.
 *
 * Data model (one object, synced as a jsonb column):
 *   {
 *     v: 1,
 *     days: { "2026-10-10": { "<deviceId>": { r, c, n, x, e, p, f, g } } },
 *     achievements: { "<id>": unlockedAtMs },
 *     base: { xp, reviews, correct, newCards } | null
 *   }
 *
 * Day counters are PER DEVICE and only ever grow, so merging two copies takes
 * the max per (day, device, field) and totals sum across devices. Two phones
 * studying on the same day add up instead of one overwriting the other.
 *
 *   r reviews   c correct   n new cards   x xp   e exams   p exams passed
 *   f perfect exams   g daily goal reached (flag)
 *
 * Deleting progress ("Reset all progress") does not touch this log: XP and
 * achievements are history, not study state.
 */

export const XP = { again: 0, hard: 2, good: 5, easy: 7, newCard: 10, mastered: 25, goalDay: 30, exam: 50 };

const COUNTERS = ["r", "c", "n", "x", "e", "p", "f"];
const FLAGS = ["g"];

export function emptyGame() {
  return { v: 1, days: {}, achievements: {}, base: null };
}

export function normalizeGame(g) {
  if (!g || typeof g !== "object") return emptyGame();
  return {
    v: 1,
    days: g.days && typeof g.days === "object" ? g.days : {},
    achievements: g.achievements && typeof g.achievements === "object" ? g.achievements : {},
    base: g.base && typeof g.base === "object" ? g.base : null,
  };
}

export function isEmptyGame(g) {
  const n = normalizeGame(g);
  return !Object.keys(n.days).length && !Object.keys(n.achievements).length && !n.base;
}

/* ---------- XP for one answer ---------- */

/** What one card answer is worth. `prev`/`next` are progress records. */
export function answerEvent(prev, next, mode) {
  const seen = (prev?.correctCount || 0) + (prev?.incorrectCount || 0);
  const isNew = seen === 0;
  let xp = XP[mode] ?? 0;
  if (isNew) xp += XP.newCard;
  if ((prev?.level || 0) < 3 && next?.level === 3) xp += XP.mastered;
  return { r: 1, c: mode === "again" ? 0 : 1, n: isNew ? 1 : 0, x: xp };
}

/** What a finished exam is worth: up to XP.exam, scaled by the score. */
export function examEvent(grade) {
  const max = grade.maxScore || 0;
  const ratio = max > 0 ? Math.max(0, Math.min(1, grade.score / max)) : 0;
  return { e: 1, p: grade.passed ? 1 : 0, f: max > 0 && grade.score >= max ? 1 : 0, x: Math.round(XP.exam * ratio) };
}

/* ---------- the day log ---------- */

function sumField(day, key) {
  let t = 0;
  for (const dev of Object.values(day || {})) t += dev[key] || 0;
  return t;
}
const dayHasGoal = (day) => Object.values(day || {}).some((d) => d.g);

/** Add an event to this device's entry for `date`. Marks the daily goal once. */
export function recordActivity(game, deviceId, date, delta, goal = 0) {
  const g = normalizeGame(game);
  const day = { ...(g.days[date] || {}) };
  const entry = { ...(day[deviceId] || {}) };
  for (const k of Object.keys(delta)) entry[k] = (entry[k] || 0) + delta[k];
  day[deviceId] = entry;
  if (goal > 0 && !dayHasGoal(day) && sumField(day, "r") >= goal) entry.g = 1;
  return { ...g, days: { ...g.days, [date]: day } };
}

export function dayTotals(game, date) {
  const day = normalizeGame(game).days[date];
  const out = {};
  for (const k of COUNTERS) out[k] = sumField(day, k);
  out.g = dayHasGoal(day);
  return out;
}

/** Lifetime totals: the baseline carried over from before the log existed plus every day. */
export function lifetimeStats(game) {
  const g = normalizeGame(game);
  const t = { reviews: 0, correct: 0, newCards: 0, xp: 0, exams: 0, passed: 0, perfect: 0, goalDays: 0 };
  for (const day of Object.values(g.days)) {
    t.reviews += sumField(day, "r");
    t.correct += sumField(day, "c");
    t.newCards += sumField(day, "n");
    t.xp += sumField(day, "x");
    t.exams += sumField(day, "e");
    t.passed += sumField(day, "p");
    t.perfect += sumField(day, "f");
    if (dayHasGoal(day)) t.goalDays += 1;
  }
  t.xp += t.goalDays * XP.goalDay;
  if (g.base) {
    t.reviews += g.base.reviews || 0;
    t.correct += g.base.correct || 0;
    t.newCards += g.base.newCards || 0;
    t.xp += g.base.xp || 0;
  }
  return t;
}

/** Estimate of what existing progress was already worth, for people who
 *  studied before XP existed. Computed once; merged by max, never added. */
export function baselineFromProgress(progress) {
  let reviews = 0, correct = 0, newCards = 0, mastered = 0;
  for (const s of Object.values(progress || {})) {
    const seen = (s.correctCount || 0) + (s.incorrectCount || 0);
    reviews += seen;
    correct += s.correctCount || 0;
    if (seen > 0) newCards += 1;
    if (s.level === 3) mastered += 1;
  }
  return { reviews, correct, newCards, xp: correct * 4 + newCards * XP.newCard + mastered * XP.mastered };
}

/* ---------- player level ---------- */

/** Level L starts at 50 * L^2 XP, so early levels come fast and later ones slow. */
export function levelInfo(xp) {
  const safe = Math.max(0, xp || 0);
  const level = Math.floor(Math.sqrt(safe / 50));
  const start = 50 * level * level;
  const end = 50 * (level + 1) * (level + 1);
  return { level, xp: safe, into: safe - start, span: end - start };
}

/* ---------- merge (sync) ---------- */

/** Combine two copies. Commutative, associative and idempotent. */
export function mergeGame(a, b) {
  const x = normalizeGame(a);
  const y = normalizeGame(b);

  const days = {};
  for (const date of new Set([...Object.keys(x.days), ...Object.keys(y.days)])) {
    const dx = x.days[date] || {};
    const dy = y.days[date] || {};
    const day = {};
    for (const dev of new Set([...Object.keys(dx), ...Object.keys(dy)])) {
      const ex = dx[dev] || {};
      const ey = dy[dev] || {};
      const entry = {};
      for (const k of [...COUNTERS, ...FLAGS]) {
        const v = Math.max(ex[k] || 0, ey[k] || 0);
        if (v) entry[k] = v;
      }
      day[dev] = entry;
    }
    days[date] = day;
  }

  const achievements = { ...x.achievements };
  for (const [id, at] of Object.entries(y.achievements)) {
    achievements[id] = id in achievements ? Math.min(achievements[id], at) : at;
  }

  let base = null;
  if (x.base || y.base) {
    base = {};
    for (const k of ["xp", "reviews", "correct", "newCards"]) {
      base[k] = Math.max(x.base?.[k] || 0, y.base?.[k] || 0);
    }
  }
  return { v: 1, days, achievements, base };
}

/** Key-order-independent signature, for "did anything change" checks. */
export function gameSig(game) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.keys(v).sort().reduce((o, k) => { o[k] = sort(v[k]); return o; }, {});
    }
    return v;
  };
  return JSON.stringify(sort(normalizeGame(game)));
}

/* ---------- achievements ---------- */

const levelName = (k) => (typeof k === "number" ? `HSK ${k}` : `New HSK ${k}`);

/** `levelKeys` are the HSK levels to offer a completion badge for. */
export function buildAchievements(levelKeys = []) {
  const list = [];
  const count = (id, group, icon, name, desc, key, target) =>
    list.push({ id, group, icon, name, desc, test: (s) => (s[key] || 0) >= target,
      progress: (s) => [Math.min(s[key] || 0, target), target] });

  count("first-card", "Volume", "🌱", "First step", "Answer your first card", "reviews", 1);
  count("rev-100", "Volume", "💯", "Getting going", "Answer 100 cards", "reviews", 100);
  count("rev-500", "Volume", "📚", "Dedicated", "Answer 500 cards", "reviews", 500);
  count("rev-1000", "Volume", "🏋️", "Thousand club", "Answer 1,000 cards", "reviews", 1000);
  count("rev-5000", "Volume", "🏆", "Relentless", "Answer 5,000 cards", "reviews", 5000);
  count("mastered-50", "Volume", "⭐", "Fifty mastered", "Master 50 words", "mastered", 50);
  count("mastered-250", "Volume", "🌟", "Quarter thousand", "Master 250 words", "mastered", 250);
  count("mastered-1000", "Volume", "👑", "Word collector", "Master 1,000 words", "mastered", 1000);

  count("streak-3", "Consistency", "🔥", "On a roll", "3 day streak", "streak", 3);
  count("streak-7", "Consistency", "🔥", "Week warrior", "7 day streak", "streak", 7);
  count("streak-30", "Consistency", "🔥", "Monthly habit", "30 day streak", "streak", 30);
  count("streak-100", "Consistency", "🔥", "Unstoppable", "100 day streak", "streak", 100);
  count("goal-7", "Consistency", "🎯", "Goal getter", "Reach your daily goal on 7 days", "goalDays", 7);

  count("exam-passed", "Milestones", "🎓", "Exam passed", "Pass a practice exam", "passed", 1);
  count("exam-perfect", "Milestones", "💎", "Perfect exam", "Score 100% on an exam", "perfect", 1);

  for (const k of levelKeys) {
    list.push({
      id: `level-${k}`, group: "Levels", icon: "🏅", name: `${levelName(k)} master`,
      desc: `Master 90% of ${levelName(k)}`,
      test: (s) => {
        const l = s.levels?.[k];
        return !!l && l.total > 0 && l.mastered >= Math.ceil(l.total * 0.9);
      },
      progress: (s) => {
        const l = s.levels?.[k] || { mastered: 0, total: 0 };
        const target = Math.max(1, Math.ceil(l.total * 0.9));
        return [Math.min(l.mastered, target), target];
      },
    });
  }
  return list;
}

/** Ids of achievements whose condition is met but are not unlocked yet. */
export function newlyUnlocked(list, stats, unlocked = {}) {
  return list.filter((a) => !(a.id in unlocked) && a.test(stats)).map((a) => a.id);
}

/* ---------- streak (with freezes) ---------- */

export const MAX_FREEZES = 2;
export const FREEZE_EVERY = 7;

/** Advance the streak for activity on `today`. `dayStr(-1)` is yesterday. */
export function advanceStreak(prev, today, dayStr) {
  const s = { lastDate: "", count: 0, freezes: 0, freezeAt: 0, ...prev };
  if (s.lastDate === today) return s;

  let { count, freezes, freezeAt } = s;
  if (s.lastDate === dayStr(-1)) {
    count += 1;
  } else if (s.lastDate === dayStr(-2) && freezes > 0 && count > 0) {
    count += 1;           // one missed day, covered by a freeze
    freezes -= 1;
  } else {
    count = 1;
  }
  if (count < freezeAt) freezeAt = 0;
  if (count % FREEZE_EVERY === 0 && count > freezeAt) {
    freezes = Math.min(MAX_FREEZES, freezes + 1);
    freezeAt = count;
  }
  return { lastDate: today, count, freezes, freezeAt };
}

/** Streak to display: alive if studied today/yesterday, or a freeze covers one missed day. */
export function liveStreak(s, today, dayStr) {
  if (!s) return 0;
  if (s.lastDate === today || s.lastDate === dayStr(-1)) return s.count || 0;
  if (s.lastDate === dayStr(-2) && (s.freezes || 0) > 0) return s.count || 0;
  return 0;
}
