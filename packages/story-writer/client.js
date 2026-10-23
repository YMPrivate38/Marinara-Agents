const TAG = "marinara-capability-story-writer";
const STYLE_ID = "sw-theme-style";
const POVS = ["third person limited", "third person omniscient", "first person", "second person"];
const TENSES = ["past", "present"];
const TWISTS = [
  ["none", "None"],
  ["rare", "Rare"],
  ["free", "Free"],
];
const LISTS = ["outline", "secrets", "offscreen", "threads", "twists"];
const PHASES = {
  writing: "Writing",
  checking: "Checking the characters",
  rewriting: "Fixing problems",
  planning: "Planning what comes next",
};

const CSS = `
marinara-capability-story-writer { display:block; color:var(--foreground); background:var(--background); font-family:system-ui,-apple-system,sans-serif; box-sizing:border-box; }
marinara-capability-story-writer *, marinara-capability-story-writer *::before, marinara-capability-story-writer *::after { box-sizing:border-box; }
.sw-root { padding:20px; display:grid; gap:12px; max-width:720px; width:100%; margin:0 auto; overflow-wrap:break-word; }
.sw-head, .sw-bar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.sw-head-between { justify-content:space-between; }
.sw-form, .sw-stack, .sw-picker, .sw-results, .sw-chapters { display:grid; gap:8px; width:100%; }
.sw-card, .sw-panel, .sw-advanced, .sw-settings, .sw-chapter { background:var(--card); color:var(--card-foreground); border:1px solid var(--border); border-radius:var(--radius, 8px); padding:12px; display:grid; gap:8px; }
.sw-advanced > summary, .sw-settings > summary { cursor:pointer; font-weight:600; color:var(--card-foreground); }
.sw-label { font-weight:500; color:var(--foreground); display:flex; gap:8px; align-items:center; }
.sw-input, .sw-select, .sw-textarea { background:var(--input, var(--background)); color:var(--foreground); border:1px solid var(--border); border-radius:var(--radius, 6px); padding:8px 10px; font:inherit; width:100%; max-width:100%; }
.sw-input[type="checkbox"] { width:auto; padding:0; }
.sw-input:focus, .sw-select:focus, .sw-textarea:focus, .sw-btn:focus-visible { outline:2px solid var(--ring); outline-offset:1px; }
.sw-btn { background:var(--secondary); color:var(--secondary-foreground); border:1px solid var(--border); border-radius:var(--radius, 6px); padding:6px 12px; font:inherit; cursor:pointer; }
.sw-btn-primary { background:var(--primary); color:var(--primary-foreground); border-color:var(--primary); }
.sw-btn-ghost { background:transparent; color:var(--foreground); border:1px solid var(--border); }
.sw-btn-destructive { background:var(--destructive); color:var(--primary-foreground); border-color:var(--destructive); }
.sw-btn:disabled { opacity:0.6; cursor:not-allowed; }
.sw-muted { color:var(--muted-foreground); margin:0; font-size:0.9em; }
.sw-chips { display:flex; gap:6px; flex-wrap:wrap; }
.sw-chip { display:inline-flex; gap:4px; align-items:center; background:var(--secondary); color:var(--secondary-foreground); border:1px solid var(--border); border-radius:999px; padding:2px 10px; }
.sw-reader-pane { background:var(--card); color:var(--card-foreground); border:1px solid var(--border); border-radius:var(--radius, 8px); margin-top:16px; padding:16px; max-width:70ch; line-height:1.7; font-family:system-ui,-apple-system,sans-serif; display:grid; gap:12px; }
@media (max-width: 600px) { .sw-root { padding:12px; } }
`.trim();

const TAG_CLASS = {
  button: "sw-btn",
  input: "sw-input",
  select: "sw-select",
  textarea: "sw-textarea",
  label: "sw-label",
};

const h = (tag, text, attrs = {}) => {
  const e = document.createElement(tag);
  if (text != null) {
    e.textContent = text;
    if (tag === "textarea") e.value = text;
  }
  const cls = [TAG_CLASS[tag] || "", attrs.className ?? attrs.class ?? ""].filter(Boolean).join(" ");
  if (cls) {
    e.className = cls;
    e.setAttribute("class", cls);
  }
  for (const k in attrs) {
    if (k === "className" || k === "class") continue;
    e.setAttribute(k, attrs[k]);
    if (k === "value" || k === "id") e[k] = attrs[k];
    if (k === "checked") e.checked = Boolean(attrs[k] || attrs[k] === "");
    if (k === "open") e.open = Boolean(attrs[k] || attrs[k] === "");
  }
  return e;
};
const api = () => globalThis.__MARINARA_HOST__.api.api;
let pickerSeq = 0;

const clampInt = (v, lo, hi, d) =>
  typeof v !== "boolean" && v !== null && v !== undefined && v !== "" && Number.isFinite(Math.round(Number(v)))
    ? Math.min(hi, Math.max(lo, Math.round(Number(v))))
    : d;

const normalizeSettings = (raw) => {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    twists: ["none", "rare", "free"].includes(s.twists) ? s.twists : "rare",
    presetName: typeof s.presetName === "string" ? s.presetName.trim().slice(0, 200) : "",
    presetText: typeof s.presetText === "string" ? s.presetText.trim().slice(0, 6000) : "",
    intro: typeof s.intro === "string" ? s.intro.trim().slice(0, 4000) : "",
    checker: s.checker !== false,
    minScore: clampInt(s.minScore, 1, 10, 7),
    maxRetries: clampInt(s.maxRetries, 0, 3, 2),
  };
};

