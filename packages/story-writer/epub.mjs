const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';
// XML 1.0 forbids most control characters even when escaped, so drop them first.
const esc = (s) =>
  String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Runs after esc(), so the only markup in the output is what these two patterns add.
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");

export function proseToXhtml(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p === "---" ? "<hr/>" : `<p>${p.split("\n").map(inline).join("<br/>")}</p>`))
    .join("\n");
}

// Strip a leading "# Heading" line because the builder renders the chapter title as <h1>.
export function chaptersFromDocs(docs) {
  const out = [];
  for (const d of docs) {
    const body = String(d?.text ?? "").trim().replace(/^#+[ \t]+.+\n?/, "").trim();
    if (!body) continue;
    const title = String(d?.title ?? "").trim() || `Chapter ${d?.n ?? out.length + 1}`;
    out.push({ title, body });
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// STORE-only zip. Fixed DOS time (1980-01-01) keeps output reproducible.
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(0x0800, 6); // UTF-8 names; method (8) and time (10) stay 0 = STORE
    l.writeUInt16LE(0x21, 12);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(data.length, 18);
    l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(l, n, data);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function buildEpub({ id, title, chapters, modified = new Date() }) {
  const rawId = String(id).replace(/^story:/, "");
  const uid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId) ? `urn:uuid:${rawId}` : String(id);
  const stamp = modified.toISOString().replace(/\.\d+Z$/, "Z");
  const files = chapters.map((_, i) => `ch${String(i + 1).padStart(3, "0")}.xhtml`);
  const page = (t, inner) =>
    `${XML}<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><meta charset="utf-8"/><title>${esc(t)}</title></head><body>${inner}</body></html>\n`;
  return zip([
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", `${XML}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n`],
    ["OEBPS/content.opf", `${XML}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${esc(uid)}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${stamp}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${files.map((f, i) => `<item id="c${i + 1}" href="${f}" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${files.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>\n`],
    ["OEBPS/nav.xhtml", page(title, `<nav epub:type="toc"><h1>${esc(title)}</h1><ol>${chapters.map((c, i) => `<li><a href="${files[i]}">${esc(c.title)}</a></li>`).join("")}</ol></nav>`)],
    ...chapters.map((c, i) => [`OEBPS/${files[i]}`, page(c.title, `<h1>${esc(c.title)}</h1>\n${proseToXhtml(c.body)}`)]),
  ]);
}
