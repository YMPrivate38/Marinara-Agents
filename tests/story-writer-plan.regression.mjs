import assert from "node:assert/strict";
import {
  mergePlanUpdate,
  normalizePlan,
  normalizeStyle,
  PACKAGE_ID,
  planId,
  POVS,
  readPlan,
  TENSES,
  writePlan,
} from "../packages/story-writer/plan.mjs";

const plan = {
  premise: "PREMISE_MARK",
  outline: ["OUTLINE_MARK"],
  secrets: ["SECRET_MARK"],
  twists: [{ text: "TWIST_MARK", reveal: "REVEAL_MARK" }],
  offscreen: ["OFFSCREEN_MARK"],
  threads: ["THREAD_MARK"],
  beat: "The harbor bell rings.",
  chapter: 2,
  style: { chapterWords: 1800, pointOfView: "first person", tense: "present" },
};

// (1) normalizeStyle: clamped and constrained to allowed values
assert.deepEqual(normalizeStyle({ chapterWords: 99999, pointOfView: "x", tense: "future" }), {
  chapterWords: 8000,
  pointOfView: "third person limited",
  tense: "past",
});
assert.equal(normalizeStyle({ chapterWords: 5 }).chapterWords, 300);
assert.equal(normalizeStyle({ chapterWords: "abc" }).chapterWords, 2500);
assert.equal(normalizeStyle(null).chapterWords, 2500);
for (const pov of POVS) assert.equal(normalizeStyle({ pointOfView: pov }).pointOfView, pov);
for (const tense of TENSES) assert.equal(normalizeStyle({ tense }).tense, tense);

// (2) normalizePlan: caps and sanitizing
const big = normalizePlan({
  premise: "x".repeat(9999),
  outline: Array(99).fill("y".repeat(999)),
  secrets: [1, null, "ok", " "],
  twists: ["a", { text: 5 }, { text: "b", reveal: "c" }],
  beat: 42,
  chapter: "3",
  style: { chapterWords: 99999, pointOfView: "x", tense: "future" },
});
assert.equal(big.premise.length, 2000);
assert.equal(big.outline.length, 20);
assert.equal(big.outline[0].length, 300);
assert.deepEqual(big.secrets, ["ok"]);
assert.deepEqual(big.twists, [
  { text: "a", reveal: null },
  { text: "b", reveal: "c" },
]);
assert.equal(big.beat, "");
assert.equal(big.chapter, 0);
assert.deepEqual(big.style, { chapterWords: 8000, pointOfView: "third person limited", tense: "past" });
assert.deepEqual(normalizePlan("junk").outline, []);

// (3) mergePlanUpdate: chapter bump, beat replaced, unknown fields ignored, style immutable
const merged = mergePlanUpdate(
  plan,
  {
    beat: "New beat",
    threads: ["T2"],
    chapter: 99,
    evil: "x",
    style: { chapterWords: 400, pointOfView: "second person", tense: "past" },
  },
  "NOW",
);
assert.equal(merged.chapter, 3);
assert.equal(merged.beat, "New beat");
assert.deepEqual(merged.threads, ["T2"]);
assert.deepEqual(merged.secrets, ["SECRET_MARK"]);
assert.deepEqual(merged.style, plan.style);
assert.equal(merged.updatedAt, "NOW");
assert.ok(!("evil" in merged));
assert.equal(mergePlanUpdate(plan, {}).beat, "");

// (4) readPlan / writePlan with fake in-memory documents store
const store = new Map();
const documents = {
  async getById(pkg, id) {
    assert.equal(pkg, PACKAGE_ID);
    return store.get(id) ?? null;
  },
  async create(d) {
    const r = { ...d, revision: 1 };
    store.set(d.id, r);
    return r;
  },
  async update(d) {
    const cur = store.get(d.id);
    if (!cur || cur.revision !== d.expectedRevision) return null;
    const r = { ...cur, ...d, revision: cur.revision + 1 };
    store.set(d.id, r);
    return r;
  },
};

assert.equal(await readPlan(documents, "story:1"), null);

const created = await writePlan(documents, "story:1", normalizePlan(plan), null, "2026-10-22T00:00:00Z");
assert.equal(created.id, planId("story:1"));
assert.equal(created.kind, "plan");
assert.equal(created.revision, 1);
assert.equal((await readPlan(documents, "story:1")).data.beat, "The harbor bell rings.");

const updated = await writePlan(documents, "story:1", { ...created.data, beat: "Second beat" }, 1, "2026-10-22T01:00:00Z");
assert.equal(updated.revision, 2);
assert.equal((await readPlan(documents, "story:1")).data.beat, "Second beat");

const conflict = await writePlan(documents, "story:1", { ...created.data, beat: "Stale write" }, 1, "2026-10-22T02:00:00Z");
assert.equal(conflict, null);
assert.equal((await readPlan(documents, "story:1")).data.beat, "Second beat");
assert.equal((await readPlan(documents, "story:1")).revision, 2);

const overwritten = await writePlan(documents, "story:1", { ...created.data, beat: "Latest" }, null, "2026-10-22T03:00:00Z");
assert.equal(overwritten.revision, 3);
assert.equal((await readPlan(documents, "story:1")).data.beat, "Latest");

// settings carry the chapter style; stories without it fall back to the plan's legacy style
{
  const { normalizeSettings, normalizeOverrides, effectiveSettings, normalizePlan } = await import("../packages/story-writer/plan.mjs");
  assert.equal(normalizeSettings({}, { chapterWords: 1900, pointOfView: "first person" }).chapterWords, 1900);
  assert.equal(normalizeSettings({ chapterWords: 700 }, { chapterWords: 1900 }).chapterWords, 700);
  assert.equal(normalizeSettings({}).tense, "past");
  // overrides keep only the keys given, drop junk chapter numbers, and win over the story settings for that chapter only
  const ov = normalizeOverrides({ 3: { twists: "free", chapterWords: 99999, nope: 1 }, 0: { twists: "none" }, x: { twists: "none" }, 4: {} });
  assert.deepEqual(ov, { 3: { twists: "free", chapterWords: 8000 } });
  assert.equal(effectiveSettings({ twists: "none", minScore: 9 }, ov, 3).twists, "free");
  assert.equal(effectiveSettings({ twists: "none", minScore: 9 }, ov, 3).minScore, 9);
  assert.equal(effectiveSettings({ twists: "none" }, ov, 4).twists, "none");
  assert.equal(normalizePlan({ arc: 3 }).arc, 3);
  assert.equal(normalizePlan({ arc: 0 }).arc, 1);
}

console.log("story-writer plan ok");