class StoryWriterElement extends HTMLElement {
  static connections(rows) {
    return (Array.isArray(rows) ? rows : []).filter((r) => r && r.provider !== "decision");
  }
  // Character rows keep the card as a JSON string or object in `data`, and V2 cards may nest `.data`.
  static unwrapCharacter(row) {
    let d = row?.data;
    if (typeof d === "string") {
      try {
        d = JSON.parse(d);
      } catch {
        d = null;
      }
    }
    const inner = d && typeof d.data === "object" && d.data !== null ? d.data : null;
    return {
      name: inner?.name || d?.name || row?.name || row?.id || "",
      first_mes: inner?.first_mes ?? d?.first_mes ?? row?.first_mes ?? "",
      alternate_greetings: inner?.alternate_greetings ?? d?.alternate_greetings ?? row?.alternate_greetings ?? [],
    };
  }
  static characterName(row) {
    return StoryWriterElement.unwrapCharacter(row).name;
  }
  static greetings(row) {
    const c = StoryWriterElement.unwrapCharacter(row);
    const name = c.name || "Character";
    const out = [];
    if (typeof c.first_mes === "string" && c.first_mes.trim()) {
      out.push({ label: `${name} — first message`, text: c.first_mes.slice(0, 4000) });
    }
    const alts = Array.isArray(c.alternate_greetings) ? c.alternate_greetings : [];
    for (let i = 0; i < alts.length; i++) {
      const g = alts[i];
      if (typeof g === "string" && g.trim()) {
        out.push({ label: `${name} — alternate ${i + 1}`, text: g.slice(0, 4000) });
      }
    }
    return out;
  }
  static presetText(full) {
    const sections = Array.isArray(full) ? full : Array.isArray(full?.sections) ? full.sections : [];
    return sections
      .filter((s) => s?.enabled && !s.isMarker && s.content && String(s.content).trim())
      .map((s) => String(s.content).trim())
      .join("\n\n");
  }
  static phaseLabel(phase) {
    return PHASES[phase] ?? "Writing";
  }
  static jobLine(job) {
    const total = job?.total ?? 1;
    const cur = Math.min((job?.done ?? 0) + 1, total);
    return `Chapter ${cur} of ${total} — ${StoryWriterElement.phaseLabel(job?.phase)}`;
  }
  static splitParagraphs(text) {
    return String(text ?? "")
      .split(/\r?\n\s*\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  static listLines(text) {
    return String(text ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }
  static formatTwists(twists) {
    return (Array.isArray(twists) ? twists : [])
      .map((t) => (typeof t === "string" ? t.trim() : t?.reveal ? `${t.text} | ${t.reveal}` : String(t?.text ?? "").trim()))
      .filter(Boolean)
      .join("\n");
  }
  static parseTwists(text) {
    return StoryWriterElement.listLines(text)
      .map((l) => {
        const [t, ...r] = l.split("|");
        return { text: t.trim(), reveal: r.join("|").trim() || null };
      })
      .filter((t) => t.text);
  }
  static clampWords(v) {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return 2500;
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(8000, Math.max(300, n)) : 2500;
  }
  static storyPath(id, suffix = "") {
    const tail = suffix ? (suffix.startsWith("/") ? suffix : `/${suffix}`) : "";
    return `/story-writer/stories/${encodeURIComponent(id)}${tail}`;
  }
  static styleFields(style = {}) {
    const words = h("input", null, {
      type: "number",
      min: "300",
      max: "8000",
      value: String(StoryWriterElement.clampWords(style?.chapterWords)),
    });
    const pov = h("select");
    for (const p of POVS) pov.append(h("option", p, { value: p }));
    pov.value = POVS.includes(style?.pointOfView) ? style.pointOfView : POVS[0];
    const tense = h("select");
    for (const t of TENSES) tense.append(h("option", t, { value: t }));
    tense.value = TENSES.includes(style?.tense) ? style.tense : TENSES[0];
    return {
      nodes: [
        h("label", "Chapter length (words)"),
        words,
        h("label", "Point of view"),
        pov,
        h("label", "Tense"),
        tense,
      ],
      value: () => ({
        chapterWords: StoryWriterElement.clampWords(words.value),
        pointOfView: pov.value,
        tense: tense.value,
      }),
    };
  }
  static unwrapPage(res) {
    if (Array.isArray(res)) return { items: res, hasMore: false };
    if (Array.isArray(res?.items)) return { items: res.items, hasMore: Boolean(res.hasMore) };
    return { items: [], hasMore: false };
  }
  static pickQuery(path, search = "", offset = 0, sort = "") {
    const q = `search=${encodeURIComponent(search ?? "")}&limit=20&offset=${Number(offset) || 0}`;
    return `${path}?${q}${sort ? `&sort=${encodeURIComponent(sort)}` : ""}`;
  }
  static togglePick(selected, item, max = 20) {
    const list = Array.isArray(selected) ? [...selected] : [];
    if (!item?.id || list.some((x) => x.id === item.id)) {
      return { selected: list, added: false, atLimit: false };
    }
    if (list.length >= max) {
      return { selected: list, added: false, atLimit: true };
    }
    return {
      selected: [...list, { id: item.id, name: item.name ?? item.id }],
      added: true,
      atLimit: false,
    };
  }
  static authorFields(initial = {}) {
    const init = normalizeSettings(initial);
    const twists = h("select");
    for (const [val, label] of TWISTS) twists.append(h("option", label, { value: val }));
    twists.value = init.twists;
    const twistHint = h("p", "Rare = the author only follows the premise and cards, no invented twists", {
      className: "sw-muted",
    });

    const checker = h("input", null, init.checker ? { type: "checkbox", checked: "checked" } : { type: "checkbox" });
    checker.checked = init.checker;
    const checkerLabel = h("label", null);
    checkerLabel.append(checker, h("span", "Check chapters for out-of-character writing and rewrite"));

    const minScore = h("input", null, {
      type: "number",
      min: "1",
      max: "10",
      value: String(init.minScore),
    });
    const maxRetries = h("input", null, {
      type: "number",
      min: "0",
      max: "3",
      value: String(init.maxRetries),
    });

    return {
      nodes: [
        h("label", "Twists"),
        twists,
        twistHint,
        checkerLabel,
        h("label", "Minimum score (1-10)"),
        minScore,
        h("label", "Max rewrites (0-3)"),
        maxRetries,
      ],
      value: () => ({
        twists: TWISTS.some(([v]) => v === twists.value) ? twists.value : "rare",
        checker: Boolean(checker.checked),
        minScore: clampInt(minScore.value, 1, 10, 7),
        maxRetries: clampInt(maxRetries.value, 0, 3, 2),
      }),
    };
  }
  static picker({ label, path, nameOf = (r) => r?.name || r?.id || "", max = 20, sort = "", onChange = null } = {}) {
    const text = /^(characters|lorebooks)$/i.test(label) ? `Search ${label.toLowerCase()}` : label || "Search";
    const hideOnFail = path === "/lorebooks";
    const inputId = `sw-picker-${++pickerSeq}`;
    const wrap = h("div", null, {
      className: "sw-picker",
      style: hideOnFail ? "display:none" : "display:grid;gap:6px",
    });
    wrap.hidden = hideOnFail;

    let selected = [];
    let rows = [];
    let offset = 0;
    let hasMore = false;
    // Ignore responses from superseded searches or page loads.
    let seq = 0;
    let shown = !hideOnFail;
    let timer = null;

    const labelEl = h("label", text, { for: inputId });
    const chipsBox = h("div", null, { className: "sw-chips", style: "display:flex;gap:6px;flex-wrap:wrap" });
    const countEl = h("span", `0 of ${max} selected`, { className: "sw-muted", style: "opacity:0.7" });
    const input = h("input", null, { type: "search", id: inputId, "aria-label": text, value: "", placeholder: text });
    const statusEl = h("p", "", { className: "sw-muted" });
    const resultsBox = h("div", null, { className: "sw-results", style: "display:grid;gap:4px" });
    const moreBox = h("div");
    const moreBtn = h("button", "Load more", { type: "button", className: "sw-btn-ghost" });

    const renderChips = () => {
      countEl.textContent = `${selected.length} of ${max} selected`;
      const chips = selected.map((item) => {
        const chip = h("span", null, { className: "sw-chip", style: "display:inline-flex;gap:4px;align-items:center" });
        const rm = h("button", "×", { type: "button", className: "sw-btn-ghost", "aria-label": `Remove ${item.name}` });
        rm.addEventListener("click", () => {
          selected = selected.filter((s) => s.id !== item.id);
          if (statusEl.textContent === `Limit of ${max} reached.`) statusEl.textContent = "";
          renderChips();
          renderResults();
          onChange?.(selected.map((s) => s.id));
        });
        chip.append(h("span", item.name), rm);
        return chip;
      });
      chipsBox.replaceChildren(...chips);
    };

    const renderResults = () => {
      const btns = rows.map((r) => {
        const id = r?.id;
        const name = String(nameOf(r) ?? id ?? "");
        const picked = selected.some((s) => s.id === id);
        const btn = h("button", picked ? `${name} (added)` : name, { type: "button" });
        btn.disabled = picked;
        btn.addEventListener("click", () => {
          const res = StoryWriterElement.togglePick(selected, { id, name }, max);
          if (res.atLimit) {
            statusEl.textContent = `Limit of ${max} reached.`;
            return;
          }
          if (!res.added) return;
          selected = res.selected;
          renderChips();
          renderResults();
          onChange?.(selected.map((s) => s.id));
        });
        return btn;
      });
      resultsBox.replaceChildren(...btns);
      moreBox.replaceChildren(...(hasMore ? [moreBtn] : []));
    };

    const fetchPage = async (nextOffset) => {
      const reqId = ++seq;
      statusEl.textContent = "Searching…";
      try {
        const res = await api().get(StoryWriterElement.pickQuery(path, input.value, nextOffset, sort));
        if (reqId !== seq) return;
        if (!Array.isArray(res) && !Array.isArray(res?.items)) throw new Error("Invalid response");
        if (!shown) {
          shown = true;
          wrap.hidden = false;
          wrap.setAttribute("style", "display:grid;gap:6px");
        }
        const page = StoryWriterElement.unwrapPage(res);
        const pageItems = page.items.slice(0, 20);
        offset = nextOffset;
        rows = nextOffset === 0 ? pageItems : [...rows, ...pageItems];
        hasMore = page.hasMore;
        statusEl.textContent = rows.length ? "" : "No matches.";
        renderResults();
      } catch (error) {
        if (reqId !== seq) return;
        if (!shown && hideOnFail) {
          wrap.replaceChildren();
          return;
        }
        statusEl.textContent = error?.message ?? String(error);
      }
    };

    input.addEventListener("input", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fetchPage(0);
      }, 300);
    });
    moreBtn.addEventListener("click", () => fetchPage(offset + 20));

    wrap.append(labelEl, chipsBox, countEl, input, statusEl, resultsBox, moreBox);
    fetchPage(0);
    return {
      nodes: [wrap],
      value: () => selected.map((s) => s.id),
    };
  }

