import assert from "node:assert/strict";
import {
  agentMessages,
  applyMacros,
  parseRewrite,
  trackerNotes,
  buildWriterMessages,
  cardFields,
  chapterId,
  checkMessages,
  critiqueText,
  JobRunner,
  needsRetry,
  parseCheck,
  parseStep,
  stepMessages,
  storyView,
  writeChapter,
} from "../packages/story-writer/pipeline.mjs";
import { PACKAGE_ID, planId, writePlan } from "../packages/story-writer/plan.mjs";

function makeDocuments() {
  const store = new Map();
  return {
    store,
    async list(pkg, kind) {
      assert.equal(pkg, PACKAGE_ID);
      return [...store.values()].filter((d) => d.kind === kind);
    },
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
    async remove(pkg, id, expectedRevision) {
      assert.equal(pkg, PACKAGE_ID);
      const cur = store.get(id);
      if (!cur || cur.revision !== expectedRevision) return false;
      return store.delete(id);
    },
  };
}

function makeLlm(script) {
  const calls = [];
  let idx = 0;
  return {
    calls,
    async complete(messages, opts = {}) {
      calls.push({ messages, opts });
      const item = script[idx++];
      if (typeof item === "function") return item(messages, opts);
      if (item instanceof Error) throw item;
      return String(item ?? "");
    },
  };
}

const fakeResources = {
  async listCharacters(ids = []) {
    return ids.map((id) => ({
      id,
      data: JSON.stringify({
        name: `Char_${id}`,
        description: `Desc_${id}`,
        personality: `Pers_${id}`,
        scenario: `Scen_${id}`,
      }),
      comment: "",
    }));
  },
  async listEligibleLorebookEntries({ lorebookIds = [], entryIds = [] }) {
    assert.ok(Array.isArray(entryIds));
    return lorebookIds.map((id) => ({
      id: `entry_${id}`,
      lorebookId: id,
      lorebookName: `Book_${id}`,
      name: `Lore_${id}`,
      content: `LoreContent_${id}`,
      description: "",
    }));
  },
};

async function seedStory(documents, id, planData, storyOverrides = {}) {
  const data = {
    title: "Test Story",
    premise: "PREMISE_MARK",
    characterIds: ["c1"],
    lorebookIds: ["l1"],
    connectionId: null,
    chapterCount: 0,
    createdAt: "2026-10-22T00:00:00.000Z",
    ...storyOverrides,
  };
  await documents.create({
    id,
    packageId: PACKAGE_ID,
    kind: "story",
    name: data.title,
    description: "Story",
    data,
    createdAt: data.createdAt,
    updatedAt: data.createdAt,
  });
  if (planData) await writePlan(documents, id, planData, null, "2026-10-22T00:00:00.000Z");
  return { id, ...data };
}

// cardFields handles object and JSON string defensively
assert.deepEqual(cardFields({ data: '{"name":"Alice","description":"Brave"}' }), {
  name: "Alice",
  description: "Brave",
  personality: "",
  scenario: "",
  examples: "",
});
assert.deepEqual(cardFields(null), { name: "", description: "", personality: "", scenario: "", examples: "" });
// long descriptions are no longer cut at 1500 chars, and example dialogue is kept
assert.equal(cardFields({ data: { name: "Bo", description: "x".repeat(6000), mes_example: "hi" } }).description.length, 6000);
assert.equal(cardFields({ data: { data: { name: "Bo", mes_example: "hi" } } }).examples, "hi");

