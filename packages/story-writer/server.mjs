import { randomUUID } from "node:crypto";
import { buildEpub, chaptersFromDocs } from "./epub.mjs";
import { chapterId, formatCharacters, formatLorebook, JobRunner, rewindStory, storyView, writeChapter } from "./pipeline.mjs";
import { normalizeOverride, normalizeOverrides, normalizePlan, normalizeSettings, normalizeStyle, PACKAGE_ID, readPlan, writePlan } from "./plan.mjs";

const PLAN_PROMPT = `You are the hidden author of a serial story. From the premise (and any character cards and lore), plan it. Stay faithful to the cards and the premise; if the premise is already an outline, keep its events and their order rather than inventing a new one; plan ordinary, character-driven progress, not shocks. Return ONLY JSON, no prose:
{"outline":["chapter-level beats"],"secrets":["facts the reader does not know yet"],"twists":[{"text":"...","reveal":"chapter hint or null"}],"offscreen":["what characters do out of sight"],"threads":["open plot threads"],"beat":"what happens in chapter 1"}
Keep every item to one sentence, except outline items, which may take two when the premise gives each chapter several beats.`;

const TWIST_PLAN = {
  none: "Leave twists empty and plan no reveals.",
  rare: "Plan at most one twist, and only if the premise implies it; otherwise leave twists empty.",
  free: "Plan up to three twists, each seeded early and revealed late.",
};

// Arcs: the outline is a finite stretch of story. "revise" re-plans the rest of the current arc, "next" starts a fresh one once it is done.
const ARC_PROMPT = {
  revise:
    "You are the hidden author of a serial story. Re-plan the REST of the current arc from where the story stands now: keep everything that already happened, keep the cast and tone, and follow the reader's direction if given. Do not repeat events from the chapter summaries.",
  next: "You are the hidden author of a serial story. The current arc has ended. Plan the NEXT arc as a natural continuation of the chapter summaries: the consequences of what happened, the open threads, and the characters' new goals. Do not repeat or undo earlier events, and do not wrap the story up.",
};
const ARC_SHAPE = `Return ONLY JSON, no prose:
{"outline":["chapter-level beats of this arc, about 8-12"],"secrets":["facts the reader does not know yet"],"twists":[{"text":"...","reveal":"chapter hint or null"}],"offscreen":["what characters do out of sight"],"threads":["open plot threads"],"beat":"what happens in the next chapter"}
Keep every item to one sentence, except outline items, which may take two.`;

// Premises up to this length go to the writer as they are; longer ones (often a whole outline) are condensed once.
const BRIEF_THRESHOLD = 1500;
const BRIEF_PROMPT = `You condense a story premise or outline into a brief that the author reads before writing every chapter. Keep: the setting and tone, who the main characters are and how they relate, and every rule, constraint, style note and anything marked as must or never, close to the reader's own wording. If the premise plans the story chapter by chapter, keep that plan as a numbered list with each chapter's key beats. Drop only repetition and flourish. Up to about 1000 words, plain text, no preamble.`;

const TIMEOUT_MESSAGE =
  "The model call timed out. Raise AGENT_CALL_TIMEOUT_MS in the Engine .env or lower the chapter length.";

const validIdArray = (v) =>
  Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === "string" && x.trim().length >= 1 && x.trim().length <= 100);

// Shared by create and the setup editor: the fields fixed at creation.
const setupError = (body) => {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 200) return "Title must be 1-200 characters";
  if (body.premise !== undefined && body.premise !== null && (typeof body.premise !== "string" || body.premise.trim().length > 20000)) return "Premise must be at most 20000 characters";
  if (body.characterIds !== undefined && !validIdArray(body.characterIds)) return "characterIds must be at most 20 strings of 1-100 characters";
  if (body.lorebookIds !== undefined && !validIdArray(body.lorebookIds)) return "lorebookIds must be at most 20 strings of 1-100 characters";
  if (body.connectionId !== undefined && body.connectionId !== null && (typeof body.connectionId !== "string" || body.connectionId.length > 200)) return "connectionId must be a string or null";
  return null;
};
const cleanSetup = (body) => ({
  title: body.title.trim(),
  premise: typeof body.premise === "string" ? body.premise.trim() : "",
  characterIds: Array.isArray(body.characterIds) ? body.characterIds.map((x) => x.trim()) : [],
  lorebookIds: Array.isArray(body.lorebookIds) ? body.lorebookIds.map((x) => x.trim()) : [],
  connectionId: typeof body.connectionId === "string" ? body.connectionId.trim() || null : null,
});