  ensureStyle() {
    const existing = Array.from(this.children ?? []).find((c) => (c.id || c.attrs?.id) === STYLE_ID);
    if (existing) return existing;
    this.styleEl ||= h("style", CSS, { id: STYLE_ID });
    return this.styleEl;
  }

  setView(...nodes) {
    this.replaceChildren(this.ensureStyle(), ...nodes);
  }

  connectedCallback() {
    this.load();
  }

  disconnectedCallback() {
    this.stopPolling();
    this.clearTimers();
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.activeJobId = null;
  }

  clearTimers() {
    if (this.deleteTimer) {
      clearTimeout(this.deleteTimer);
      this.deleteTimer = null;
    }
    if (this.regenTimer) {
      clearTimeout(this.regenTimer);
      this.regenTimer = null;
    }
  }

  async load() {
    this.stopPolling();
    this.clearTimers();
    this.currentStory = null;
    this.setView(h("p", "Loading stories…", { className: "sw-muted" }));
    try {
      const stories = await api().get("/story-writer/stories");
      this.renderShelf(Array.isArray(stories) ? stories : []);
    } catch (error) {
      const retry = h("button", "Retry", { type: "button" });
      retry.addEventListener("click", () => this.load());
      this.setView(h("p", `Could not load stories: ${error?.message ?? error}`), retry);
    }
  }

