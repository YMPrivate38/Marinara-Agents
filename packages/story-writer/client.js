const TAG = "marinara-capability-story-writer";
// story-writer is the Plan Keeper (its agent id must equal the package id for the runtime hooks); fanfic-writer is the in-character checker.
const AGENTS = ["fanfic-writer", "story-writer"];
const POVS = ["third person limited", "third person omniscient", "first person", "second person"];
const LISTS = ["outline", "secrets", "twists", "offscreen", "threads"];

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

  // One line per item; a twist is "text | reveal hint".
  static toLines(key, items) {
    return (items ?? []).map((i) => (key === "twists" ? (i.reveal ? `${i.text} | ${i.reveal}` : i.text) : i)).join("\n");
  }
  static fromLines(key, text) {
    return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      if (key !== "twists") return l;
      const [t, ...r] = l.split("|");
      return { text: t.trim(), reveal: r.join("|").trim() || null };
    });
  }

  async generatePlan(chatId, premise, style) {
    return api().post(`/story-writer/plan/${encodeURIComponent(chatId)}`, { premise, style });
  }

  // Chapter length / point of view / tense inputs; value() reads them back.
  static styleFields(style) {
    const words = h("input", null, { type: "number", min: "300", max: "8000", value: String(style.chapterWords) });
    const pov = h("select");
    for (const p of POVS) pov.append(h("option", p, { value: p }));
    pov.value = style.pointOfView;
    const tense = h("select");
    for (const t of ["past", "present"]) tense.append(h("option", t, { value: t }));
    tense.value = style.tense;
    return { nodes: [h("label", "Chapter length (words)"), words, h("label", "Point of view"), pov, h("label", "Tense"), tense], value: () => ({ chapterWords: Number(words.value), pointOfView: pov.value, tense: tense.value }) };
  }

  planPanel(story) {
    const box = h("div", null, { style: "margin:4px 0 12px 16px;display:grid;gap:6px;max-width:560px" });
    const url = `/story-writer/plan/${encodeURIComponent(story.id)}`;
    let state = { plan: null, revision: null };
    let shown = false;
    let armed = false;
    const msg = h("p", "");
    const draw = () => {
      armed = false;
      const kids = [];
      const { plan } = state;
      const premise = h("textarea", plan?.premise ?? "", { rows: "2", placeholder: "Premise" });
      if (!plan) kids.push(h("p", "No plan yet."), premise);
      else if (!shown) kids.push(h("p", "Spoilers hidden."));
      const reveal = h("button", shown ? "Hide spoilers" : "Reveal spoilers", { type: "button" });
      reveal.addEventListener("click", () => { shown = !shown; draw(); });
      const fields = {};
      const style = plan ? StoryWriterElement.styleFields(plan.style) : null;
      if (style) kids.push(...style.nodes);
      if (plan && shown) {
        for (const k of LISTS) {
          fields[k] = h("textarea", StoryWriterElement.toLines(k, plan[k]), { rows: "4" });
          kids.push(h("label", k[0].toUpperCase() + k.slice(1) + (k === "twists" ? " (text | reveal hint)" : "")), fields[k]);
        }
        fields.beat = h("textarea", plan.beat, { rows: "2" });
        kids.push(h("label", "Next beat"), fields.beat);
      }
      const save = h("button", "Save", { type: "button" });
      save.addEventListener("click", async () => {
        const next = { ...state.plan, style: style.value() };
        for (const k of LISTS) if (fields[k]) next[k] = StoryWriterElement.fromLines(k, fields[k].value);
        if (fields.beat) next.beat = fields.beat.value;
        try { state = await api().put(url, { plan: next, revision: state.revision }); msg.textContent = "Saved."; draw(); }
        catch (error) { msg.textContent = `Could not save: ${error?.message ?? error}`; }
      });
      const regen = h("button", plan ? "Regenerate" : "Generate plan", { type: "button" });
      regen.addEventListener("click", async () => {
        // Two clicks: regenerating overwrites the stored plan.
        if (plan && !armed) { armed = true; regen.textContent = "Confirm regenerate"; return; }
        const text = (plan ? plan.premise : premise.value).trim();
        if (!text) return void (msg.textContent = "Enter a premise first.");
        regen.disabled = true;
        msg.textContent = "Generating…";
        try { state = await this.generatePlan(story.id, text, style?.value()); msg.textContent = ""; draw(); }
        catch (error) { msg.textContent = `Could not generate the plan: ${error?.message ?? error}`; regen.disabled = false; }
      });
      const bar = h("div", null, { style: "display:flex;gap:8px" });
      bar.append(...(plan ? [reveal, save] : []), regen);
      box.replaceChildren(...kids, bar, msg);
    };
    api().get(url).then((r) => { state = r; draw(); }).catch((error) => { msg.textContent = `Could not load the plan: ${error?.message ?? error}`; box.append(msg); });
    return box;
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
    if (this.notice) root.append(h("p", this.notice));
    this.notice = "";
    if (!stories.length) root.append(h("p", "No stories yet. Start one below."));
    for (const s of stories) {
      const row = h("div", null, { style: "display:flex;gap:12px;align-items:center;margin:8px 0" });
      const when = s.lastMessageAt ?? s.updatedAt;
      row.append(h("strong", s.name || "Untitled"), h("span", when ? `Last activity ${new Date(when).toLocaleString()}` : "No activity yet"));
      const open = h("button", "Open");
      open.addEventListener("click", () => this.capabilityProps?.openChat?.(s.id));
      const exp = h("button", "Export EPUB");
      const err = h("span", "");
      exp.addEventListener("click", async () => {
        exp.disabled = true;
        err.textContent = "";
        try {
          await api().download(`/story-writer/epub/${encodeURIComponent(s.id)}`, "story.epub");
        } catch (error) {
          err.textContent = `Could not export: ${error?.message ?? error}`;
        }
        exp.disabled = false;
      });
      const plan = h("button", "Plan");
      let panel = null;
      plan.addEventListener("click", () => {
        if (panel) { panel.remove(); panel = null; return; }
        panel = this.planPanel(s);
        row.after(panel);
      });
      row.append(open, plan, exp, err);
      root.append(row);
    }

    const form = h("form", null, { style: "margin-top:24px;display:grid;gap:8px;max-width:360px" });
    const title = h("input", null, { required: "", placeholder: "Story title" });
    const premise = h("textarea", null, { rows: "3", placeholder: "Premise (the hidden plan is drafted from it)" });
    const look = StoryWriterElement.styleFields({ chapterWords: 2500, pointOfView: POVS[0], tense: "past" });
    const conn = h("select");
    conn.append(h("option", "Engine default", { value: "" }));
    for (const c of conns) conn.append(h("option", c.name || c.id, { value: c.id }));
    const char = h("select");
    char.append(h("option", "No character", { value: "" }));
    for (const c of chars) char.append(h("option", StoryWriterElement.characterName(c), { value: c.id }));
    const status = h("p", "");
    const go = h("button", "Create story", { type: "submit" });
    form.append(h("h3", "New story"), title, premise, ...look.nodes, conn, char, go, status);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const name = title.value.trim();
      if (!name) return void (status.textContent = "Story title is required.");
      go.disabled = true;
      status.textContent = "Creating…";
      try {
        const chat = await api().post("/chats", { name, mode: "roleplay", characterIds: char.value ? [char.value] : [], connectionId: conn.value || null });
        // Only add agents that are installed; creating the story must not fail without them.
        const agents = await api().get("/agents").catch(() => []);
        const have = Array.isArray(meta(chat).activeAgentIds) ? meta(chat).activeAgentIds : [];
        const add = AGENTS.filter((a) => !have.includes(a) && Array.isArray(agents) && agents.some((x) => x.type === a || x.id === a));
        await api().patch(`/chats/${chat.id}/metadata`, { storyWriter: true, enableAgents: true, activeAgentIds: [...have, ...add] });
        try {
          await this.generatePlan(chat.id, premise.value.trim(), look.value());
        } catch (error) {
          this.notice = `Story created, but the plan could not be generated: ${error?.message ?? error}. Open Plan on the story and press Generate plan.`;
        }
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