// settings: restraint rule, preset text, opening only for chapter 1, summary of cards
{
  const base = { story: { title: "T", premise: "P" }, plan: { beat: "B" }, characters: [{ data: { name: "Bo", mes_example: "Bo: hi" } }] };
  const sys = (o) => buildWriterMessages({ ...base, n: 1, previousChapters: [], ...o })[0].content;
  assert.ok(sys({}).includes("Do not invent twists"));
  assert.ok(sys({ story: { ...base.story, settings: { twists: "none" } } }).includes("Ordinary events only"));
  assert.ok(sys({ story: { ...base.story, settings: { twists: "free" } } }).includes("may let the story surprise"));
  assert.ok(sys({}).includes("Example dialogue"));
  const withSettings = { ...base.story, settings: { presetName: "Plain", presetText: "STYLE_GUIDE_X", intro: "OPENING_X" } };
  assert.ok(sys({ story: withSettings }).includes("STYLE_GUIDE_X"));
  assert.ok(sys({ story: withSettings }).includes("OPENING_X"));
  const macro = { ...base.story, settings: { presetName: "RP", presetText: "{{char}} talks to {{USER}}. {{random}}" } };
  assert.ok(sys({ story: macro }).includes("Bo talks to the reader. {{random}}"));
  assert.ok(sys({ story: macro }).includes("used here for a prose story"));
  assert.equal(applyMacros("{{ Char }}", { char: "A", user: "B" }), "A");
  assert.ok(!sys({ story: withSettings, n: 2, previousChapters: [{ n: 1, text: "t", summary: "s" }] }).includes("OPENING_X"));
  assert.ok(sys({}).includes("do not force a cliffhanger"));
  assert.ok(stepMessages({ plan: {}, chapterText: "", twists: "none" })[0].content.includes("no twist or reveal"));
  assert.ok(!stepMessages({ plan: {}, chapterText: "", twists: "free" })[0].content.includes("Surprise level"));
}

// parseCheck / needsRetry / critiqueText / parseStep unit checks
assert.equal(parseCheck("bad"), null);
assert.equal(parseCheck({ scores: { inCharacter: "x", plausibility: 5 } }), null);
assert.deepEqual(parseCheck({ scores: { inCharacter: 12, plausibility: -2 }, issues: [{ character: "Bob", problem: "OOC" }] }), {
  inCharacter: 10,
  plausibility: 0,
  issues: [{ character: "Bob", problem: "OOC" }],
});
assert.equal(needsRetry(null), false);
assert.equal(needsRetry({ inCharacter: 7, plausibility: 8 }, 7), false);
assert.equal(needsRetry({ inCharacter: 6, plausibility: 8 }, 7), true);
assert.ok(critiqueText({ inCharacter: 5, plausibility: 8, issues: [{ character: "Bob", problem: "Too rude" }] }).includes("Bob: Too rude"));
assert.equal(parseStep({}), null);
assert.equal(checkMessages({ characters: [{ data: { name: "Alice" } }], chapterText: "Hi" }).length, 2);
assert.equal(stepMessages({ plan: { beat: "B" }, chapterText: "Hi", n: 1 }).length, 2);

// History cap in buildWriterMessages drops oldest summaries first while keeping the last chapter full text
{
  const bigSummary = "S".repeat(10000);
  const msgs = buildWriterMessages({
    story: { title: "Cap Test" },
    plan: { beat: "Continue." },
    previousChapters: [
      { n: 1, summary: `OLDEST_DROPPED_${bigSummary}`, text: "t1" },
      { n: 2, summary: `SECOND_DROPPED_${bigSummary}`, text: "t2" },
      { n: 3, summary: "KEPT_RECENT_SUMMARY", text: "t3" },
      { n: 4, summary: "s4", text: `LAST_FULL_${"T".repeat(12000)}` },
    ],
    n: 5,
  });
  assert.ok(!msgs[0].content.includes("OLDEST_DROPPED_"));
  assert.ok(msgs[0].content.includes("KEPT_RECENT_SUMMARY"));
  assert.ok(msgs[0].content.includes("LAST_FULL_"));
}

