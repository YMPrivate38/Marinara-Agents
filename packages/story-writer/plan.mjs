// Hidden author plan: pure helpers (no Engine imports) so they can be tested with a fake documents store.
export const PACKAGE_ID = "story-writer";
export const planId = (chatId) => `plan:${chatId}`;

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const strings = (v, n, len) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, n) : []);
const twists = (v) =>
  (Array.isArray(v) ? v : [])
    .map((t) => (typeof t === "string" ? { text: str(t, 300), reveal: null } : { text: str(t?.text, 300), reveal: str(t?.reveal, 80) || null }))
    .filter((t) => t.text)
    .slice(0, 12);

export const POVS = ["third person limited", "third person omniscient", "first person", "second person"];
export const TENSES = ["past", "present"];
export function normalizeStyle(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const words = Math.round(Number(s.chapterWords));
  return {
    chapterWords: Number.isFinite(words) ? Math.min(8000, Math.max(300, words)) : 2500,
    pointOfView: POVS.includes(s.pointOfView) ? s.pointOfView : POVS[0],
    tense: TENSES.includes(s.tense) ? s.tense : TENSES[0],
  };
}

export function normalizePlan(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    premise: str(p.premise, 2000),
    outline: strings(p.outline, 20, 300),
    secrets: strings(p.secrets, 20, 300),
    twists: twists(p.twists),
    offscreen: strings(p.offscreen, 20, 300),
    threads: strings(p.threads, 20, 300),
    beat: str(p.beat, 800),
    chapter: Number.isInteger(p.chapter) && p.chapter >= 0 ? Math.min(p.chapter, 9999) : 0,
    updatedAt: str(p.updatedAt, 40),
    style: normalizeStyle(p.style),
  };
}

// Only known fields are taken (style is never taken from the agent); a missing beat clears the old one so a stale beat is never replayed.
export function mergePlanUpdate(plan, update, now = new Date().toISOString()) {
  const cur = normalizePlan(plan);
  const u = update && typeof update === "object" ? update : {};
  const next = normalizePlan({ ...cur, ...Object.fromEntries(["outline", "secrets", "twists", "offscreen", "threads"].filter((k) => Array.isArray(u[k])).map((k) => [k, u[k]])), beat: u.beat });
  return { ...next, chapter: cur.chapter + 1, updatedAt: now };
}

// The only plan text that ever reaches the writer prompt: style (not a spoiler) and the beat.
export function beatBlock(plan) {
  const { beat, style } = normalizePlan(plan);
  const head = `Write your next reply as ONE complete chapter of about ${style.chapterWords} words, in ${style.pointOfView}, ${style.tense} tense. Continue directly from where the previous chapter ended and end on a natural chapter break (a cliffhanger, a reveal or a quiet turn), not a recap or a moral. Do not wait for the user.`;
  return beat ? `${head}\nDeliver this beat. Do not mention that it was planned.\nBeat: ${beat}` : head;
}

export async function readPlan(documents, chatId) {
  return (await documents.getById(PACKAGE_ID, planId(chatId))) ?? null;
}

// expectedRevision comes from the caller on edits; null means create-or-overwrite-latest (generation).
export async function writePlan(documents, chatId, data, expectedRevision = null, now = new Date().toISOString()) {
  const existing = await readPlan(documents, chatId);
  const base = { id: planId(chatId), packageId: PACKAGE_ID, name: `Plan ${chatId}`, description: "Story Writer hidden plan.", data, updatedAt: now };
  if (!existing) return documents.create({ ...base, kind: "plan", createdAt: now });
  if (expectedRevision !== null && expectedRevision !== existing.revision) return null;
  return documents.update({ ...base, expectedRevision: existing.revision });
}

export function createContributor(documents) {
  return async ({ chatId, chatMeta }) => {
    if (chatMeta?.storyWriter !== true) return undefined;
    try {
      const doc = await readPlan(documents, chatId);
      return doc ? beatBlock(doc.data) : undefined;
    } catch {
      return undefined; // a failed read must never block the chapter
    }
  };
}

// Hooks keyed `agent-runtime:<agent.type>`; the agent id equals the package id so this service is the one called.
export function createAgentRuntime(documents, parseJsonish) {
  return {
    async prepareContext({ context }) {
      const doc = await readPlan(documents, context.chatId);
      return doc ? normalizePlan(doc.data) : null;
    },
    async finalizeResult({ context, result }) {
      // The result is always blanked: the plan must not appear in the agent panel or be replayed as an injection.
      const blank = { ...result, data: { text: "" } };
      const doc = await readPlan(documents, context.chatId);
      if (!doc || !result.success) return blank;
      const raw = typeof result.data === "string" ? result.data : result.data?.text;
      let update;
      try { update = parseJsonish(String(raw ?? "")); } catch { update = null; }
      if (!update || typeof update !== "object" || Array.isArray(update)) return { ...blank, success: false, error: "Plan update was not valid JSON" };
      const saved = await writePlan(documents, context.chatId, mergePlanUpdate(doc.data, update), doc.revision);
      return saved ? blank : { ...blank, success: false, error: "Plan changed while updating; try again" };
    },
  };
}