  render(stories) {
    this.renderShelf(stories);
  }

  renderShelf(stories = []) {
    const root = h("div", null, { className: "sw-root", style: "padding:24px;display:grid;gap:12px;max-width:720px" });
    const head = h("div", null, {
      className: "sw-head sw-head-between",
      style: "display:flex;gap:12px;align-items:center;justify-content:space-between",
    });
    const newBtn = h("button", "New story", { type: "button", className: "sw-btn-primary" });
    newBtn.addEventListener("click", () => this.openNewStoryForm());
    head.append(h("h2", "Story Writer"), newBtn);
    root.append(head);

    const list = Array.isArray(stories) ? stories : [];
    if (!list.length) {
      root.append(h("p", "No stories yet.", { className: "sw-muted" }));
    }
    for (const s of list) {
      const row = h("div", null, {
        className: "sw-card sw-bar",
        style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:6px 0",
      });
      const when = s.lastChapterAt ?? s.createdAt ?? s.updatedAt;
      row.append(
        h("strong", s.title || s.name || "Untitled"),
        h("span", `${s.chapterCount ?? 0} chapters`, { className: "sw-muted", style: "opacity:0.7" }),
        h("span", when ? new Date(when).toLocaleString() : "", { className: "sw-muted", style: "opacity:0.7" }),
      );
      const open = h("button", "Open", { type: "button" });
      open.addEventListener("click", () => this.openStory(s.id));
      row.append(open);
      root.append(row);
    }
    this.setView(root);
  }

  async openNewStoryForm() {
    this.stopPolling();
    this.clearTimers();
    const conns = await api()
      .get("/connections")
      .catch(() => []);
    this.renderNewStoryForm({
      connections: StoryWriterElement.connections(conns),
    });
  }