// (1) Happy path
{
  const documents = makeDocuments();
  const story = await seedStory(documents, "story:1", {
    premise: "P",
    outline: ["O1"],
    secrets: ["S1"],
    twists: [{ text: "TW1", reveal: "ch 3" }],
    offscreen: ["OF1"],
    threads: ["TH1"],
    beat: "Beat one happens.",
    chapter: 0,
    style: { chapterWords: 1200, pointOfView: "first person", tense: "past" },
  });
  const llm = makeLlm([
    "```markdown\nThe lantern flickered in the fog. She stepped onto the pier.\n```",
    JSON.stringify({ scores: { inCharacter: 9, plausibility: 8 }, issues: [] }),
    JSON.stringify({
      title: "Fog on the Pier",
      summary: "She arrived at the pier and discovered the secret key.",
      blurb: "A foggy night at the harbor sets the search in motion.",
      threads: ["TH1", "TH2"],
      beat: "Beat two next.",
    }),
  ]);
  const statuses = [];
  const ch = await writeChapter({
    story,
    deps: { documents, resources: fakeResources, llm, parseJsonish: JSON.parse, now: () => "2026-10-22T01:00:00.000Z" },
    onStatus: (s) => statuses.push(s),
  });
  assert.deepEqual(statuses, ["writing", "checking", "planning"]);
  assert.equal(ch.n, 1);
  assert.equal(ch.title, "Fog on the Pier");
  assert.equal(ch.summary, "She arrived at the pier and discovered the secret key.");
  assert.equal(ch.blurb, "A foggy night at the harbor sets the search in motion.");
  assert.equal(ch.text, "The lantern flickered in the fog. She stepped onto the pier.");
  assert.deepEqual(ch.scores, { inCharacter: 9, plausibility: 8 });
  assert.equal(ch.attempts, 1);

  const savedCh = await documents.getById(PACKAGE_ID, chapterId("story:1", 1));
  assert.equal(savedCh.data.title, "Fog on the Pier");
  assert.equal(savedCh.data.summary, "She arrived at the pier and discovered the secret key.");
  assert.equal(savedCh.data.blurb, "A foggy night at the harbor sets the search in motion.");

  const savedStory = await documents.getById(PACKAGE_ID, "story:1");
  assert.equal(savedStory.data.chapterCount, 1);
  assert.equal(story.chapterCount, 1);

  const savedPlan = await documents.getById(PACKAGE_ID, planId("story:1"));
  assert.equal(savedPlan.data.beat, "Beat two next.");
  assert.equal(savedPlan.data.chapter, 1);
  assert.deepEqual(savedPlan.data.threads, ["TH1", "TH2"]);
  assert.deepEqual(savedPlan.data.secrets, ["S1"]);
}

// (2) Low check score triggers ONE regeneration; second writer call has critique; higher-scoring attempt kept
{
  const documents = makeDocuments();
  const story = await seedStory(documents, "story:2", { beat: "Open the vault." });
  const llm = makeLlm([
    "First draft with out-of-character dialogue.",
    JSON.stringify({
      scores: { inCharacter: 5, plausibility: 8 },
      issues: [{ character: "Char_c1", problem: "Uses modern slang" }],
    }),
    "Second draft in proper voice.",
    JSON.stringify({ scores: { inCharacter: 9, plausibility: 9 }, issues: [] }),
    JSON.stringify({ title: "The Vault", summary: "Internal summary.", blurb: "Teaser blurb.", beat: "Escape." }),
  ]);
  const ch = await writeChapter({
    story,
    deps: { documents, resources: fakeResources, llm, parseJsonish: JSON.parse },
  });
  assert.equal(ch.attempts, 2);
  assert.equal(ch.text, "Second draft in proper voice.");
  assert.deepEqual(ch.scores, { inCharacter: 9, plausibility: 9 });
  // Calls: 0=write1, 1=check1, 2=write2, 3=check2, 4=step
  assert.equal(llm.calls.length, 5);
  assert.ok(llm.calls[2].messages[1].content.includes("Fix these problems from the previous attempt:"));
  assert.ok(llm.calls[2].messages[1].content.includes("Char_c1: Uses modern slang"));

  // Also verify higher-scoring first attempt is kept when second attempt scores even lower
  const documents2 = makeDocuments();
  const story2 = await seedStory(documents2, "story:2b", { beat: "Try again." });
  const llm2 = makeLlm([
    "Attempt one (better).",
    JSON.stringify({ scores: { inCharacter: 6, plausibility: 6 }, issues: [{ character: null, problem: "Weak" }] }),
    "Attempt two (worse).",
    JSON.stringify({ scores: { inCharacter: 3, plausibility: 4 }, issues: [{ character: null, problem: "Worse" }] }),
    JSON.stringify({ title: "Kept Best", summary: "S.", blurb: "B.", beat: "Next." }),
  ]);
  const ch2 = await writeChapter({
    story: story2,
    maxRetries: 1,
    deps: { documents: documents2, resources: fakeResources, llm: llm2, parseJsonish: JSON.parse },
  });
  assert.equal(ch2.text, "Attempt one (better).");
  assert.deepEqual(ch2.scores, { inCharacter: 6, plausibility: 6 });
}

