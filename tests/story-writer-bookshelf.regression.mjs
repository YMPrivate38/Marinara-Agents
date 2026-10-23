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

assert.equal(
  S.presetText({
    preset: { id: "p1", name: "Noir" },
    sections: [
      { enabled: true, isMarker: false, content: "  Keep sentences crisp.  " },
      { enabled: false, isMarker: false, content: "DISABLED_SECTION" },
      { enabled: true, isMarker: true, content: "MARKER_SECTION" },
      { enabled: true, isMarker: false, content: "   " },
      { enabled: true, isMarker: false, content: "Show, do not tell." },
    ],
  }),
  "Keep sentences crisp.\n\nShow, do not tell.",
);
assert.equal(S.presetText({ sections: [] }), "");
assert.equal(S.presetText(null), "");

assert.deepEqual(
  S.greetings({
    id: "c1",
    data: JSON.stringify({
      name: "Ada",
      first_mes: "Hello there.",
      alternate_greetings: ["First alt.", "", "   ", "Fourth alt."],
    }),
  }),
  [
    { label: "Ada — first message", text: "Hello there." },
    { label: "Ada — alternate 1", text: "First alt." },
    { label: "Ada — alternate 4", text: "Fourth alt." },
  ],
);
assert.deepEqual(
  S.greetings({
    id: "c2",
    data: {
      data: {
        name: "Bea",
        first_mes: "   ",
        alternate_greetings: ["Nested alt 1", "Nested alt 2"],
      },
    },
  }),
  [
    { label: "Bea — alternate 1", text: "Nested alt 1" },
    { label: "Bea — alternate 2", text: "Nested alt 2" },
  ],
);
assert.equal(S.greetings({ id: "c3", data: { name: "Cid", first_mes: "x".repeat(4500) } })[0].text.length, 4000);

// (2) Shelf rendering uses textContent only (no stray tags from an <img onerror> title)
const evil = "<img src=x onerror=alert(1)>";
const el = new S();
el.renderShelf([{ id: "story:1", title: evil, chapterCount: 2, createdAt: "2026-01-01T00:00:00Z" }]);
const shelfNodes = all(el);
const initialStyle = shelfNodes.filter((n) => n.tag === "style");
assert.equal(initialStyle.length, 1);
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

const planDom = all(el);
const spoilerBtnIdx = planDom.findIndex((n) => n.tag === "button" && n.textContent === "Hide spoilers");
const firstSpoilerIdx = planDom.findIndex((n) => n.tag === "label" && n.textContent === "Outline");
assert.ok(spoilerBtnIdx >= 0 && firstSpoilerIdx > spoilerBtnIdx);

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

// (6) Picker statics: unwrapPage, pickQuery, togglePick
assert.deepEqual(S.unwrapPage([{ id: "1" }]), { items: [{ id: "1" }], hasMore: false });
assert.deepEqual(S.unwrapPage({ items: [{ id: "1" }], hasMore: true }), { items: [{ id: "1" }], hasMore: true });
assert.deepEqual(S.unwrapPage({ items: [{ id: "1" }], hasMore: 0 }), { items: [{ id: "1" }], hasMore: false });
assert.deepEqual(S.unwrapPage(null), { items: [], hasMore: false });
assert.deepEqual(S.unwrapPage("junk"), { items: [], hasMore: false });
assert.deepEqual(S.unwrapPage({ items: "nope", hasMore: true }), { items: [], hasMore: false });

assert.equal(
  S.pickQuery("/characters", "a b&c=d", 0, "name-asc"),
  "/characters?search=a%20b%26c%3Dd&limit=20&offset=0&sort=name-asc",
);
assert.equal(S.pickQuery("/lorebooks", "café 雪", 20), "/lorebooks?search=caf%C3%A9%20%E9%9B%AA&limit=20&offset=20");
assert.equal(S.pickQuery("/lorebooks", "", 0, ""), "/lorebooks?search=&limit=20&offset=0");

const baseSel = Object.freeze([{ id: "c1", name: "Ada" }]);
const addedRes = S.togglePick(baseSel, { id: "c2", name: "Bob" }, 2);
assert.deepEqual(addedRes, {
  selected: [
    { id: "c1", name: "Ada" },
    { id: "c2", name: "Bob" },
  ],
  added: true,
  atLimit: false,
});
assert.deepEqual(baseSel, [{ id: "c1", name: "Ada" }]);
const dupRes = S.togglePick(addedRes.selected, { id: "c1", name: "Ada" }, 2);
assert.deepEqual(dupRes, { selected: addedRes.selected, added: false, atLimit: false });
const limitInput = Object.freeze([...addedRes.selected]);
const limitRes = S.togglePick(limitInput, { id: "c3", name: "Cid" }, 2);
assert.deepEqual(limitRes, { selected: addedRes.selected, added: false, atLimit: true });

