import assert from "node:assert/strict";
import { beatBlock, createAgentRuntime, createContributor, mergePlanUpdate, normalizePlan, planId, PACKAGE_ID } from "../packages/story-writer/plan.mjs";

const plan = {
  premise: "PREMISE_MARK", outline: ["OUTLINE_MARK"], secrets: ["SECRET_MARK"],
  twists: [{ text: "TWIST_MARK", reveal: "REVEAL_MARK" }], offscreen: ["OFFSCREEN_MARK"], threads: ["THREAD_MARK"],
  beat: "The harbor bell rings.", chapter: 2,
};
const marks = ["PREMISE_MARK", "OUTLINE_MARK", "SECRET_MARK", "TWIST_MARK", "REVEAL_MARK", "OFFSCREEN_MARK", "THREAD_MARK"];
const noMarks = (text) => marks.forEach((m) => assert.ok(!String(text).includes(m), `leaked ${m}`));

// (1) + (2) only the beat reaches the writer
assert.ok(beatBlock(plan).includes("The harbor bell rings."));
noMarks(beatBlock(plan));
assert.equal(beatBlock({ ...plan, beat: "  " }), "");
assert.equal(beatBlock(null), "");

// (3) caps and sanitizing
const big = normalizePlan({ premise: "x".repeat(9999), outline: Array(99).fill("y".repeat(999)), secrets: [1, null, "ok", " "], twists: ["a", { text: 5 }, { text: "b", reveal: "c" }], beat: 42, chapter: "3" });
assert.equal(big.premise.length, 2000);
assert.equal(big.outline.length, 20);
assert.equal(big.outline[0].length, 300);
assert.deepEqual(big.secrets, ["ok"]);
assert.deepEqual(big.twists, [{ text: "a", reveal: null }, { text: "b", reveal: "c" }]);
assert.equal(big.beat, "");
assert.equal(big.chapter, 0);
assert.deepEqual(normalizePlan("junk").outline, []);

// (4) merge
const merged = mergePlanUpdate(plan, { beat: "New beat", threads: ["T2"], chapter: 99, evil: "x" }, "NOW");
assert.equal(merged.chapter, 3);
assert.equal(merged.beat, "New beat");
assert.deepEqual(merged.threads, ["T2"]);
assert.deepEqual(merged.secrets, ["SECRET_MARK"]);
assert.equal(merged.updatedAt, "NOW");
assert.ok(!("evil" in merged));

// fake documents store
const store = new Map();
const documents = {
  async getById(pkg, id) { assert.equal(pkg, PACKAGE_ID); return store.get(id) ?? null; },
  async create(d) { const r = { ...d, revision: 1 }; store.set(d.id, r); return r; },
  async update(d) { const cur = store.get(d.id); if (cur.revision !== d.expectedRevision) return null; const r = { ...cur, ...d, revision: cur.revision + 1 }; store.set(d.id, r); return r; },
};
store.set(planId("c1"), { id: planId("c1"), revision: 1, data: plan });

// (5) contributor
const contribute = createContributor(documents);
assert.ok((await contribute({ chatId: "c1", chatMeta: { storyWriter: true } })).includes("harbor bell"));
assert.equal(await contribute({ chatId: "c1", chatMeta: {} }), undefined);
assert.equal(await contribute({ chatId: "c1", chatMeta: { storyWriter: "true" } }), undefined);
assert.equal(await contribute({ chatId: "none", chatMeta: { storyWriter: true } }), undefined);
const broken = createContributor({ getById: async () => { throw new Error("db down"); } });
assert.equal(await broken({ chatId: "c1", chatMeta: { storyWriter: true } }), undefined);

// (6) finalizeResult blanks the result and stores the update
const rt = createAgentRuntime(documents, JSON.parse);
const out = await rt.finalizeResult({
  context: { chatId: "c1" },
  result: { agentId: "a", success: true, data: { text: JSON.stringify({ beat: "Next", secrets: ["SECRET_MARK", "SECRET_MARK2"], twists: [{ text: "TWIST_MARK", reveal: "REVEAL_MARK" }] }) } },
});
noMarks(JSON.stringify(out));
assert.equal(out.success, true);
assert.equal(store.get(planId("c1")).data.beat, "Next");
assert.equal(store.get(planId("c1")).data.chapter, 3);
assert.equal(store.get(planId("c1")).revision, 2);
const bad = await rt.finalizeResult({ context: { chatId: "c1" }, result: { agentId: "a", success: true, data: { text: "SECRET_MARK not json" } } });
noMarks(JSON.stringify(bad));
assert.equal(bad.success, false);
assert.equal(store.get(planId("c1")).data.chapter, 3);
assert.deepEqual(await rt.prepareContext({ context: { chatId: "none" } }), null);
assert.equal((await rt.prepareContext({ context: { chatId: "c1" } })).beat, "Next");

console.log("story-writer plan ok");