// (3) maxRetries bound: always-low scores with maxRetries=2 -> exactly 3 writer calls
{
  const documents = makeDocuments();
  const story = await seedStory(documents, "story:3", { beat: "Hold the line." });
  const lowCheck = JSON.stringify({
    scores: { inCharacter: 3, plausibility: 3 },
    issues: [{ character: "Char_c1", problem: "Still wrong" }],
  });
  const llm = makeLlm([
    "Draft 1.",
    lowCheck,
    "Draft 2.",
    lowCheck,
    "Draft 3.",
    lowCheck,
    JSON.stringify({ title: "Three Tries", summary: "Summary.", blurb: "Blurb.", beat: "Next." }),
  ]);
  const ch = await writeChapter({
    story,
    maxRetries: 2,
    deps: { documents, resources: fakeResources, llm, parseJsonish: JSON.parse },
  });
  const writerCalls = llm.calls.filter((c) => c.messages[1].content.startsWith("Write chapter 1."));
  assert.equal(writerCalls.length, 3);
  assert.equal(ch.attempts, 3);
}

// (4) Checker call throws or returns invalid JSON -> chapter still saved, no retry
{
  for (const brokenChecker of [new Error("checker offline"), "not valid json {{{"]) {
    const documents = makeDocuments();
    const story = await seedStory(documents, "story:4", { beat: "Cross the bridge." });
    const llm = makeLlm([
      "The bridge groaned under the wind. They crossed before dawn.",
      brokenChecker,
      JSON.stringify({ title: "The Bridge", summary: "They crossed.", blurb: "A perilous crossing.", beat: "Camp." }),
    ]);
    const ch = await writeChapter({
      story,
      deps: { documents, resources: fakeResources, llm, parseJsonish: JSON.parse },
    });
    assert.equal(ch.attempts, 1);
    assert.equal(ch.scores, null);
    assert.equal(ch.title, "The Bridge");
    assert.equal(llm.calls.length, 3);
  }
}

// (5) Step call fails -> chapter saved with fallback title "Chapter 1", old plan kept
{
  const documents = makeDocuments();
  const story = await seedStory(documents, "story:5", {
    premise: "P",
    secrets: ["KEEP_SECRET"],
    beat: "KEEP_BEAT",
    chapter: 0,
  });
  const llm = makeLlm([
    "First sentence happened here. Second sentence closed the scene. Third sentence trailed off.",
    JSON.stringify({ scores: { inCharacter: 9, plausibility: 9 }, issues: [] }),
    new Error("step model timeout"),
  ]);
  const ch = await writeChapter({
    story,
    deps: { documents, resources: fakeResources, llm, parseJsonish: JSON.parse },
  });
  assert.equal(ch.title, "Chapter 1");
  assert.equal(ch.blurb, "");
  assert.ok(ch.summary.includes("First sentence happened here."));
  const savedPlan = await documents.getById(PACKAGE_ID, planId("story:5"));
  assert.equal(savedPlan.data.beat, "KEEP_BEAT");
  assert.equal(savedPlan.data.chapter, 0);
  assert.deepEqual(savedPlan.data.secrets, ["KEEP_SECRET"]);
}

