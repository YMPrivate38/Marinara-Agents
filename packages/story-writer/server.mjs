import { randomUUID } from "node:crypto";
import { buildEpub, chaptersFromDocs } from "./epub.mjs";
import { chapterId, JobRunner, storyView, writeChapter } from "./pipeline.mjs";
import { normalizePlan, normalizeStyle, PACKAGE_ID, readPlan, writePlan } from "./plan.mjs";

const PLAN_PROMPT = `You are the hidden author of a serial story. From the premise, plan it. Return ONLY JSON, no prose:
{"outline":["chapter-level beats"],"secrets":["facts the reader does not know yet"],"twists":[{"text":"...","reveal":"chapter hint or null"}],"offscreen":["what characters do out of sight"],"threads":["open plot threads"],"beat":"what happens in chapter 1"}
Keep every item to one sentence.`;

const TIMEOUT_MESSAGE =
  "The model call timed out. Raise AGENT_CALL_TIMEOUT_MS in the Engine .env or lower the chapter length.";

const validIdArray = (v) =>
  Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === "string" && x.trim().length >= 1 && x.trim().length <= 100);

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

  const createPlan = async ({ storyId, premise, style, connectionId }) => {
    const cleanPremise = typeof premise === "string" ? premise.trim().slice(0, 2000) : "";
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
      [{ role: "system", content: PLAN_PROMPT }, { role: "user", content: cleanPremise }],
      { temperature: 0.8, maxTokens: 2000 },
    );
    const plan = normalizePlan({ ...json.parseJsonish(out.content ?? ""), premise: cleanPremise, style: nextStyle });
    return writePlan(documents, storyId, plan, existing?.revision ?? null);
  };

  const view = (doc) => ({ plan: doc ? normalizePlan(doc.data) : null, revision: doc?.revision ?? null });
  const getPlan = async (storyId) => view(await readPlan(documents, storyId));
  const putPlan = async (storyId, request, reply) => {
    const existing = await readPlan(documents, storyId);
    const plan = { ...normalizePlan(request.body?.plan), chapter: normalizePlan(existing?.data).chapter };
    const saved = await writePlan(documents, storyId, plan, Number.isInteger(request.body?.revision) ? request.body.revision : -1);
    return saved ? view(saved) : reply.code(409).send({ error: "The plan changed; reload it and try again" });
  };
  const postPlan = async (doc, request, reply) => {
    const premise = typeof request.body?.premise === "string" ? request.body.premise.trim().slice(0, 2000) : "";
    if (!premise && !request.body?.style) return reply.code(400).send({ error: "A premise is required" });
    try {
      return view(await createPlan({ storyId: doc.id, premise, style: request.body?.style, connectionId: doc.data?.connectionId ?? null }));
    } catch (error) {
      return reply.code(502).send({ error: `Could not generate the plan: ${error?.message ?? error}` });
    }
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
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title || title.length > 200) return reply.code(400).send({ error: "Title must be 1-200 characters" });
        if (body.premise !== undefined && body.premise !== null && (typeof body.premise !== "string" || body.premise.trim().length > 2000)) {
          return reply.code(400).send({ error: "Premise must be at most 2000 characters" });
        }
        if (body.characterIds !== undefined && !validIdArray(body.characterIds)) {
          return reply.code(400).send({ error: "characterIds must be at most 20 strings of 1-100 characters" });
        }
        if (body.lorebookIds !== undefined && !validIdArray(body.lorebookIds)) {
          return reply.code(400).send({ error: "lorebookIds must be at most 20 strings of 1-100 characters" });
        }
        if (body.connectionId !== undefined && body.connectionId !== null && (typeof body.connectionId !== "string" || body.connectionId.length > 200)) {
          return reply.code(400).send({ error: "connectionId must be a string or null" });
        }

        const id = `story:${randomUUID()}`;
        const createdAt = new Date().toISOString();
        const premise = typeof body.premise === "string" ? body.premise.trim() : "";
        const characterIds = Array.isArray(body.characterIds) ? body.characterIds.map((x) => x.trim()) : [];
        const lorebookIds = Array.isArray(body.lorebookIds) ? body.lorebookIds.map((x) => x.trim()) : [];
        const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() || null : null;

        await documents.create({
          id,
          packageId: PACKAGE_ID,
          kind: "story",
          name: title,
          description: "Story Writer story.",
          data: { title, premise, characterIds, lorebookIds, connectionId, chapterCount: 0, createdAt },
          createdAt,
          updatedAt: createdAt,
        });

        try {
          await createPlan({ storyId: id, premise, style: body.style, connectionId });
          return reply.code(201).send({ id });
        } catch (error) {
          return reply.code(201).send({ id, planError: error?.message ?? String(error) });
        }
      });

      app.get("/stories/:id", async (request, reply) => {
        const doc = await docStory(request, reply);
        if (!doc) return;
        return storyView(doc, await loadChapters(doc));
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
