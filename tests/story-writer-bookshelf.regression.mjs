import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Minimal DOM: elements keep tag, textContent and children so we can look for stray tags.
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.textContent = ""; this.attrs = {}; this.listeners = {}; }
  append(...k) { this.children.push(...k); }
  replaceChildren(...k) { this.children = k; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { this.listeners[t] = f; }
}
const all = (e) => [e, ...e.children.flatMap(all)];
globalThis.HTMLElement = El;
globalThis.document = { createElement: (t) => new El(t) };
const defined = {};
globalThis.customElements = { get: (n) => defined[n], define: (n, c) => (defined[n] = c) };

const url = new URL("../packages/story-writer/client.js", import.meta.url);
await import(url.href);
const S = defined["marinara-capability-story-writer"];

const chats = [
  { id: "a", metadata: '{"storyWriter":true}', updatedAt: "2026-01-01" },
  { id: "b", metadata: { storyWriter: true }, updatedAt: "2026-02-01" },
  { id: "c", metadata: "{}" },
  { id: "d", metadata: "not json" },
  { id: "e" },
];
assert.deepEqual(S.storyChats(chats).map((c) => c.id), ["b", "a"]);
assert.deepEqual(S.connections([{ id: "1", provider: "openai" }, { id: "2", provider: "decision" }]).map((c) => c.id), ["1"]);
assert.equal(S.characterName({ id: "x", data: '{"name":"Ada"}' }), "Ada");

const evil = '<img src=x onerror=alert(1)>';
const el = new S();
el.render([{ id: "z", name: evil, updatedAt: "2026-01-01" }], [{ id: "1", name: evil }], [{ id: "c", data: JSON.stringify({ name: evil }) }]);
const nodes = all(el);
assert.ok(!nodes.some((n) => n.tag === "img"));
assert.ok(nodes.some((n) => n.tag === "strong" && n.textContent === evil));

let opened;
el.capabilityProps = { openChat: (id) => (opened = id) };
nodes.find((n) => n.tag === "button" && n.textContent === "Open").listeners.click();
assert.equal(opened, "z");
console.log("story-writer bookshelf ok");