// (6) Leak test + history formatting + step receives plan markers
{
  const documents = makeDocuments();
  const planData = {
    premise: "PLAN_PREMISE_SECRET_MARK",
    outline: ["OUTLINE_SECRET_MARK"],
    secrets: ["HIDDEN_SECRET_MARK"],
    twists: [{ text: "TWIST_SECRET_MARK", reveal: "REVEAL_SECRET_MARK" }],
    offscreen: ["OFFSCREEN_SECRET_MARK"],
    threads: ["THREAD_SECRET_MARK"],
    beat: "BEAT_VISIBLE_MARKER",
    chapter: 2,
    style: { chapterWords: 1750, pointOfView: "third person omniscient", tense: "present" },
  };
  const story = await seedStory(documents, "story:6", planData, {
    premise: "STORY_PREMISE_MARK",
    chapterCount: 2,
  });
  await documents.create({
    id: chapterId("story:6", 1),
    packageId: PACKAGE_ID,
    kind: "chapter",
    name: "Ch 1",
    description: "",
    data: {
      storyId: "story:6",
      n: 1,
      title: "Ch 1",
      text: "CH1_FULL_TEXT_MUST_NOT_APPEAR",
      summary: "CH1_INTERNAL_SUMMARY_MARKER",
      blurb: "CH1_BLURB_MARKER",
      scores: null,
      attempts: 1,
      createdAt: "2026-10-22T00:00:00.000Z",
    },
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
  });
  await documents.create({
    id: chapterId("story:6", 2),
    packageId: PACKAGE_ID,
    kind: "chapter",
    name: "Ch 2",
    description: "",
    data: {
      storyId: "story:6",
      n: 2,
      title: "Ch 2",
      text: "CH2_FULL_TEXT_MARKER",
      summary: "CH2_SUMMARY_MUST_NOT_REPLACE_FULL_TEXT",
      blurb: "CH2_BLURB_MARKER",
      scores: null,
      attempts: 1,
      createdAt: "2026-10-22T00:00:00.000Z",
    },
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
  });

  const llm = makeLlm([
    "Chapter three prose.",
    JSON.stringify({ scores: { inCharacter: 9, plausibility: 9 }, issues: [] }),
    JSON.stringify({ title: "Ch 3", summary: "S3", blurb: "B3", beat: "Next beat" }),
  ]);
  await writeChapter({
    story,
    nudge: "Include rain.",
    deps: { documents, resources: fakeResources, llm, parseJsonish: JSON.parse },
  });

  const writerDump = JSON.stringify(llm.calls[0].messages);
  const forbidden = [
    "PLAN_PREMISE_SECRET_MARK",
    "OUTLINE_SECRET_MARK",
    "HIDDEN_SECRET_MARK",
    "TWIST_SECRET_MARK",
    "REVEAL_SECRET_MARK",
    "OFFSCREEN_SECRET_MARK",
    "THREAD_SECRET_MARK",
    "CH1_FULL_TEXT_MUST_NOT_APPEAR",
    "CH2_SUMMARY_MUST_NOT_REPLACE_FULL_TEXT",
  ];
  for (const m of forbidden) assert.ok(!writerDump.includes(m), `writer leaked ${m}`);
  for (const required of [
    "BEAT_VISIBLE_MARKER",
    "STORY_PREMISE_MARK",
    "1750",
    "third person omniscient",
    "present",
    "CH1_INTERNAL_SUMMARY_MARKER",
    "CH2_FULL_TEXT_MARKER",
    "Write chapter 3.",
    "Reader's note for this chapter: Include rain.",
  ]) {
    assert.ok(writerDump.includes(required), `writer missing ${required}`);
  }

  const stepDump = JSON.stringify(llm.calls[2].messages);
  for (const m of [
    "PLAN_PREMISE_SECRET_MARK",
    "OUTLINE_SECRET_MARK",
    "HIDDEN_SECRET_MARK",
    "TWIST_SECRET_MARK",
    "REVEAL_SECRET_MARK",
    "OFFSCREEN_SECRET_MARK",
    "THREAD_SECRET_MARK",
  ]) {
    assert.ok(stepDump.includes(m), `step missing ${m}`);
  }
}