// (7) New story form uses paged pickers (never bare /characters or /lorebooks) and escapes <img onerror>
const formCalls = [];
let postedStory = null;
globalThis.__MARINARA_HOST__ = {
  api: {
    api: {
      async get(path) {
        formCalls.push(path);
        if (path === "/connections") return [{ id: "conn:1", name: "Local", provider: "openai" }];
        if (path === "/characters?search=&limit=20&offset=0&sort=name-asc") {
          return {
            items: [
              { id: "char:evil", data: JSON.stringify({ name: evil }) },
              { id: "char:ada", data: JSON.stringify({ name: "Ada" }) },
            ],
            hasMore: true,
          };
        }
        if (path === "/characters?search=&limit=20&offset=20&sort=name-asc") {
          return { items: [{ id: "char:bob", data: JSON.stringify({ name: "Bob" }) }], hasMore: false };
        }
        if (path === "/lorebooks?search=&limit=20&offset=0") {
          return { items: [{ id: "lore:1", name: "World Lore" }], hasMore: false };
        }
        if (path === "/story-writer/stories/story%3Acreated") {
          return { id: "story:created", title: "New Harbor", chapterCount: 0, chapters: [] };
        }
        throw new Error(`Unexpected GET ${path}`);
      },
      async post(path, body) {
        if (path === "/story-writer/stories") {
          postedStory = body;
          return { id: "story:created" };
        }
        throw new Error(`Unexpected POST ${path}`);
      },
    },
  },
};

await el.openNewStoryForm();
await new Promise((r) => setTimeout(r, 0));

assert.ok(!formCalls.includes("/characters"));
assert.ok(!formCalls.includes("/lorebooks"));
assert.deepEqual(formCalls, [
  "/connections",
  "/characters?search=&limit=20&offset=0&sort=name-asc",
  "/lorebooks?search=&limit=20&offset=0",
  "/prompts",
]);

const formNodes = all(el);
assert.ok(!formNodes.some((n) => n.tag === "img"));
assert.ok(formNodes.some((n) => n.tag === "button" && n.textContent === evil));

// Selecting a row adds a chip above the search box and marks the row "(added)"
all(el)
  .find((n) => n.tag === "button" && n.textContent === "Ada")
  .listeners.click();
assert.ok(treeText(el).includes("1 of 20 selected"));
assert.ok(all(el).some((n) => n.tag === "button" && n.textContent === "Ada (added)" && n.disabled === true));
assert.ok(all(el).some((n) => n.tag === "button" && n.attrs["aria-label"] === "Remove Ada"));

// Load more appends next page (offset += 20)
all(el)
  .find((n) => n.tag === "button" && n.textContent === "Load more")
  .listeners.click();
await new Promise((r) => setTimeout(r, 0));
assert.ok(formCalls.includes("/characters?search=&limit=20&offset=20&sort=name-asc"));
assert.ok(all(el).some((n) => n.tag === "button" && n.textContent === "Bob"));

// Removing chip re-enables row
all(el)
  .find((n) => n.tag === "button" && n.attrs["aria-label"] === "Remove Ada")
  .listeners.click();
assert.ok(treeText(el).includes("0 of 20 selected"));
assert.ok(all(el).some((n) => n.tag === "button" && n.textContent === "Ada" && !n.disabled));

// Submitting the New story form posts default settings and keeps <style> injected once
const titleInput = all(el).find((n) => n.tag === "input" && n.attrs.placeholder === "Story title");
titleInput.value = "New Harbor";
await all(el)
  .find((n) => n.tag === "form")
  .listeners.submit({ preventDefault() {} });
assert.deepEqual(postedStory?.settings, {
  twists: "rare",
  presetName: "",
  presetText: "",
  intro: "",
  checker: true,
  minScore: 7,
  maxRetries: 2,
});
const stylesAfter = all(el).filter((n) => n.tag === "style");
assert.equal(stylesAfter.length, 1);
assert.equal(stylesAfter[0], initialStyle[0]);

console.log("story-writer bookshelf ok");