  renderNewStoryForm({ connections = [] } = {}) {
    const root = h("div", null, { className: "sw-root", style: "padding:24px;display:grid;gap:12px;max-width:560px" });
    const back = h("button", "Back", { type: "button", className: "sw-btn-ghost" });
    back.addEventListener("click", () => this.load());
    const head = h("div", null, { className: "sw-head", style: "display:flex;gap:12px;align-items:center" });
    head.append(back, h("h2", "New story"));
    root.append(head);

    const form = h("form", null, { className: "sw-form", style: "display:grid;gap:8px" });
    const title = h("input", null, { type: "text", required: "", maxlength: "200", value: "", placeholder: "Story title" });
    const premise = h("textarea", "", { rows: "4", maxlength: "2000", placeholder: "Premise (optional)" });
    const conn = h("select");
    conn.append(h("option", "Engine default", { value: "" }));
    for (const c of StoryWriterElement.connections(connections)) {
      conn.append(h("option", c.name || c.id, { value: c.id }));
    }
    conn.value = "";

    // Opening & character greetings (fetched lazily when characters are picked).
    const introInput = h("textarea", "", { rows: "4", maxlength: "4000", placeholder: "Opening (optional)" });
    const startWrap = h("div", null, { className: "sw-stack", style: "display:none" });
    startWrap.hidden = true;
    const startSelect = h("select");
    startWrap.append(h("label", "Start from…"), startSelect);
    const charGreetings = new Map();
    let greetingItems = [];

    const rebuildStartOptions = (ids) => {
      if (!ids.length) {
        startWrap.hidden = true;
        startWrap.setAttribute("style", "display:none");
        startSelect.replaceChildren();
        greetingItems = [];
        return;
      }
      startWrap.hidden = false;
      startWrap.setAttribute("style", "display:grid;gap:6px");
      greetingItems = [];
      const opts = [h("option", "Nothing", { value: "" })];
      for (const id of ids) {
        for (const g of charGreetings.get(id) ?? []) {
          const idx = String(greetingItems.length);
          greetingItems.push(g);
          opts.push(h("option", g.label, { value: idx }));
        }
      }
      startSelect.replaceChildren(...opts);
      startSelect.value = "";
    };

    startSelect.addEventListener("change", () => {
      const idx = startSelect.value === "" ? -1 : Number(startSelect.value);
      if (idx >= 0 && greetingItems[idx]) {
        const capped = greetingItems[idx].text.slice(0, 4000);
        introInput.value = capped;
        introInput.textContent = capped;
      }
    });

    const onCharsChange = (ids) => {
      rebuildStartOptions(ids);
      for (const id of ids) {
        if (charGreetings.has(id)) continue;
        charGreetings.set(id, []);
        api()
          .get(`/characters/${id}`)
          .then((row) => {
            charGreetings.set(id, StoryWriterElement.greetings(row));
            rebuildStartOptions(charPicker.value());
          })
          .catch(() => {});
      }
    };

    const charPicker = StoryWriterElement.picker({
      label: "Search characters",
      path: "/characters",
      nameOf: StoryWriterElement.characterName,
      max: 20,
      sort: "name-asc",
      onChange: onCharsChange,
    });
    const lorePicker = StoryWriterElement.picker({
      label: "Search lorebooks",
      path: "/lorebooks",
      nameOf: (l) => l?.name || l?.id || "",
      max: 20,
    });

    // Prompt preset selector (hidden if GET /prompts fails).
    let presetName = "";
    let presetText = "";
    const presetNames = new Map();
    const presetWrap = h("div", null, { className: "sw-stack", style: "display:grid;gap:6px" });
    const presetSelect = h("select");
    presetSelect.append(h("option", "No preset", { value: "" }));
    const presetHint = h("p", "", { className: "sw-muted" });
    presetWrap.append(h("label", "Prompt preset"), presetSelect, presetHint);

    api()
      .get("/prompts")
      .then((rows) => {
        if (!Array.isArray(rows)) throw new Error("Invalid prompts");
        for (const p of rows) {
          if (!p?.id) continue;
          const nm = p.name || p.id;
          presetNames.set(p.id, nm);
          presetSelect.append(h("option", nm, { value: p.id }));
        }
      })
      .catch(() => {
        presetWrap.hidden = true;
        presetWrap.setAttribute("style", "display:none");
        presetWrap.replaceChildren();
      });

    presetSelect.addEventListener("change", async () => {
      const id = presetSelect.value;
      if (!id) {
        presetName = "";
        presetText = "";
        presetHint.textContent = "";
        return;
      }
      try {
        const full = await api().get(`/prompts/${id}/full`);
        presetText = StoryWriterElement.presetText(full);
        presetName = full?.preset?.name || presetNames.get(id) || "";
        presetHint.textContent = presetText.length
          ? `${presetText.length} characters`
          : "This preset has no plain-text sections";
      } catch (error) {
        presetName = "";
        presetText = "";
        presetHint.textContent = error?.message ?? String(error);
      }
    });

    const author = StoryWriterElement.authorFields();
    const advanced = h("details", null, { className: "sw-advanced", open: "" });
    advanced.open = true;
    advanced.append(
      h("summary", "Author controls"),
      presetWrap,
      h("label", "Opening (optional)"),
      introInput,
      startWrap,
      ...author.nodes,
    );

    const style = StoryWriterElement.styleFields({ chapterWords: 2500, pointOfView: POVS[0], tense: "past" });
    const status = h("p", "", { className: "sw-muted" });
    const submit = h("button", "Create story", { type: "submit", className: "sw-btn-primary" });

    form.append(
      h("label", "Title"),
      title,
      h("label", "Premise"),
      premise,
      h("label", "Connection"),
      conn,
      ...charPicker.nodes,
      ...lorePicker.nodes,
      advanced,
      ...style.nodes,
      submit,
      status,
    );

    form.addEventListener("submit", async (ev) => {
      ev?.preventDefault?.();
      const cleanTitle = (title.value ?? "").trim();
      if (!cleanTitle) return void (status.textContent = "Story title is required.");
      const cleanPremise = (premise.value ?? "").trim();
      if (cleanPremise.length > 2000) return void (status.textContent = "Premise must be at most 2000 characters.");
      const characterIds = charPicker.value();
      if (characterIds.length > 20) return void (status.textContent = "Select at most 20 characters.");
      const lorebookIds = lorePicker.value();
      if (lorebookIds.length > 20) return void (status.textContent = "Select at most 20 lorebooks.");

      submit.disabled = true;
      status.textContent = "Creating…";
      try {
        const settings = normalizeSettings({
          ...author.value(),
          presetName,
          presetText,
          intro: (introInput.value ?? "").slice(0, 4000),
        });
        const res = await api().post("/story-writer/stories", {
          title: cleanTitle,
          premise: cleanPremise,
          characterIds,
          lorebookIds,
          connectionId: conn.value || null,
          style: style.value(),
          settings,
        });
        const notice = res?.planError
          ? `Story created, but the plan could not be generated: ${res.planError}. Open Plan and press Regenerate.`
          : "";
        await this.openStory(res.id, notice);
      } catch (error) {
        status.textContent = `Could not create story: ${error?.message ?? error}`;
        submit.disabled = false;
      }
    });

    root.append(form);
    this.setView(root);
  }

  async openStory(id, notice = "") {
    if (this.currentStory?.id !== id) {
      this.stopPolling();
      this.clearTimers();
      this.planOpen = false;
      this.readingChapter = null;
      this.jobError = "";
      this.activeJob = null;
    }
    if (notice) this.readerNotice = notice;
    try {
      const story = await api().get(StoryWriterElement.storyPath(id));
      this.renderReader(story);
    } catch (error) {
      const back = h("button", "Back", { type: "button", className: "sw-btn-ghost" });
      back.addEventListener("click", () => this.load());
      this.setView(h("p", `Could not load story: ${error?.message ?? error}`), back);
    }
  }