// (7) Style immutable across step update
{
  const documents = makeDocuments();
  const initialStyle = { chapterWords: 1900, pointOfView: "second person", tense: "present" };
  const story = await seedStory(documents, "story:7", {
    beat: "Walk north.",
    style: initialStyle,
  });
  const llm = makeLlm([
    "You walk north into the pines.",
    JSON.stringify({ scores: { inCharacter: 9, plausibility: 9 }, issues: [] }),
    JSON.stringify({
      title: "North",
      summary: "Walked north.",
      blurb: "Into the pines.",
      beat: "Keep walking.",
      style: { chapterWords: 400, pointOfView: "first person", tense: "past" },
    }),
  ]);
  await writeChapter({
    story,
    deps: { documents, resources: fakeResources, llm, parseJsonish: JSON.parse },
  });
  const savedPlan = await documents.getById(PACKAGE_ID, planId("story:7"));
  assert.deepEqual(savedPlan.data.style, initialStyle);
}

// (8) JobRunner: sequential count=3, duplicate running throws, cancel mid-run, error handling, count clamping, pruning
{
  let clock = 1_000_000;
  const completed = [];
  const runner = new JobRunner({
    now: () => clock,
    run: async ({ storyId, onStatus }) => {
      onStatus("writing");
      await new Promise((r) => setTimeout(r, 5));
      onStatus("planning");
      completed.push(storyId);
      return { n: completed.length };
    },
  });

  const jobId = runner.start("story:j1", { count: 3 });
  assert.throws(() => runner.start("story:j1", { count: 1 }), /A job is already running for this story/);
  while (runner.get(jobId)?.status === "running") {
    await new Promise((r) => setTimeout(r, 5));
  }
  const finished = runner.get(jobId);
  assert.equal(finished.status, "done");
  assert.equal(finished.done, 3);
  assert.equal(finished.total, 3);

  // Clamp 0 -> 1 and 99 -> 20
  let releaseClamp;
  const gate = new Promise((r) => {
    releaseClamp = r;
  });
  const clampRunner = new JobRunner({
    run: async ({ signal }) => {
      await gate;
      if (signal.aborted) {
        const e = new Error("Aborted");
        e.name = "AbortError";
        throw e;
      }
    },
  });
  const jLow = clampRunner.start("s-low", { count: 0 });
  const jHigh = clampRunner.start("s-high", { count: 99 });
  assert.equal(clampRunner.get(jLow).total, 1);
  assert.equal(clampRunner.get(jHigh).total, 20);
  clampRunner.cancel(jLow);
  clampRunner.cancel(jHigh);
  releaseClamp();

  // Cancel mid-run -> status "cancelled" and fewer chapters done
  let stepResolve;
  let calls = 0;
  const cancelRunner = new JobRunner({
    run: async ({ signal }) => {
      calls++;
      if (calls === 2) {
        await new Promise((r) => {
          stepResolve = r;
        });
      }
      if (signal.aborted) {
        const e = new Error("Aborted");
        e.name = "AbortError";
        throw e;
      }
      return { n: calls };
    },
  });
  const cancelJobId = cancelRunner.start("story:cancel", { count: 4 });
  while (!stepResolve) await new Promise((r) => setTimeout(r, 2));
  assert.equal(cancelRunner.cancel(cancelJobId), true);
  stepResolve();
  await new Promise((r) => setTimeout(r, 10));
  const cancelledJob = cancelRunner.get(cancelJobId);
  assert.equal(cancelledJob.status, "cancelled");
  assert.ok(cancelledJob.done < 4);

  // Error in run -> status "error" with message
  const errRunner = new JobRunner({
    run: async () => {
      throw new Error("boom in model");
    },
  });
  const errJobId = errRunner.start("story:err", { count: 2 });
  while (errRunner.get(errJobId)?.status === "running") {
    await new Promise((r) => setTimeout(r, 2));
  }
  const errJob = errRunner.get(errJobId);
  assert.equal(errJob.status, "error");
  assert.equal(errJob.error, "boom in model");
  assert.equal(errJob.done, 0);

  // Pruned 1 hour after finishedAt
  clock += 3600_001;
  assert.equal(runner.get(jobId), null);
}