export async function activate({ api }) {
  const { persistence, languageModels, resources, json } = api.runtime;
  const { documents } = persistence;
  const cleanups = [];

  const makeLlm = (story) => ({
    async complete(messages, { temperature, maxTokens, signal }) {
      try {
        const model = await languageModels.resolveForRequest({ connectionId: story.connectionId ?? undefined });
        const r = await model.chatComplete(messages, {
          temperature,
          maxTokens: Math.min(maxTokens, model.maxOutputTokens ?? maxTokens),
          signal,
        });
        return r.content ?? "";
      } catch (error) {
        const msg = String(error?.message ?? error);
        if (!signal?.aborted && (/timed?\s*out/i.test(msg) || error?.name === "TimeoutError" || error?.name === "AbortError")) {
          throw new Error(TIMEOUT_MESSAGE);
        }
        throw error;
      }
    },
  });

  const jobs = new JobRunner({
    run: async ({ storyId, nudge, onStatus, signal }) => {
      const doc = await documents.getById(PACKAGE_ID, storyId);
      if (!doc || doc.kind !== "story") throw new Error("Story not found");
      const loadedStory = { ...(doc.data && typeof doc.data === "object" ? doc.data : {}), id: doc.id };
      return writeChapter({
        story: loadedStory,
        deps: {
          documents,
          resources,
          llm: makeLlm(loadedStory),
          parseJsonish: (raw) => json.parseJsonish(raw),
        },
        nudge,
        onStatus,
        signal,
      });
    },
  });

  const docStory = async (request, reply) => {
    const doc = await documents.getById(PACKAGE_ID, request.params.id);
    if (!doc || doc.kind !== "story") return void reply.code(404).send({ error: "Story not found" });
    return doc;
  };

  const loadChapters = async (doc) => {
    const count = Number.isInteger(doc.data?.chapterCount) ? doc.data.chapterCount : 0;
    const chapters = [];
    for (let n = 1; n <= count; n++) {
      const ch = await documents.getById(PACKAGE_ID, chapterId(doc.id, n));
      if (ch?.data) chapters.push(ch.data);
    }
    return chapters;
  };

  // Cards and lore ground the plan, otherwise it invents its own cast and the writer follows that.
  const planContext = async (story, premise) => {
    const safe = async (fn) => {
      try {
        return (await fn()) ?? [];
      } catch {
        return [];
      }
    };
    const cards = story.characterIds?.length ? formatCharacters(await safe(() => resources.listCharacters(story.characterIds))) : "";
    const lore = story.lorebookIds?.length
      ? formatLorebook(await safe(() => resources.listEligibleLorebookEntries({ lorebookIds: story.lorebookIds, entryIds: [] })))
      : "";
    const intro = normalizeSettings(story.settings).intro;
    return [
      `Premise:\n${premise}`,
      cards && `Character cards (canon):\n${cards}`,
      lore && `Lorebook (canon):\n${lore}`,
      intro && `Opening scene:\n${intro}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  };

  // A failed condensing call is not worth failing the plan over: the writer falls back to the raw premise.
  const makeBrief = async (premise, connectionId) => {
    if (premise.length <= BRIEF_THRESHOLD) return "";
    try {
      const model = await languageModels.resolveForRequest({ connectionId: connectionId ?? undefined });
      const out = await model.chatComplete([{ role: "system", content: BRIEF_PROMPT }, { role: "user", content: premise }], { temperature: 0.2, maxTokens: 1500 });
      return String(out.content ?? "").trim().slice(0, 10000);
    } catch {
      return "";
    }
  };

  const createPlan = async ({ storyId, premise, style, connectionId, story = {} }) => {
    const cleanPremise = typeof premise === "string" ? premise.trim().slice(0, 20000) : "";
    const existing = await readPlan(documents, storyId);
    const nextStyle = normalizeStyle(style ?? existing?.data?.style);
    // No premise: store just the chapter style, no model call.
    if (!cleanPremise) {
      return writePlan(documents, storyId, normalizePlan({ ...existing?.data, style: nextStyle }), existing?.revision ?? null);
    }
    const model = await languageModels.resolveForRequest({
      connectionId: connectionId ?? undefined,
    });
    const out = await model.chatComplete(
      [{ role: "system", content: `${PLAN_PROMPT}\n${TWIST_PLAN[normalizeSettings(story.settings).twists]}` }, { role: "user", content: await planContext(story, cleanPremise) }],
      { temperature: 0.8, maxTokens: 2000 },
    );
    const brief = await makeBrief(cleanPremise, connectionId);
    const plan = normalizePlan({ ...json.parseJsonish(out.content ?? ""), premise: cleanPremise, brief, style: nextStyle });
    return writePlan(documents, storyId, plan, existing?.revision ?? null);
  };

  const view = (doc) => ({ plan: doc ? normalizePlan(doc.data) : null, revision: doc?.revision ?? null });
  const getPlan = async (storyId) => view(await readPlan(documents, storyId));
  const putPlan = async (storyId, request, reply) => {
    const existing = await readPlan(documents, storyId);
    const { chapter, arc } = normalizePlan(existing?.data);
    const plan = { ...normalizePlan(request.body?.plan), chapter, arc };
    const saved = await writePlan(documents, storyId, plan, Number.isInteger(request.body?.revision) ? request.body.revision : -1);
    return saved ? view(saved) : reply.code(409).send({ error: "The plan changed; reload it and try again" });
  };
  const postPlan = async (doc, request, reply) => {
    const premise = typeof request.body?.premise === "string" ? request.body.premise.trim().slice(0, 20000) : "";
    if (!premise && !request.body?.style) return reply.code(400).send({ error: "A premise is required" });
    try {
      return view(await createPlan({ storyId: doc.id, premise, style: request.body?.style, connectionId: doc.data?.connectionId ?? null, story: doc.data }));
    } catch (error) {
      return reply.code(502).send({ error: `Could not generate the plan: ${error?.message ?? error}` });
    }
  };

  const reviseArc = async (doc, mode, direction) => {
    const existing = await readPlan(documents, doc.id);
    const cur = normalizePlan(existing?.data);
    const chapters = await loadChapters(doc);
    // Newest summaries win when the story is long.
    let summaries = "";
    for (let i = chapters.length - 1; i >= 0; i--) {
      const line = `Chapter ${chapters[i].n ?? i + 1}: ${chapters[i].summary ?? ""}\n`;
      if (summaries.length + line.length > 12000) break;
      summaries = line + summaries;
    }
    const { arc: _arc, chapter: _ch, style: _st, updatedAt: _u, ...hidden } = cur;
    const model = await languageModels.resolveForRequest({ connectionId: doc.data?.connectionId ?? undefined });
    const out = await model.chatComplete(
      [
        { role: "system", content: `${ARC_PROMPT[mode]}\n${TWIST_PLAN[normalizeSettings(doc.data?.settings, cur.style).twists]}\n${ARC_SHAPE}` },
        {
          role: "user",
          content: [
            await planContext(doc.data ?? {}, cur.premise || doc.data?.premise || ""),
            `Chapters so far (${chapters.length}):\n${summaries || "None yet."}`,
            `Current plan (arc ${cur.arc}):\n${JSON.stringify(hidden)}`,
            direction && `Reader's direction:\n${direction}`,
          ].filter(Boolean).join("\n\n"),
        },
      ],
      { temperature: 0.8, maxTokens: 2500 },
    );
    const parsed = json.parseJsonish(out.content ?? "");
    if (!Array.isArray(parsed?.outline) || typeof parsed?.beat !== "string") throw new Error("The model did not return an arc plan");
    const next = normalizePlan({ ...cur, ...parsed, arc: mode === "next" ? cur.arc + 1 : cur.arc });
    return view(await writePlan(documents, doc.id, next, existing?.revision ?? null));
  };

  const cleanupRoutes = await api.registerPrivilegedRoutes(
    async (app) => {
      app.get("/epub/:id", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        const chapters = chaptersFromDocs(await loadChapters(doc));
        if (!chapters.length) return reply.code(409).send({ error: "This story has no chapters yet" });
        const title = doc.data?.title || doc.name || "Story";
        const ascii = title.replace(/[^A-Za-z0-9._ -]/g, "_").trim() || "story";
        const utf8 = encodeURIComponent(title).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        return reply
          .header("Content-Type", "application/epub+zip")
          .header("Content-Disposition", `attachment; filename="${ascii}.epub"; filename*=UTF-8''${utf8}.epub`)
          .send(buildEpub({ id: doc.id, title, chapters }));
      });

      app.get("/stories", async () => {
        // shortcut: list returns full docs, fine at personal-library scale; upgrade to an index doc if stories pass ~hundreds
        const docs = await documents.list(PACKAGE_ID, "story");
        return docs
          .map((doc) => {
            const d = doc.data && typeof doc.data === "object" ? doc.data : {};
            const item = {
              id: doc.id,
              title: d.title ?? doc.name,
              chapterCount: Number.isInteger(d.chapterCount) ? d.chapterCount : 0,
              createdAt: d.createdAt ?? doc.createdAt,
            };
            if (d.lastChapterAt) item.lastChapterAt = d.lastChapterAt;
            return item;
          })
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      });

      app.post("/stories", async (request, reply) => {
        const body = request.body && typeof request.body === "object" ? request.body : {};
        const bad = setupError(body);
        if (bad) return reply.code(400).send({ error: bad });

        const settings = normalizeSettings(body.settings);
        const id = `story:${randomUUID()}`;
        const createdAt = new Date().toISOString();
        const { title, premise, characterIds, lorebookIds, connectionId } = cleanSetup(body);

        await documents.create({
          id,
          packageId: PACKAGE_ID,
          kind: "story",
          name: title,
          description: "Story Writer story.",
          data: { title, premise, characterIds, lorebookIds, connectionId, settings, chapterCount: 0, createdAt },
          createdAt,
          updatedAt: createdAt,
        });

        try {
          await createPlan({ storyId: id, premise, style: body.style ?? settings, connectionId, story: { characterIds, lorebookIds, settings } });
          return reply.code(201).send({ id });
        } catch (error) {
          return reply.code(201).send({ id, planError: error?.message ?? String(error) });
        }
      });

      // Changing the cast or premise does not re-plan the story; the hidden plan keeps what it had until the reader revises it.
      app.put("/stories/:id/setup", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        const body = request.body && typeof request.body === "object" ? request.body : {};
        const bad = setupError(body);
        if (bad) return reply.code(400).send({ error: bad });
        const setup = cleanSetup(body);
        const planDoc = await readPlan(documents, doc.id);
        const cur = normalizeSettings(doc.data?.settings, planDoc?.data?.style);
        const settings = normalizeSettings({ ...cur, presetName: body.presetName ?? cur.presetName, presetText: body.presetText ?? cur.presetText }, planDoc?.data?.style);
        await documents.update({ id: doc.id, packageId: PACKAGE_ID, name: setup.title, description: doc.description, data: { ...doc.data, ...setup, settings }, updatedAt: new Date().toISOString(), expectedRevision: doc.revision });
        if (planDoc) {
          const changed = setup.premise !== planDoc.data?.premise;
          const brief = changed ? await makeBrief(setup.premise, setup.connectionId) : planDoc.data?.brief;
          await writePlan(documents, doc.id, { ...planDoc.data, premise: setup.premise, brief }, planDoc.revision);
        }
        return { ok: true };
      });

      app.put("/stories/:id/settings", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        const settings = normalizeSettings(request.body);
        await documents.update({ id: doc.id, packageId: PACKAGE_ID, name: doc.name, description: doc.description, data: { ...doc.data, settings }, updatedAt: new Date().toISOString(), expectedRevision: doc.revision });
        return { settings };
      });

      app.put("/stories/:id/overrides/:n", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        const n = Number(request.params.n);
        const count = Number.isInteger(doc.data?.chapterCount) ? doc.data.chapterCount : 0;
        if (!Number.isInteger(n) || n <= count || n > 9999) return reply.code(400).send({ error: "Overrides can only be set for chapters not written yet" });
        // Past chapters' overrides are dead weight, so they are dropped on every save.
        const kept = Object.fromEntries(Object.entries(normalizeOverrides(doc.data?.chapterOverrides)).filter(([k]) => Number(k) > count));
        delete kept[n];
        const override = normalizeOverride(request.body);
        if (Object.keys(override).length) kept[n] = override;
        await documents.update({ id: doc.id, packageId: PACKAGE_ID, name: doc.name, description: doc.description, data: { ...doc.data, chapterOverrides: kept }, updatedAt: new Date().toISOString(), expectedRevision: doc.revision });
        return { chapterOverrides: kept };
      });

      app.post("/stories/:id/rewind/:n", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        if (jobs.isRunning(doc.id)) return reply.code(409).send({ error: "A job is already running for this story" });
        const note = typeof request.body?.note === "string" ? request.body.note.trim().slice(0, 500) : "";
        try {
          const total = await rewindStory(documents, doc.id, Number(request.params.n));
          return { jobId: jobs.start(doc.id, { count: total, nudge: note || undefined }), total };
        } catch (error) {
          return reply.code(409).send({ error: error?.message ?? String(error) });
        }
      });

      // Summaries can hold reveals, so they only go out for chapters the reader says they have read.
      app.get("/stories/:id/recap", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        const upTo = Math.max(0, Math.trunc(Number(request.query?.upTo) || 0));
        const chapters = (await loadChapters(doc)).filter((c) => c.n <= upTo);
        const last = chapters.at(-1);
        return {
          summaries: chapters.map((c) => ({ n: c.n, title: c.title, summary: c.summary ?? "" })),
          trackers: last?.trackers && typeof last.trackers === "object" ? last.trackers : {},
        };
      });

      app.post("/stories/:id/arc", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        const mode = request.body?.mode;
        if (mode !== "revise" && mode !== "next") return reply.code(400).send({ error: "mode must be revise or next" });
        const direction = typeof request.body?.direction === "string" ? request.body.direction.trim().slice(0, 1000) : "";
        if (jobs.isRunning(doc.id)) return reply.code(409).send({ error: "A job is already running for this story" });
        try {
          return await reviseArc(doc, mode, direction);
        } catch (error) {
          return reply.code(502).send({ error: `Could not plan the arc: ${error?.message ?? error}` });
        }
      });

      app.get("/stories/:id", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        return storyView(doc, await loadChapters(doc), normalizePlan((await readPlan(documents, doc.id))?.data).style);
      });

      app.get("/stories/:id/chapters/:n", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        const n = Number(request.params.n);
        if (!Number.isInteger(n) || n < 1 || String(n) !== String(request.params.n)) {
          return reply.code(404).send({ error: "Chapter not found" });
        }
        const ch = await documents.getById(PACKAGE_ID, chapterId(doc.id, n));
        if (!ch || ch.kind !== "chapter" || !ch.data) return reply.code(404).send({ error: "Chapter not found" });
        return {
          n: ch.data.n ?? n,
          title: ch.data.title ?? `Chapter ${n}`,
          text: ch.data.text ?? "",
          blurb: ch.data.blurb ?? "",
        };
      });

      app.delete("/stories/:id", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        const count = Number.isInteger(doc.data?.chapterCount) ? doc.data.chapterCount : 0;
        for (let n = 1; n <= count; n++) {
          const ch = await documents.getById(PACKAGE_ID, chapterId(doc.id, n));
          if (ch) await documents.remove(PACKAGE_ID, ch.id, ch.revision);
        }
        const planDoc = await readPlan(documents, doc.id);
        if (planDoc) await documents.remove(PACKAGE_ID, planDoc.id, planDoc.revision);
        const curStory = await documents.getById(PACKAGE_ID, doc.id);
        if (curStory) await documents.remove(PACKAGE_ID, curStory.id, curStory.revision);
        return reply.code(204).send();
      });

      app.get("/stories/:id/plan", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (doc) return getPlan(doc.id);
      });
      app.put("/stories/:id/plan", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (doc) return putPlan(doc.id, request, reply);
      });
      app.post("/stories/:id/plan", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (doc) return postPlan(doc, request, reply);
      });

      app.post("/stories/:id/write", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        try {
          const jobId = jobs.start(doc.id, { count: request.body?.count, nudge: request.body?.nudge });
          return { jobId };
        } catch (error) {
          return reply.code(409).send({ error: error?.message ?? String(error) });
        }
      });

      app.get("/jobs/:jobId", async (request, reply) => {
        const job = jobs.get(request.params.jobId);
        return job ?? reply.code(404).send({ error: "Job not found" });
      });

      app.post("/jobs/:jobId/cancel", async (request) => ({
        cancelled: jobs.cancel(request.params.jobId),
      }));
    },
    { prefix: "/api/story-writer" },
  );
  cleanups.push(cleanupRoutes);
  return () => cleanups.forEach((c) => c());
}