  planPanel(story) {
    const box = h("div", null, { className: "sw-panel", style: "padding:12px;display:grid;gap:8px;max-width:560px" });
    const url = StoryWriterElement.storyPath(story.id, "/plan");
    let state = { plan: null, revision: null };
    let shown = false;
    let armed = false;
    let conflict = false;
    const msg = h("p", "", { className: "sw-muted" });

    const clearRegen = () => {
      armed = false;
      if (this.regenTimer) {
        clearTimeout(this.regenTimer);
        this.regenTimer = null;
      }
    };

    const loadPlan = () => {
      api()
        .get(url)
        .then((r) => {
          state = r ?? { plan: null, revision: null };
          conflict = false;
          draw();
        })
        .catch((error) => {
          msg.textContent = `Could not load the plan: ${error?.message ?? error}`;
          box.replaceChildren(msg);
        });
    };

    const draw = () => {
      clearRegen();
      const plan = state?.plan ?? {
        premise: story.premise ?? "",
        outline: [],
        secrets: [],
        twists: [],
        offscreen: [],
        threads: [],
        beat: "",
        style: { chapterWords: 2500, pointOfView: POVS[0], tense: "past" },
      };
      const kids = [];
      const reveal = h("button", shown ? "Hide spoilers" : "Reveal spoilers", {
        type: "button",
        className: "sw-btn-ghost",
      });
      reveal.addEventListener("click", () => {
        shown = !shown;
        draw();
      });
      kids.push(reveal);

      const style = StoryWriterElement.styleFields(plan.style);
      kids.push(...style.nodes);

      if (!shown) {
        kids.push(h("p", "Spoilers hidden", { className: "sw-muted" }));
      }

      const fields = {};
      if (shown) {
        for (const k of LISTS) {
          const text = k === "twists" ? StoryWriterElement.formatTwists(plan.twists) : (plan[k] ?? []).join("\n");
          fields[k] = h("textarea", text, { rows: "4" });
          const label = k[0].toUpperCase() + k.slice(1) + (k === "twists" ? " (text | reveal hint)" : "");
          kids.push(h("label", label), fields[k]);
        }
        fields.beat = h("textarea", plan.beat ?? "", { rows: "2" });
        kids.push(h("label", "Next beat"), fields.beat);
      }

      const save = h("button", "Save", { type: "button", className: "sw-btn-primary" });
      save.addEventListener("click", async () => {
        const next = { ...plan, style: style.value() };
        if (shown) {
          for (const k of LISTS) {
            next[k] = k === "twists" ? StoryWriterElement.parseTwists(fields[k].value) : StoryWriterElement.listLines(fields[k].value);
          }
          next.beat = (fields.beat.value ?? "").trim();
        }
        try {
          state = await api().put(url, { plan: next, revision: state?.revision ?? null });
          conflict = false;
          msg.textContent = "Saved.";
          draw();
        } catch (error) {
          const text = String(error?.message ?? error);
          if (error?.status === 409 || error?.statusCode === 409 || /409|plan changed/i.test(text)) {
            conflict = true;
            msg.textContent = "The plan changed; reload it and try again";
            draw();
          } else {
            msg.textContent = `Could not save: ${text}`;
          }
        }
      });

      const regen = h("button", "Regenerate", { type: "button" });
      regen.addEventListener("click", async () => {
        if (!armed) {
          armed = true;
          regen.textContent = "Confirm regenerate";
          regen.className = "sw-btn sw-btn-destructive";
          this.regenTimer = setTimeout(() => {
            armed = false;
            regen.textContent = "Regenerate";
            regen.className = "sw-btn";
          }, 4000);
          return;
        }
        clearRegen();
        regen.disabled = true;
        msg.textContent = "Generating…";
        try {
          state = await api().post(url, { premise: story.premise ?? plan.premise ?? "", style: style.value() });
          conflict = false;
          msg.textContent = "";
          draw();
        } catch (error) {
          msg.textContent = `Could not generate the plan: ${error?.message ?? error}`;
          regen.disabled = false;
          regen.textContent = "Regenerate";
        }
      });

      const bar = h("div", null, { className: "sw-bar", style: "display:flex;gap:8px;flex-wrap:wrap" });
      bar.append(save, regen);
      if (conflict) {
        const reload = h("button", "Reload", { type: "button" });
        reload.addEventListener("click", () => {
          msg.textContent = "";
          loadPlan();
        });
        bar.append(reload);
      }
      box.replaceChildren(...kids, bar, msg);
    };

    loadPlan();
    return box;
  }

  settingsPanel(story) {
    let cur = normalizeSettings(story?.settings);
    const details = h("details", null, { className: "sw-settings" });
    details.open = false;
    const author = StoryWriterElement.authorFields(cur);
    const presetLabel = h("label", "Prompt preset");
    const presetValue = h("p", cur.presetName || "No preset", { className: "sw-muted" });
    const styleGuide = h("textarea", cur.presetText, { rows: "4" });
    const chapters = Array.isArray(story?.chapters) ? story.chapters : [];
    const chapterCount = story?.chapterCount ?? chapters.length;
    const showIntro = chapterCount === 0;
    const introArea = h("textarea", cur.intro, { rows: "4", maxlength: "4000" });
    const saveBtn = h("button", "Save", { type: "button", className: "sw-btn-primary" });
    const msg = h("p", "", { className: "sw-muted" });

    saveBtn.addEventListener("click", async () => {
      const next = normalizeSettings({
        ...cur,
        ...author.value(),
        presetName: cur.presetName,
        presetText: styleGuide.value ?? "",
        intro: showIntro ? (introArea.value ?? "").slice(0, 4000) : cur.intro,
      });
      saveBtn.disabled = true;
      msg.textContent = "";
      try {
        const res = await api().put(StoryWriterElement.storyPath(story.id, "/settings"), next);
        cur = normalizeSettings(res?.settings ?? next);
        if (story && typeof story === "object") story.settings = cur;
        msg.textContent = "Saved";
      } catch (error) {
        msg.textContent = error?.message ?? String(error);
      }
      saveBtn.disabled = false;
    });

    details.append(
      h("summary", "Author controls"),
      ...author.nodes,
      presetLabel,
      presetValue,
      h("label", "Style guide"),
      styleGuide,
      ...(showIntro ? [h("label", "Opening (optional)"), introArea] : []),
      saveBtn,
      msg,
    );
    return details;
  }

