const TAG = "marinara-capability-story-writer";
const AGENT = "fanfic-writer";

const meta = (c) => {
  try { return typeof c.metadata === "string" ? JSON.parse(c.metadata) : c.metadata ?? {}; } catch { return {}; }
};
const h = (tag, text, attrs = {}) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};
const api = () => globalThis.__MARINARA_HOST__.api.api;

class StoryWriterElement extends HTMLElement {
  static storyChats(chats) {
    const when = (c) => c.lastMessageAt ?? c.updatedAt ?? "";
    return (Array.isArray(chats) ? chats : []).filter((c) => meta(c).storyWriter === true).sort((a, b) => (when(a) < when(b) ? 1 : -1));
  }
  static connections(rows) {
    return (Array.isArray(rows) ? rows : []).filter((r) => r.provider !== "decision");
  }
  // Character rows keep the card as a JSON string in `data`.
  static characterName(row) {
    try { return (typeof row.data === "string" ? JSON.parse(row.data) : row.data)?.name || row.id; } catch { return row.id; }
  }

  connectedCallback() {
    this.load();
  }

  async load() {
    this.replaceChildren(h("p", "Loading stories…"));
    try {
      const [chats, conns, chars] = await Promise.all([api().get("/chats"), api().get("/connections"), api().get("/characters")]);
      this.render(StoryWriterElement.storyChats(chats), StoryWriterElement.connections(conns), Array.isArray(chars) ? chars : []);
    } catch (error) {
      const retry = h("button", "Retry");
      retry.addEventListener("click", () => this.load());
      this.replaceChildren(h("p", `Could not load stories: ${error?.message ?? error}`), retry);
    }
  }

  render(stories, conns, chars) {
    const root = h("div", null, { style: "padding:24px" });
    root.append(h("h2", "Story Writer"));
    if (!stories.length) root.append(h("p", "No stories yet. Start one below."));
    for (const s of stories) {
      const row = h("div", null, { style: "display:flex;gap:12px;align-items:center;margin:8px 0" });
      const when = s.lastMessageAt ?? s.updatedAt;
      row.append(h("strong", s.name || "Untitled"), h("span", when ? `Last activity ${new Date(when).toLocaleString()}` : "No activity yet"));
      const open = h("button", "Open");
      open.addEventListener("click", () => this.capabilityProps?.openChat?.(s.id));
      row.append(open);
      root.append(row);
    }

    const form = h("form", null, { style: "margin-top:24px;display:grid;gap:8px;max-width:360px" });
    const title = h("input", null, { required: "", placeholder: "Story title" });
    const conn = h("select");
    conn.append(h("option", "Engine default", { value: "" }));
    for (const c of conns) conn.append(h("option", c.name || c.id, { value: c.id }));
    const char = h("select");
    char.append(h("option", "No character", { value: "" }));
    for (const c of chars) char.append(h("option", StoryWriterElement.characterName(c), { value: c.id }));
    const status = h("p", "");
    const go = h("button", "Create story", { type: "submit" });
    form.append(h("h3", "New story"), title, conn, char, go, status);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const name = title.value.trim();
      if (!name) return void (status.textContent = "Story title is required.");
      go.disabled = true;
      status.textContent = "Creating…";
      try {
        const chat = await api().post("/chats", { name, mode: "roleplay", characterIds: char.value ? [char.value] : [], connectionId: conn.value || null });
        // Only add the agent when installed; creating the story must not fail without it.
        const agents = await api().get("/agents").catch(() => []);
        const hasAgent = Array.isArray(agents) && agents.some((a) => a.type === AGENT || a.id === AGENT);
        const have = Array.isArray(meta(chat).activeAgentIds) ? meta(chat).activeAgentIds : [];
        await api().patch(`/chats/${chat.id}/metadata`, {
          storyWriter: true,
          enableAgents: true,
          activeAgentIds: hasAgent && !have.includes(AGENT) ? [...have, AGENT] : have,
        });
        this.capabilityProps?.openChat?.(chat.id);
        this.load();
      } catch (error) {
        status.textContent = `Could not create story: ${error?.message ?? error}`;
        go.disabled = false;
      }
    });
    root.append(form);
    this.replaceChildren(root);
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, StoryWriterElement);
