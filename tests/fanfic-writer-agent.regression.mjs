import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [agent] = JSON.parse(await readFile(new URL("../packages/fanfic-writer/agents.json", import.meta.url), "utf8"));
assert.equal(agent.phase, "post_processing");
assert.equal(agent.resultType, "text_rewrite");
assert.equal(agent.defaultSettings.resultType, "text_rewrite");
assert.deepEqual(agent.modeAllowlist, ["roleplay"]);

// Every {{setting}} in the prompt must be a default setting, or the agent would send a literal placeholder.
const used = [...agent.defaultPromptTemplate.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
assert.ok(used.length > 0);
for (const key of used) assert.ok(key in agent.defaultSettings, `missing default setting ${key}`);
for (const word of ["inCharacter", "plausibility", "editNeeded"]) assert.ok(agent.defaultPromptTemplate.includes(word), `prompt lacks ${word}`);
assert.ok(!agent.defaultPromptTemplate.includes("direction"));
console.log("fanfic-writer agent ok");