  startPolling(storyId, jobId) {
    // Keep only one poll loop per active job across re-renders.
    if (this.activeJobId === jobId && this.pollTimer) return;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.activeJobId = jobId;
    this.pollTimer = setInterval(() => this.pollJob(storyId, jobId), 2000);
  }

  async pollJob(storyId, jobId) {
    try {
      const job = await api().get(`/story-writer/jobs/${encodeURIComponent(jobId)}`);
      this.activeJob = job;
      if (job.status === "running") {
        // Update the status line only: a full re-render would reset an open plan editor and the reading pane.
        if (this.jobText && this.currentStory?.id === storyId) this.jobText.textContent = StoryWriterElement.jobLine(job);
        return;
      }
      this.stopPolling();
      this.activeJob = null;
      if (job.status === "error") {
        this.jobError = job.error || "Failed to write chapter.";
      }
      if (this.currentStory?.id === storyId) {
        await this.openStory(storyId);
      }
    } catch (error) {
      this.stopPolling();
      this.activeJob = null;
      this.jobError = error?.message ?? String(error);
      if (this.currentStory?.id === storyId) this.renderReader(this.currentStory);
    }
  }

  async openChapter(storyId, n) {
    try {
      const ch = await api().get(StoryWriterElement.storyPath(storyId, `/chapters/${n}`));
      this.readingChapter = ch;
      if (this.currentStory?.id === storyId) this.renderReader(this.currentStory);
    } catch (error) {
      this.jobError = `Could not load chapter: ${error?.message ?? error}`;
      if (this.currentStory?.id === storyId) this.renderReader(this.currentStory);
    }
  }

