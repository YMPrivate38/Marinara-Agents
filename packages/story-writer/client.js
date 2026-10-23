const TAG = "marinara-capability-story-writer";
const POVS = ["third person limited", "third person omniscient", "first person", "second person"];
const TENSES = ["past", "present"];
const LISTS = ["outline", "secrets", "offscreen", "threads", "twists"];
const PHASES = {
  writing: "Writing",
  checking: "Checking the characters",
  rewriting: "Fixing problems",
  planning: "Planning what comes next",
};

const h = (tag, text, attrs = {}) => {
  const e = document.createElement(tag);
  if (text != null) {
    e.textContent = text;
    if (tag === "textarea") e.value = text;
  }
  for (const k in attrs) {
    e.setAttribute(k, attrs[k]);
    if (k === "value") e.value = attrs[k];
  }
  return e;
};
const api = () => globalThis.__MARINARA_HOST__.api.api;
let pickerSeq = 0;

class StoryWriterElement extends HTMLElement {
  static connections(rows) {
    return (Array.isArray(rows) ? rows : []).filter((r) => r && r.provider !== "decision");
  }
  // Character rows keep the card as a JSON string or object in `data`.
  static characterName(row) {
    try {
      return (typeof row?.data === "string" ? JSON.parse(row.data) : row?.data)?.name || row?.name || row?.id || "";
    } catch {
      return row?.name || row?.id || "";
    }
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
  static picker({ label, path, nameOf = (r) => r?.name || r?.id || "", max = 20, sort = "" } = {}) {
    const text = /^(characters|lorebooks)$/i.test(label) ? `Search ${label.toLowerCase()}` : label || "Search";
    const hideOnFail = path === "/lorebooks";
    const inputId = `sw-picker-${++pickerSeq}`;
    const wrap = h("div", null, { style: hideOnFail ? "display:none" : "display:grid;gap:6px" });
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
    const chipsBox = h("div", null, { style: "display:flex;gap:6px;flex-wrap:wrap" });
    const countEl = h("span", `0 of ${max} selected`, { style: "opacity:0.7" });
    const input = h("input", null, { type: "search", id: inputId, "aria-label": text, value: "", placeholder: text });
    const statusEl = h("p", "");
    const resultsBox = h("div", null, { style: "display:grid;gap:4px" });
    const moreBox = h("div");
    const moreBtn = h("button", "Load more", { type: "button" });

    const renderChips = () => {
      countEl.textContent = `${selected.length} of ${max} selected`;
      const chips = selected.map((item) => {
        const chip = h("span", null, { style: "display:inline-flex;gap:4px;align-items:center" });
        const rm = h("button", "×", { type: "button", "aria-label": `Remove ${item.name}` });
        rm.addEventListener("click", () => {
          selected = selected.filter((s) => s.id !== item.id);
          if (statusEl.textContent === `Limit of ${max} reached.`) statusEl.textContent = "";
          renderChips();
          renderResults();
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
    this.replaceChildren(h("p", "Loading stories…"));
    try {
      const stories = await api().get("/story-writer/stories");
      this.renderShelf(Array.isArray(stories) ? stories : []);
    } catch (error) {
      const retry = h("button", "Retry", { type: "button" });
      retry.addEventListener("click", () => this.load());
      this.replaceChildren(h("p", `Could not load stories: ${error?.message ?? error}`), retry);
    }
  }

  render(stories) {
    this.renderShelf(stories);
  }

  renderShelf(stories = []) {
    const root = h("div", null, { style: "padding:24px;display:grid;gap:12px;max-width:720px" });
    const head = h("div", null, { style: "display:flex;gap:12px;align-items:center;justify-content:space-between" });
    const newBtn = h("button", "New story", { type: "button" });
    newBtn.addEventListener("click", () => this.openNewStoryForm());
    head.append(h("h2", "Story Writer"), newBtn);
    root.append(head);

    const list = Array.isArray(stories) ? stories : [];
    if (!list.length) {
      root.append(h("p", "No stories yet."));
    }
    for (const s of list) {
      const row = h("div", null, { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:6px 0" });
      const when = s.lastChapterAt ?? s.createdAt ?? s.updatedAt;
      row.append(
        h("strong", s.title || s.name || "Untitled"),
        h("span", `${s.chapterCount ?? 0} chapters`, { style: "opacity:0.7" }),
        h("span", when ? new Date(when).toLocaleString() : "", { style: "opacity:0.7" }),
      );
      const open = h("button", "Open", { type: "button" });
      open.addEventListener("click", () => this.openStory(s.id));
      row.append(open);
      root.append(row);
    }
    this.replaceChildren(root);
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
    const root = h("div", null, { style: "padding:24px;display:grid;gap:12px;max-width:560px" });
    const back = h("button", "Back", { type: "button" });
    back.addEventListener("click", () => this.load());
    const head = h("div", null, { style: "display:flex;gap:12px;align-items:center" });
    head.append(back, h("h2", "New story"));
    root.append(head);

    const form = h("form", null, { style: "display:grid;gap:8px" });
    const title = h("input", null, { type: "text", required: "", maxlength: "200", value: "", placeholder: "Story title" });
    const premise = h("textarea", "", { rows: "4", maxlength: "2000", placeholder: "Premise (optional)" });
    const conn = h("select");
    conn.append(h("option", "Engine default", { value: "" }));
    for (const c of StoryWriterElement.connections(connections)) {
      conn.append(h("option", c.name || c.id, { value: c.id }));
    }
    conn.value = "";

    const charPicker = StoryWriterElement.picker({
      label: "Search characters",
      path: "/characters",
      nameOf: StoryWriterElement.characterName,
      max: 20,
      sort: "name-asc",
    });
    const lorePicker = StoryWriterElement.picker({
      label: "Search lorebooks",
      path: "/lorebooks",
      nameOf: (l) => l?.name || l?.id || "",
      max: 20,
    });

    const style = StoryWriterElement.styleFields({ chapterWords: 2500, pointOfView: POVS[0], tense: "past" });
    const status = h("p", "");
    const submit = h("button", "Create story", { type: "submit" });

    form.append(
      h("label", "Title"),
      title,
      h("label", "Premise"),
      premise,
      h("label", "Connection"),
      conn,
      ...charPicker.nodes,
      ...lorePicker.nodes,
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
        const res = await api().post("/story-writer/stories", {
          title: cleanTitle,
          premise: cleanPremise,
          characterIds,
          lorebookIds,
          connectionId: conn.value || null,
          style: style.value(),
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
    this.replaceChildren(root);
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
      const back = h("button", "Back", { type: "button" });
      back.addEventListener("click", () => this.load());
      this.replaceChildren(h("p", `Could not load story: ${error?.message ?? error}`), back);
    }
  }

  planPanel(story) {
    const box = h("div", null, { style: "padding:12px;display:grid;gap:8px;max-width:560px" });
    const url = StoryWriterElement.storyPath(story.id, "/plan");
    let state = { plan: null, revision: null };
    let shown = false;
    let armed = false;
    let conflict = false;
    const msg = h("p", "");

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
      const style = StoryWriterElement.styleFields(plan.style);
      kids.push(...style.nodes);

      if (!shown) {
        kids.push(h("p", "Spoilers hidden"));
      }
      const reveal = h("button", shown ? "Hide spoilers" : "Reveal spoilers", { type: "button" });
      reveal.addEventListener("click", () => {
        shown = !shown;
        draw();
      });

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

      const save = h("button", "Save", { type: "button" });
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
          this.regenTimer = setTimeout(() => {
            armed = false;
            regen.textContent = "Regenerate";
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

      const bar = h("div", null, { style: "display:flex;gap:8px;flex-wrap:wrap" });
      bar.append(reveal, save, regen);
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
    const root = h("div", null, { style: "padding:24px;display:grid;gap:12px;max-width:720px" });

    const head = h("div", null, { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" });
    const back = h("button", "Back to shelf", { type: "button" });
    back.addEventListener("click", () => this.load());
    head.append(back, h("h2", story.title || "Untitled"));
    root.append(head);

    if (this.readerNotice) {
      const noticeBox = h("div", null, { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" });
      const dismiss = h("button", "Dismiss", { type: "button" });
      dismiss.addEventListener("click", () => {
        this.readerNotice = "";
        noticeBox.replaceChildren();
      });
      noticeBox.append(h("span", this.readerNotice), dismiss);
      root.append(noticeBox);
    }

    const statusMsg = h("p", this.jobError || "");

    const controls = h("div", null, { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" });
    const nudgeLabel = h("label", "Nudge for the next chapter (optional)");
    const nudgeInput = h("input", null, { type: "text", value: "", placeholder: "Optional nudge" });
    const writeOne = h("button", "Write next chapter", { type: "button" });
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
    const delBtn = h("button", "Delete story", { type: "button" });
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
    root.append(controls, statusMsg);

    if (isRunning) {
      const job = this.activeJob;
      const jobBox = h("div", null, { style: "display:flex;gap:8px;align-items:center" });
      const cancelBtn = h("button", "Cancel", { type: "button" });
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
    const listBox = h("div", null, { style: "display:grid;gap:8px" });
    const chapters = Array.isArray(story.chapters) ? story.chapters : [];
    if (!chapters.length) {
      listBox.append(h("p", "No chapters yet.", { style: "opacity:0.7" }));
    }
    for (const ch of chapters) {
      const item = h("div", null, { style: "padding:8px 0;display:grid;gap:4px" });
      const top = h("div", null, { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap" });
      top.append(
        h("strong", `Chapter ${ch.n}: ${ch.title || `Chapter ${ch.n}`}`),
        h("span", `${ch.wordCount ?? 0} words`, { style: "opacity:0.7" }),
      );
      const readBtn = h("button", "Read", { type: "button" });
      readBtn.addEventListener("click", () => this.openChapter(story.id, ch.n));
      top.append(readBtn);
      item.append(top);
      if (ch.blurb) {
        item.append(h("p", ch.blurb, { style: "opacity:0.7;margin:0" }));
      }
      listBox.append(item);
    }
    root.append(listBox);

    if (this.readingChapter) {
      const ch = this.readingChapter;
      const pane = h("div", null, {
        style: "margin-top:16px;padding:16px;max-width:65ch;line-height:1.6;display:grid;gap:12px",
      });
      pane.append(h("h3", `Chapter ${ch.n}: ${ch.title || `Chapter ${ch.n}`}`));
      for (const p of StoryWriterElement.splitParagraphs(ch.text)) {
        pane.append(h("p", p, { style: "margin:0" }));
      }
      const nav = h("div", null, { style: "display:flex;gap:8px" });
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
      const close = h("button", "Close", { type: "button" });
      close.addEventListener("click", () => {
        this.readingChapter = null;
        this.renderReader(this.currentStory);
      });
      nav.append(prev, next, close);
      pane.append(nav);
      root.append(pane);
    }

    this.replaceChildren(root);
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, StoryWriterElement);
