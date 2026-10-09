/* Tests for the pure sync merge rules.
 *
 *   node scripts/test_sync_merge.js
 *
 * These functions decide which copy of a learner's progress survives a merge.
 * A bug here silently corrupts study history, so they are tested directly
 * rather than only through the UI.
 */

import {
  mergeProgressMaps,
  mergeCustomWords,
  mergeSettings,
  progressRecordToRow,
  rowToProgressRecord,
  localWordToRow,
  rowToLocalWord,
  chunk,
} from "../src/syncCore.js";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`);
  }
}

const rec = (lastReviewed, correctCount = 0) => ({
  level: 1, ease: 2.5, interval: 1, reps: 1, lapses: 0,
  nextReview: lastReviewed + 86400000, lastReviewed,
  correctCount, incorrectCount: 0,
});

console.log("\nprogress merge");

{
  const { merged, pushIds } = mergeProgressMaps(
    { 1: rec(200, 5) },
    [{ card_id: 1, level: 2, ease: 2.5, interval_days: 3, reps: 2, lapses: 0,
       next_review: 999, last_reviewed: 100, correct_count: 2, incorrect_count: 0 }]
  );
  check("local newer wins", merged["1"].lastReviewed === 200 && merged["1"].correctCount === 5);
  check("local newer is queued for upload", pushIds.includes("1"));
}

{
  const { merged, pushIds } = mergeProgressMaps(
    { 1: rec(100, 2) },
    [{ card_id: 1, level: 3, ease: 2.5, interval_days: 9, reps: 4, lapses: 1,
       next_review: 999, last_reviewed: 500, correct_count: 9, incorrect_count: 1 }]
  );
  check("remote newer wins", merged["1"].lastReviewed === 500 && merged["1"].correctCount === 9);
  check("remote newer is NOT re-uploaded", !pushIds.includes("1"));
}

{
  const { merged, pushIds } = mergeProgressMaps(
    { 1: rec(100), 2: rec(200) },
    [{ card_id: 2, last_reviewed: 50, correct_count: 1 }, { card_id: 3, last_reviewed: 300 }]
  );
  check("union keeps all three cards", Object.keys(merged).length === 3);
  check("card only on server is adopted", merged["3"].lastReviewed === 300);
  check("card only on server is not uploaded", !pushIds.includes("3"));
  check("card only on device is uploaded", pushIds.includes("2") || pushIds.includes("1"));
}

{
  const { merged, pushIds } = mergeProgressMaps(
    { 7: rec(400) },
    [{ card_id: 7, last_reviewed: 400, correct_count: 0 }]
  );
  check("identical timestamps do not churn the server", pushIds.length === 0);
  check("identical timestamps keep a record", !!merged["7"]);
}

{
  const { merged } = mergeProgressMaps({}, []);
  check("empty merge is safe", Object.keys(merged).length === 0);
}

console.log("\nround-trip mapping");

{
  const original = { level: 2, ease: 2.4, interval: 3, reps: 2, lapses: 1,
                     nextReview: 111, lastReviewed: 222, correctCount: 3, incorrectCount: 1 };
  const back = rowToProgressRecord(progressRecordToRow("u1", 42, original));
  check("progress survives a round trip",
    back.level === original.level && back.interval === original.interval &&
    back.lastReviewed === original.lastReviewed && back.correctCount === original.correctCount);
  check("card id is stored as text", progressRecordToRow("u1", 42, original).card_id === "42");
}

{
  const w = { id: "custom-abc", hanzi: "学", pinyin: "xué", meaning: "study",
              partOfSpeech: "verb", exampleHanzi: "学中文", updatedAt: 1234 };
  const back = rowToLocalWord(localWordToRow("u1", w));
  check("custom word survives a round trip",
    back.hanzi === "学" && back.exampleHanzi === "学中文" && back.updatedAt === 1234);
  check("custom word keeps its custom level", back.level === "custom" && back.source === "custom");
}

console.log("\ncustom word merge");

{
  const local = [{ id: "custom-a", hanzi: "甲", updatedAt: 100 }];
  const remote = [{ id: "custom-a", hanzi: "甲", deleted: false, client_updated_at: new Date(50).toISOString() },
                  { id: "custom-b", hanzi: "乙", deleted: false, client_updated_at: new Date(10).toISOString() }];
  const { merged, pushIds } = mergeCustomWords(local, remote, []);
  check("union of both sides", merged.length === 2);
  check("server-only word adopted", merged.some(w => w.id === "custom-b"));
  check("locally newer word queued", pushIds.includes("custom-a"));
}

{
  const local = [];
  const remote = [{ id: "custom-a", hanzi: "甲", deleted: false, client_updated_at: new Date(10).toISOString() }];
  const { merged } = mergeCustomWords(local, remote, ["custom-a"]);
  check("local tombstone is NOT resurrected", merged.length === 0);
}

{
  const local = [{ id: "custom-a", hanzi: "甲", updatedAt: 100 }];
  const remote = [{ id: "custom-a", hanzi: "甲", deleted: true, client_updated_at: new Date(999).toISOString() }];
  const { merged } = mergeCustomWords(local, remote, []);
  check("server soft-delete beats a local copy", merged.length === 0);
}

{
  const local = [{ id: "custom-a", hanzi: "甲", updatedAt: 100 }];
  const remote = [{ id: "custom-a", hanzi: "甲-newer", deleted: false, client_updated_at: new Date(500).toISOString() }];
  const { merged } = mergeCustomWords(local, remote, []);
  check("newer remote word wins", merged[0].hanzi === "甲-newer");
}

console.log("\nsettings merge");

{
  const local = { darkMode: true, reverseMode: false, levels: [3], goal: 20 };
  const remote = { dark_mode: false, reverse_mode: true, levels: ["N1"], goal: 50 };
  check("fresh device adopts the account's settings",
    mergeSettings(local, remote, true).settings.goal === 50);
  check("used device keeps its own settings",
    mergeSettings(local, remote, false).settings.goal === 20);
  check("no remote row means push",
    mergeSettings(local, null, true).push === true);
}

console.log("\nchunking");

{
  const parts = chunk([1, 2, 3, 4, 5], 2);
  check("chunk splits evenly", parts.length === 3 && parts[2].length === 1);
  check("chunk handles empty", chunk([], 10).length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
