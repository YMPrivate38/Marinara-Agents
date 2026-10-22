import { buildEpub, chaptersFromMessages } from "./epub.mjs";
import { createAgentRuntime, createContributor, normalizePlan, readPlan, writePlan } from "./plan.mjs";

const PLAN_PROMPT = `You are the hidden author of a serial story. From the premise, plan it. Return ONLY JSON, no prose:
{"outline":["chapter-level beats"],"secrets":["facts the reader does not know yet"],"twists":[{"text":"...","reveal":"chapter hint or null"}],"offscreen":["what characters do out of sight"],"threads":["open plot threads"],"beat":"what happens in chapter 1"}
Keep every item to one sentence.`;

const meta = (c) => {
  try { return typeof c.metadata === "string" ? JSON.parse(c.metadata) : c.metadata ?? {}; } catch { return {}; }
};

export async function activate({ api }) {
  const { persistence, languageModels, json } = api.runtime;
  const { documents } = persistence;
  const cleanups = [
    api.registerPromptContext(createContributor(documents)),
    api.registerService("agent-runtime:story-writer", createAgentRuntime(documents, (raw) => json.parseJsonish(raw))),
  ];
  const story = async (request, reply) => {
    const chat = await persistence.getChat(request.params.chatId);
    if (!chat || meta(chat).storyWriter !== true) return void reply.code(404).send({ error: "Story not found" });
    return chat;
  };
  const cleanupRoutes = await api.registerPrivilegedRoutes(
    async (app) => {
      app.get("/epub/:chatId", async (request, reply) => {
        const chat = await persistence.getChat(request.params.chatId);
        // Only stories are exportable; other chats stay unreachable through this route.
        if (!chat || meta(chat).storyWriter !== true) return reply.code(404).send({ error: "Story not found" });
        const chapters = chaptersFromMessages(await persistence.listMessages(chat.id));
        if (!chapters.length) return reply.code(409).send({ error: "This story has no chapters yet" });
        const title = chat.name || "Story";
        const ascii = title.replace(/[^A-Za-z0-9._ -]/g, "_").trim() || "story";
        const utf8 = encodeURIComponent(title).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        return reply
          .header("Content-Type", "application/epub+zip")
          .header("Content-Disposition", `attachment; filename="${ascii}.epub"; filename*=UTF-8''${utf8}.epub`)
          .send(buildEpub({ id: chat.id, title, chapters }));
      });

      const view = (doc) => ({ plan: doc ? normalizePlan(doc.data) : null, revision: doc?.revision ?? null });
      app.get("/plan/:chatId", async (request, reply) => {
        const chat = await story(request, reply);
        if (chat) return view(await readPlan(documents, chat.id));
      });
      app.put("/plan/:chatId", async (request, reply) => {
        const chat = await story(request, reply);
        if (!chat) return;
        const existing = await readPlan(documents, chat.id);
        const plan = { ...normalizePlan(request.body?.plan), chapter: normalizePlan(existing?.data).chapter };
        const saved = await writePlan(documents, chat.id, plan, Number.isInteger(request.body?.revision) ? request.body.revision : -1);
        return saved ? view(saved) : reply.code(409).send({ error: "The plan changed; reload it and try again" });
      });
      app.post("/plan/:chatId", async (request, reply) => {
        const chat = await story(request, reply);
        if (!chat) return;
        const premise = typeof request.body?.premise === "string" ? request.body.premise.trim().slice(0, 2000) : "";
        if (!premise) return reply.code(400).send({ error: "A premise is required" });
        try {
          const model = await languageModels.resolveForRequest({ chatConnectionId: chat.connectionId ?? null });
          const out = await model.chatComplete(
            [{ role: "system", content: PLAN_PROMPT }, { role: "user", content: premise }],
            { temperature: 0.8, maxTokens: 2000 },
          );
          const plan = normalizePlan({ ...json.parseJsonish(out.content ?? ""), premise });
          const existing = await readPlan(documents, chat.id);
          return view(await writePlan(documents, chat.id, plan, existing?.revision ?? null));
        } catch (error) {
          return reply.code(502).send({ error: `Could not generate the plan: ${error?.message ?? error}` });
        }
      });
    },
    { prefix: "/api/story-writer" },
  );
  cleanups.push(cleanupRoutes);
  return () => cleanups.forEach((c) => c());
}
