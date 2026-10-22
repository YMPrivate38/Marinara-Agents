import { buildEpub, chaptersFromMessages } from "./epub.mjs";

const meta = (c) => {
  try { return typeof c.metadata === "string" ? JSON.parse(c.metadata) : c.metadata ?? {}; } catch { return {}; }
};

export async function activate({ api }) {
  const { persistence } = api.runtime;
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
    },
    { prefix: "/api/story-writer" },
  );
  return () => cleanupRoutes();
}