  renderReader(story) {
    if (this.currentStory && this.currentStory.id !== story.id) {
      this.planOpen = false;
      this.readingChapter = null;
    }
    this.currentStory = story;
    this.jobText = null;

    const isRunning = Boolean(this.activeJob && this.activeJob.storyId === story.id && this.activeJob.status === "running");
    const root = h("div", null, { className: "sw-root", style: "padding:24px;display:grid;gap:12px;max-width:720px" });

    const head = h("div", null, { className: "sw-head", style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" });
    const back = h("button", "Back to shelf", { type: "button", className: "sw-btn-ghost" });
    back.addEventListener("click", () => this.load());
    head.append(back, h("h2", story.title || "Untitled"));
    root.append(head);

    if (this.readerNotice) {
      const noticeBox = h("div", null, {
        className: "sw-card sw-bar",
        style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap",
      });
      const dismiss = h("button", "Dismiss", { type: "button", className: "sw-btn-ghost" });
      dismiss.addEventListener("click", () => {
        this.readerNotice = "";
        noticeBox.replaceChildren();
      });
      noticeBox.append(h("span", this.readerNotice), dismiss);
      root.append(noticeBox);
    }

    const statusMsg = h("p", this.jobError || "", { className: "sw-muted" });

    const controls = h("div", null, { className: "sw-bar", style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" });
    const nudgeLabel = h("label", "Nudge for the next chapter (optional)");
    const nudgeInput = h("input", null, { type: "text", value: "", placeholder: "Optional nudge" });
    const writeOne = h("button", "Write next chapter", { type: "button", className: "sw-btn-primary" });
    writeOne.disabled = isRunning;

    const autoLabel = h("label", "Autopilot");
    const autoInput = h("input", null, { type: "number", min: "1", max: "20", value: String(this.autopilotCount || 3) });
    const writeMany = h("button", "Write N chapters", { type: "button" });
    writeMany.disabled = isRunning;

    const startWrite = async (count) => {
      const n = Math.min(20, Math.max(1, Math.trunc(Number(count) || 1)));
      const nudge = (nudgeInput.value ?? "").trim() || undefined;
      writeOne.disabled = true;
      writeMany.disabled = true;
      statusMsg.textContent = "";
      this.jobError = "";
      try {
        const res = await api().post(StoryWriterElement.storyPath(story.id, "/write"), { count: n, nudge });
        nudgeInput.value = "";
        this.activeJob = { id: res.jobId, storyId: story.id, status: "running", done: 0, total: n, phase: "writing" };
        this.startPolling(story.id, res.jobId);
        this.renderReader(this.currentStory);
      } catch (error) {
        statusMsg.textContent = error?.message ?? String(error);
        writeOne.disabled = false;
        writeMany.disabled = false;
      }
    };

    writeOne.addEventListener("click", () => startWrite(1));
    writeMany.addEventListener("click", () => {
      this.autopilotCount = Math.min(20, Math.max(1, Math.trunc(Number(autoInput.value) || 3)));
      startWrite(this.autopilotCount);
    });

    const planSlot = h("div");
    const planBtn = h("button", "Plan", { type: "button" });
    planBtn.addEventListener("click", () => {
      this.planOpen = !this.planOpen;
      if (this.planOpen) {
        planSlot.replaceChildren(this.planPanel(story));
      } else {
        if (this.regenTimer) {
          clearTimeout(this.regenTimer);
          this.regenTimer = null;
        }
        planSlot.replaceChildren();
      }
    });
    if (this.planOpen) {
      planSlot.replaceChildren(this.planPanel(story));
    }

    const epubBtn = h("button", "Export EPUB", { type: "button" });
    epubBtn.addEventListener("click", async () => {
      epubBtn.disabled = true;
      statusMsg.textContent = "";
      try {
        await api().download(`/story-writer/epub/${encodeURIComponent(story.id)}`, "story.epub");
      } catch (error) {
        statusMsg.textContent = `Could not export: ${error?.message ?? error}`;
      }
      epubBtn.disabled = false;
    });

    let delArmed = false;
    const delBtn = h("button", "Delete story", { type: "button", className: "sw-btn-destructive" });
    delBtn.addEventListener("click", async () => {
      if (!delArmed) {
        delArmed = true;
        delBtn.textContent = "Confirm delete";
        this.deleteTimer = setTimeout(() => {
          delArmed = false;
          delBtn.textContent = "Delete story";
        }, 4000);
        return;
      }
      if (this.deleteTimer) {
        clearTimeout(this.deleteTimer);
        this.deleteTimer = null;
      }
      delBtn.disabled = true;
      try {
        await api().delete(StoryWriterElement.storyPath(story.id));
        this.stopPolling();
        await this.load();
      } catch (error) {
        statusMsg.textContent = `Could not delete story: ${error?.message ?? error}`;
        delBtn.disabled = false;
        delArmed = false;
        delBtn.textContent = "Delete story";
      }
    });

    controls.append(nudgeLabel, nudgeInput, writeOne, autoLabel, autoInput, writeMany, planBtn, epubBtn, delBtn);
    root.append(controls, this.settingsPanel(story), statusMsg);

    if (isRunning) {
      const job = this.activeJob;
      const jobBox = h("div", null, { className: "sw-bar", style: "display:flex;gap:8px;align-items:center" });
      const cancelBtn = h("button", "Cancel", { type: "button", className: "sw-btn-ghost" });
      cancelBtn.addEventListener("click", async () => {
        cancelBtn.disabled = true;
        try {
          await api().post(`/story-writer/jobs/${encodeURIComponent(job.id)}/cancel`, {});
          await this.pollJob(story.id, job.id);
        } catch (error) {
          statusMsg.textContent = `Could not cancel: ${error?.message ?? error}`;
          cancelBtn.disabled = false;
        }
      });
      this.jobText = h("span", StoryWriterElement.jobLine(job));
      jobBox.append(this.jobText, cancelBtn);
      root.append(jobBox);
    }

    root.append(planSlot);

    // Chapter list: only title, blurb, and wordCount are ever read or rendered.
    const listBox = h("div", null, { className: "sw-chapters", style: "display:grid;gap:8px" });
    const chapters = Array.isArray(story.chapters) ? story.chapters : [];
    if (!chapters.length) {
      listBox.append(h("p", "No chapters yet.", { className: "sw-muted", style: "opacity:0.7" }));
    }
    for (const ch of chapters) {
      const item = h("div", null, { className: "sw-chapter", style: "padding:8px 0;display:grid;gap:4px" });
      const top = h("div", null, { className: "sw-bar", style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap" });
      top.append(
        h("strong", `Chapter ${ch.n}: ${ch.title || `Chapter ${ch.n}`}`),
        h("span", `${ch.wordCount ?? 0} words`, { className: "sw-muted", style: "opacity:0.7" }),
      );
      const readBtn = h("button", "Read", { type: "button" });
      readBtn.addEventListener("click", () => this.openChapter(story.id, ch.n));
      top.append(readBtn);
      item.append(top);
      if (ch.blurb) {
        item.append(h("p", ch.blurb, { className: "sw-muted", style: "opacity:0.7;margin:0" }));
      }
      listBox.append(item);
    }
    root.append(listBox);

    if (this.readingChapter) {
      const ch = this.readingChapter;
      const pane = h("div", null, {
        className: "sw-reader-pane",
        style: "margin-top:16px;padding:16px;max-width:70ch;line-height:1.7;display:grid;gap:12px",
      });
      pane.append(h("h3", `Chapter ${ch.n}: ${ch.title || `Chapter ${ch.n}`}`));
      for (const p of StoryWriterElement.splitParagraphs(ch.text)) {
        pane.append(h("p", p, { style: "margin:0" }));
      }
      const nav = h("div", null, { className: "sw-bar", style: "display:flex;gap:8px" });
      const prev = h("button", "Previous chapter", { type: "button" });
      prev.disabled = ch.n <= 1;
      prev.addEventListener("click", () => {
        if (ch.n > 1) this.openChapter(story.id, ch.n - 1);
      });
      const totalCh = chapters.length || story.chapterCount || 0;
      const next = h("button", "Next chapter", { type: "button" });
      next.disabled = ch.n >= totalCh;
      next.addEventListener("click", () => {
        if (ch.n < totalCh) this.openChapter(story.id, ch.n + 1);
      });
      const close = h("button", "Close", { type: "button", className: "sw-btn-ghost" });
      close.addEventListener("click", () => {
        this.readingChapter = null;
        this.renderReader(this.currentStory);
      });
      nav.append(prev, next, close);
      pane.append(nav);
      root.append(pane);
    }

    this.setView(root);
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, StoryWriterElement);
