import assert from "node:assert/strict";
import { activate } from "../packages/story-writer/server.mjs";

const store = new Map();
const documents = {
  async getById(_p, id) { return store.get(id) ?? null; },
  async list() { return [...store.values()]; },
  async create(d) { const r = { ...d, revision: 1 }; store.set(d.id, r); return r; },
  async update(d) {
    const cur = store.get(d.id);
    if (!cur || cur.revision !== d.expectedRevision) return null;
    const r = { ...cur, ...d, revision: cur.revision + 1 };
    store.set(d.id, r);
    return r;
  },
  async remove() { return true; },
};
const routes = {};
const app = Object.fromEntries(["get", "put", "post", "delete"].map((m) => [m, (path, fn) => (routes[`${m} ${path}`] = fn)]));
await activate({
  api: {
    runtime: { persistence: { documents }, languageModels: {}, resources: {}, json: { parseJsonish: JSON.parse } },
    registerPrivilegedRoutes: async (register) => { await register(app); return () => {}; },
  },
});
const call = async (route, params, body) => {
  let code = 200;
  const reply = { code(c) { code = c; return this; }, send(x) { return x; } };
  const res = await routes[route]({ params, body, query: {} }, reply);
  return { code, res };
};

store.set("story:1", {
  id: "story:1", kind: "story", name: "Old", description: "d", revision: 1,
  data: { title: "Old", premise: "old premise", characterIds: ["a"], lorebookIds: [], connectionId: null, chapterCount: 2, settings: { presetName: "P", presetText: "TEXT", twists: "free" } },
});
store.set("plan:story:1", { id: "plan:story:1", kind: "plan", revision: 1, data: { premise: "old premise", beat: "keep me", style: { chapterWords: 1900 } } });

const bad = await call("put /stories/:id/setup", { id: "story:1" }, { title: "", premise: "x" });
assert.equal(bad.code, 400);

const ok = await call("put /stories/:id/setup", { id: "story:1" }, { title: " New ", premise: "new premise", characterIds: ["a", "b"], lorebookIds: ["l"], connectionId: "c1" });
assert.equal(ok.res.ok, true);
const story = store.get("story:1");
assert.equal(story.name, "New");
assert.deepEqual([story.data.title, story.data.premise, story.data.characterIds, story.data.lorebookIds, story.data.connectionId], ["New", "new premise", ["a", "b"], ["l"], "c1"]);
assert.equal(story.data.chapterCount, 2);
// preset kept when not sent, other settings and legacy plan style kept, plan beat untouched but premise follows
assert.equal(story.data.settings.presetName, "P");
assert.equal(story.data.settings.twists, "free");
assert.equal(story.data.settings.chapterWords, 1900);
assert.equal(store.get("plan:story:1").data.premise, "new premise");
assert.equal(store.get("plan:story:1").data.beat, "keep me");

await call("put /stories/:id/setup", { id: "story:1" }, { title: "New", presetName: "", presetText: "" });
assert.equal(store.get("story:1").data.settings.presetName, "");

console.log("story-writer setup ok");
