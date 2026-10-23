// Hidden author plan: pure helpers (no Engine imports) so they can be tested with a fake documents store.
export const PACKAGE_ID = "story-writer";
export const planId = (storyId) => `plan:${storyId}`;

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

// Snapshots of installed Engine agents (their prompt text), run after each chapter. "rewrite" returns edited text, "tracker" keeps notes.
const agents = (v) =>
  (Array.isArray(v) ? v : [])
    .map((a) => ({ type: str(a?.type, 100), name: str(a?.name, 100), kind: a?.kind === "tracker" ? "tracker" : "rewrite", prompt: str(a?.prompt, 12000), minScore: Math.min(10, Math.max(1, Math.round(Number(a?.minScore)) || 7)) }))
    .filter((a) => a.type && a.prompt)
    .slice(0, 5);

export const TWIST_LEVELS = ["none", "rare", "free"];

// Per-story author controls, editable between chapters. Lenient on purpose: bad values fall back to defaults.
export function normalizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const clamp = (v, lo, hi, d) => (Number.isFinite(Math.round(Number(v))) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
  return {
    twists: TWIST_LEVELS.includes(s.twists) ? s.twists : "rare",
    presetName: str(s.presetName, 200),
    presetText: str(s.presetText, 6000),
    intro: str(s.intro, 4000),
    checker: s.checker !== false,
    minScore: clamp(s.minScore, 1, 10, 7),
    maxRetries: clamp(s.maxRetries, 0, 3, 2),
    agents: agents(s.agents),
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

export async function readPlan(documents, storyId) {
  return (await documents.getById(PACKAGE_ID, planId(storyId))) ?? null;
}

// expectedRevision comes from the caller on edits; null means create-or-overwrite-latest (generation).
export async function writePlan(documents, storyId, data, expectedRevision = null, now = new Date().toISOString()) {
  const existing = await readPlan(documents, storyId);
  const base = { id: planId(storyId), packageId: PACKAGE_ID, name: `Plan ${storyId}`, description: "Story Writer hidden plan.", data, updatedAt: now };
  if (!existing) return documents.create({ ...base, kind: "plan", createdAt: now });
  if (expectedRevision !== null && expectedRevision !== existing.revision) return null;
  return documents.update({ ...base, expectedRevision: existing.revision });
}
