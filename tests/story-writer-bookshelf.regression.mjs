import assert from "node:assert/strict";

// Minimal DOM: elements keep tag, textContent, value, attrs and children so we can inspect rendered trees.
class El {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.textContent = "";
    this.value = "";
    this.attrs = {};
    this.listeners = {};
  }
  append(...k) {
    this.children.push(...k);
  }
  replaceChildren(...k) {
    this.children = k;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(t, f) {
    this.listeners[t] = f;
  }
}
const all = (e) => [e, ...e.children.flatMap(all)];
globalThis.HTMLElement = El;
globalThis.document = { createElement: (t) => new El(t) };
const defined = {};
globalThis.customElements = {
  get: (n) => defined[n],
  define: (n, c) => {
    defined[n] = c;
  },
};

const url = new URL("../packages/story-writer/client.js", import.meta.url);
await import(url.href);
const S = defined["marinara-capability-story-writer"];

// (1) Pure static helpers
assert.deepEqual(
  S.connections([
    { id: "1", provider: "openai" },
    { id: "2", provider: "decision" },
  ]).map((c) => c.id),
  ["1"],
);
assert.equal(S.characterName({ id: "x", data: '{"name":"Ada"}' }), "Ada");
assert.equal(S.characterName({ id: "y", data: "not-json" }), "y");
assert.equal(S.phaseLabel("writing"), "Writing");
assert.equal(S.jobLine({ done: 1, total: 3, phase: "checking" }), "Chapter 2 of 3 — Checking the characters");
assert.equal(S.jobLine({ done: 3, total: 3, phase: "planning" }), "Chapter 3 of 3 — Planning what comes next");
assert.equal(S.phaseLabel("checking"), "Checking the characters");
assert.equal(S.phaseLabel("rewriting"), "Fixing problems");
assert.equal(S.phaseLabel("planning"), "Planning what comes next");
assert.deepEqual(S.splitParagraphs("  First para.\n\nSecond para.\r\n \r\nThird para.  "), [
  "First para.",
  "Second para.",
  "Third para.",
]);
assert.deepEqual(S.splitParagraphs(""), []);
assert.deepEqual(S.listLines(" alpha \n\n beta \r\n "), ["alpha", "beta"]);

const twists = [
  { text: "The butler did it", reveal: "chapter 5" },
  { text: "No twin exists", reveal: null },
];
assert.equal(S.formatTwists(twists), "The butler did it | chapter 5\nNo twin exists");
assert.deepEqual(S.parseTwists(S.formatTwists(twists)), twists);

assert.equal(S.clampWords(100), 300);
assert.equal(S.clampWords(9000), 8000);
assert.equal(S.clampWords(1800), 1800);
assert.equal(S.clampWords(""), 2500);
assert.equal(S.clampWords(null), 2500);
assert.equal(S.clampWords("nope"), 2500);

assert.equal(S.storyPath("story:abc-123"), "/story-writer/stories/story%3Aabc-123");
assert.equal(S.storyPath("story:abc-123", "/plan"), "/story-writer/stories/story%3Aabc-123/plan");
assert.equal(S.storyPath("story:abc-123", "chapters/2"), "/story-writer/stories/story%3Aabc-123/chapters/2");

// (2) Shelf rendering uses textContent only (no stray tags from an <img onerror> title)
const evil = "<img src=x onerror=alert(1)>";
const el = new S();
el.renderShelf([{ id: "story:1", title: evil, chapterCount: 2, createdAt: "2026-01-01T00:00:00Z" }]);
const shelfNodes = all(el);
assert.ok(!shelfNodes.some((n) => n.tag === "img"));
assert.ok(shelfNodes.some((n) => n.tag === "strong" && n.textContent === evil));
assert.ok(shelfNodes.some((n) => n.textContent === "2 chapters"));

