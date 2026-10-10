/* Tests for the pure gamification rules.   node scripts/test_gamification.js */

import {
  XP, answerEvent, examEvent, recordActivity, dayTotals, lifetimeStats, baselineFromProgress,
  levelInfo, mergeGame, gameSig, emptyGame, buildAchievements, newlyUnlocked,
  advanceStreak, liveStreak,
} from "../src/gamification.js";

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
}

console.log("\nxp per answer");
{
  const fresh = answerEvent(undefined, { level: 1 }, "good");
  check("new card good = 5 + 10", fresh.x === 15 && fresh.n === 1 && fresh.c === 1);
  const seen = { correctCount: 3, incorrectCount: 0, level: 2 };
  check("seen card easy = 7", answerEvent(seen, { level: 2 }, "easy").x === 7);
  check("again earns nothing but counts a review", answerEvent(seen, { level: 1 }, "again").x === 0 && answerEvent(seen, { level: 1 }, "again").r === 1);
  check("reaching mastered adds the bonus", answerEvent(seen, { level: 3 }, "good").x === 5 + XP.mastered);
  check("already mastered does not re-award", answerEvent({ ...seen, level: 3 }, { level: 3 }, "good").x === 5);
  check("exam xp scales with score", examEvent({ score: 50, maxScore: 100, passed: true }).x === 25);
  check("perfect exam is flagged", examEvent({ score: 100, maxScore: 100, passed: true }).f === 1);
}

console.log("\nday log");
{
  let g = emptyGame();
  g = recordActivity(g, "A", "2026-10-10", { r: 1, c: 1, n: 0, x: 5 }, 3);
  g = recordActivity(g, "A", "2026-10-10", { r: 1, c: 1, n: 0, x: 5 }, 3);
  check("goal not reached yet", !dayTotals(g, "2026-10-10").g);
  g = recordActivity(g, "A", "2026-10-10", { r: 1, c: 1, n: 0, x: 5 }, 3);
  check("goal reached on the 3rd review", dayTotals(g, "2026-10-10").g);
  const xp = lifetimeStats(g).xp;
  g = recordActivity(g, "A", "2026-10-10", { r: 1, c: 1, n: 0, x: 5 }, 3);
  check("goal bonus is awarded once per day", lifetimeStats(g).xp === xp + 5);
  check("lifetime xp includes the goal bonus", xp === 15 + XP.goalDay);
}

console.log("\nmerge across devices");
{
  let a = recordActivity(emptyGame(), "A", "d1", { r: 10, x: 50 }, 0);
  let b = recordActivity(emptyGame(), "B", "d1", { r: 8, x: 40 }, 0);
  const m = mergeGame(a, b);
  check("two devices on one day add up", dayTotals(m, "d1").r === 18 && dayTotals(m, "d1").x === 90);
  check("merge is idempotent", gameSig(mergeGame(m, m)) === gameSig(m));
  check("merge is commutative", gameSig(mergeGame(a, b)) === gameSig(mergeGame(b, a)));
  const older = recordActivity(emptyGame(), "A", "d1", { r: 4, x: 20 }, 0);
  check("a stale copy of a device cannot roll it back", dayTotals(mergeGame(a, older), "d1").r === 10);
  const withAch = { ...a, achievements: { x: 200 } };
  const other = { ...b, achievements: { x: 100, y: 5 } };
  const am = mergeGame(withAch, other).achievements;
  check("achievements union, earliest unlock wins", am.x === 100 && am.y === 5);
  check("null merges safely", gameSig(mergeGame(null, a)) === gameSig(a));
  const base = mergeGame({ ...emptyGame(), base: { xp: 100, reviews: 10, correct: 5, newCards: 3 } },
                         { ...emptyGame(), base: { xp: 120, reviews: 9, correct: 5, newCards: 3 } });
  check("baseline merges by max, never adds", base.base.xp === 120 && base.base.reviews === 10);
  check("baseline counts toward lifetime xp", lifetimeStats(base).xp === 120);
}

console.log("\nbaseline from old progress");
{
  const b = baselineFromProgress({
    1: { correctCount: 4, incorrectCount: 1, level: 3 },
    2: { correctCount: 0, incorrectCount: 0, level: 0 },
  });
  check("counts reviews and new cards", b.reviews === 5 && b.newCards === 1);
  check("xp estimate", b.xp === 4 * 4 + 10 + 25);
}

console.log("\nplayer level");
{
  check("0 xp is level 0", levelInfo(0).level === 0);
  check("50 xp is level 1", levelInfo(50).level === 1);
  check("200 xp is level 2", levelInfo(200).level === 2);
  const i = levelInfo(120);
  check("progress inside a level", i.level === 1 && i.into === 70 && i.span === 150);
}

console.log("\nachievements");
{
  const list = buildAchievements([1, "N1"]);
  check("level badges are generated", list.some((a) => a.id === "level-1") && list.some((a) => a.id === "level-N1"));
  check("ids are unique", new Set(list.map((a) => a.id)).size === list.length);
  const stats = { reviews: 120, mastered: 0, streak: 3, goalDays: 0, passed: 0, perfect: 0, levels: { 1: { mastered: 450, total: 500 } } };
  const ids = newlyUnlocked(list, stats, {});
  check("first card and 100 reviews unlock", ids.includes("first-card") && ids.includes("rev-100") && !ids.includes("rev-500"));
  check("streak 3 unlocks", ids.includes("streak-3"));
  check("level unlocks at 90%", ids.includes("level-1") && !ids.includes("level-N1"));
  check("already unlocked are not repeated", !newlyUnlocked(list, stats, { "first-card": 1 }).includes("first-card"));
}

console.log("\nstreak and freezes");
{
  const dayStr = (off) => `d${10 + off}`;
  let s = advanceStreak({ lastDate: "d9", count: 6, freezes: 0, freezeAt: 0 }, "d10", dayStr);
  check("7th day earns a freeze", s.count === 7 && s.freezes === 1 && s.freezeAt === 7);
  const miss = advanceStreak({ lastDate: "d8", count: 7, freezes: 1, freezeAt: 7 }, "d10", dayStr);
  check("one missed day is covered by a freeze", miss.count === 8 && miss.freezes === 0);
  const broken = advanceStreak({ lastDate: "d7", count: 7, freezes: 2, freezeAt: 7 }, "d10", dayStr);
  check("two missed days break the streak even with freezes", broken.count === 1 && broken.freezeAt === 0);
  const noFreeze = advanceStreak({ lastDate: "d8", count: 5, freezes: 0, freezeAt: 0 }, "d10", dayStr);
  check("no freeze, missed day resets", noFreeze.count === 1);
  const cap = advanceStreak({ lastDate: "d9", count: 20, freezes: 2, freezeAt: 14 }, "d10", dayStr);
  check("freezes are capped at 2", cap.count === 21 && cap.freezes === 2);
  const same = advanceStreak({ lastDate: "d10", count: 4, freezes: 1, freezeAt: 0 }, "d10", dayStr);
  check("second activity the same day changes nothing", same.count === 4 && same.freezes === 1);
  check("old streak object without freeze fields works", advanceStreak({ lastDate: "d9", count: 2 }, "d10", dayStr).count === 3);
  check("display: covered by a freeze", liveStreak({ lastDate: "d8", count: 5, freezes: 1 }, "d10", dayStr) === 5);
  check("display: broken", liveStreak({ lastDate: "d8", count: 5, freezes: 0 }, "d10", dayStr) === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