// (9) storyView contains blurb and wordCount, and NEVER internal summary or chapter text
{
  const view = storyView(
    {
      id: "story:9",
      title: "The Harbor",
      premise: "Public premise",
      characterIds: ["c1"],
      lorebookIds: ["l1"],
      connectionId: "conn1",
      chapterCount: 1,
    },
    [
      {
        n: 1,
        title: "Arrival",
        text: "SECRET_CHAPTER_BODY_TEXT one two three",
        summary: "SECRET_INTERNAL_SUMMARY_SPOILER",
        blurb: "VISIBLE_SAFE_BLURB",
        scores: { inCharacter: 9, plausibility: 9 },
        attempts: 1,
      },
    ],
  );
  const dump = JSON.stringify(view);
  assert.ok(dump.includes("VISIBLE_SAFE_BLURB"));
  assert.ok(!dump.includes("SECRET_INTERNAL_SUMMARY_SPOILER"));
  assert.ok(!dump.includes("SECRET_CHAPTER_BODY_TEXT"));
  assert.equal(view.chapters[0].wordCount, 4);
  assert.deepEqual(Object.keys(view.chapters[0]).sort(), ["blurb", "n", "title", "wordCount"]);
}

// checker off: one model call for the chapter, one for the plan step, no check call
{
  const documents = makeDocuments();
  const story = await seedStory(documents, "story:nochk", {}, { settings: { checker: false } });
  let calls = 0;
  const llm = { async complete() { calls++; return calls === 1 ? "Chapter text." : '{"title":"T","summary":"s","blurb":"b","beat":"next"}'; } };
  await writeChapter({ story, deps: { documents, resources: {}, llm, parseJsonish: JSON.parse } });
  assert.equal(calls, 2);
}

// agents: rewrite replaces text, fanfic-writer replaces the built-in check, tracker output feeds the next prompt
{
  assert.equal(parseRewrite({ editNeeded: true, editedText: "short" }, "x".repeat(100)), null);
  assert.equal(parseRewrite({ editNeeded: false, editedText: "y".repeat(100) }, "x".repeat(100)), null);
  assert.deepEqual(parseRewrite({ editNeeded: true, editedText: "y".repeat(100), changes: [{ description: "fix" }] }, "x".repeat(100)).changes, ["fix"]);
  const msgs = agentMessages({ prompt: "Min {{minScore}} for {{char}}", kind: "rewrite", minScore: 6 }, { characters: [{ data: { name: "Bo" } }], chapterText: "CH" });
  assert.ok(msgs[0].content.includes("Min 6 for Bo") && msgs[1].content.includes("<assistant_response>\nCH"));
  assert.equal(trackerNotes([{ trackers: { Quest: "Q1" } }]), "Quest:\nQ1");

  const documents = makeDocuments();
  const agents = [
    { type: "fanfic-writer", name: "Fanfic Writer", kind: "rewrite", prompt: "REWRITER" },
    { type: "world-state", name: "World", kind: "tracker", prompt: "TRACKER" },
  ];
  const story = await seedStory(documents, "story:agents", {}, { settings: { agents } });
  const calls = [];
  const llm = {
    async complete(messages) {
      const sys = messages[0].content;
      calls.push(sys.slice(0, 8));
      if (sys.startsWith("REWRITER")) return JSON.stringify({ editNeeded: true, editedText: "EDITED ".repeat(10), changes: [{ description: "ooc" }] });
      if (sys.startsWith("TRACKER")) return '{"place":"inn"}';
      if (sys.includes("hidden author")) return '{"title":"T","summary":"s","blurb":"b","beat":"next"}';
      return "A chapter of reasonable length. ".repeat(4);
    },
  };
  await writeChapter({ story, deps: { documents, resources: {}, llm, parseJsonish: JSON.parse } });
  assert.ok(!calls.some((c) => c.startsWith("You are a")), "built-in checker skipped");
  const ch = (await documents.getById(PACKAGE_ID, chapterId("story:agents", 1))).data;
  assert.ok(ch.text.startsWith("EDITED"));
  assert.deepEqual(ch.trackers, { World: '{"place":"inn"}' });
  assert.deepEqual(ch.agentNotes, ["Fanfic Writer: ooc"]);
}

console.log("story-writer pipeline ok");