// (3) Reader chapter list renders title + blurb + wordCount and never leaks internal summary or body text
const storyPayload = {
  id: "story:1",
  title: "Harbor Watch",
  premise: "A lighthouse keeper hears a bell.",
  chapterCount: 1,
  chapters: [
    {
      n: 1,
      title: "The Fog",
      blurb: "Fog rolls in over the pier.",
      wordCount: 1234,
      summary: "INTERNAL_SUMMARY_MARK",
      text: "BODY_MARK",
    },
  ],
};
const planPayload = {
  plan: {
    premise: "A lighthouse keeper hears a bell.",
    outline: ["OUTLINE_MARK"],
    secrets: ["SECRET_MARK"],
    twists: [{ text: "TWIST_MARK", reveal: "ch 4" }],
    offscreen: ["OFFSCREEN_MARK"],
    threads: ["THREAD_MARK"],
    beat: "BEAT_MARK",
    style: { chapterWords: 1900, pointOfView: "first person", tense: "present" },
  },
  revision: 3,
};

globalThis.__MARINARA_HOST__ = {
  api: {
    api: {
      async get(path) {
        if (path === "/story-writer/stories/story%3A1") return storyPayload;
        if (path === "/story-writer/stories/story%3A1/plan") return planPayload;
        if (path === "/story-writer/stories/story%3A1/chapters/1") {
          return { n: 1, title: "The Fog", text: "Para one.\n\nPara two.", blurb: "Fog rolls in over the pier." };
        }
        throw new Error(`Unexpected GET ${path}`);
      },
    },
  },
};

await shelfNodes.find((n) => n.tag === "button" && n.textContent === "Open").listeners.click();
const treeText = (root) =>
  all(root)
    .map((n) => `${n.textContent ?? ""} ${n.value ?? ""}`)
    .join("\n");

const readerDump = treeText(el);
assert.ok(readerDump.includes("Chapter 1: The Fog"));
assert.ok(readerDump.includes("Fog rolls in over the pier."));
assert.ok(readerDump.includes("1234 words"));
assert.ok(!readerDump.includes("INTERNAL_SUMMARY_MARK"));
assert.ok(!readerDump.includes("BODY_MARK"));

// (4) Plan panel: style fields present before reveal, spoilers absent before reveal and present after
all(el)
  .find((n) => n.tag === "button" && n.textContent === "Plan")
  .listeners.click();
await new Promise((r) => setTimeout(r, 0));

const beforeReveal = treeText(el);
assert.ok(beforeReveal.includes("Spoilers hidden"));
assert.ok(beforeReveal.includes("1900"));
assert.ok(beforeReveal.includes("first person"));
assert.ok(beforeReveal.includes("present"));
assert.ok(!beforeReveal.includes("SECRET_MARK"));
assert.ok(!beforeReveal.includes("OUTLINE_MARK"));
assert.ok(!beforeReveal.includes("TWIST_MARK"));

all(el)
  .find((n) => n.tag === "button" && n.textContent === "Reveal spoilers")
  .listeners.click();

const afterReveal = treeText(el);
assert.ok(afterReveal.includes("SECRET_MARK"));
assert.ok(afterReveal.includes("OUTLINE_MARK"));
assert.ok(afterReveal.includes("TWIST_MARK | ch 4"));
assert.ok(afterReveal.includes("OFFSCREEN_MARK"));
assert.ok(afterReveal.includes("THREAD_MARK"));
assert.ok(afterReveal.includes("BEAT_MARK"));

// Closing and re-opening the plan panel re-hides spoilers
all(el)
  .find((n) => n.tag === "button" && n.textContent === "Plan")
  .listeners.click();
assert.ok(!treeText(el).includes("SECRET_MARK"));

// (5) Reading a chapter splits paragraphs into <p> elements
await all(el)
  .find((n) => n.tag === "button" && n.textContent === "Read")
  .listeners.click();
const paragraphs = all(el)
  .filter((n) => n.tag === "p")
  .map((n) => n.textContent);
assert.ok(paragraphs.includes("Para one."));
assert.ok(paragraphs.includes("Para two."));

console.log("story-writer bookshelf ok");
