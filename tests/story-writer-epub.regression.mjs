import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEpub, chaptersFromDocs, crc32 } from "../packages/story-writer/epub.mjs";

const docs = [
  {
    n: 1,
    title: '  The *Start* & "End"  ',
    text: "# Duplicate Heading\n\nHe said <script>alert(1)</script> & **bold** and *it*.\nNext line.\n\n---\n\nAfter.",
  },
  { n: 2, title: "Empty Chapter", text: "   " },
  { n: 3, title: "   ", text: "No heading here." },
];
const chapters = chaptersFromDocs(docs);
assert.deepEqual(
  chapters.map((c) => c.title),
  ['The *Start* & "End"', "Chapter 3"],
);
assert.ok(!chapters[0].body.includes("Duplicate Heading") && chapters[0].body.startsWith("He said"));
assert.equal(chapters[1].body, "No heading here.");

const buf = buildEpub({
  id: "story:123e4567-e89b-12d3-a456-426614174000",
  title: 'T & <"x">',
  chapters,
  modified: new Date("2026-10-22T01:02:03.456Z"),
});

// Parse the zip independently from the central directory.
const eocd = buf.length - 22;
assert.equal(buf.readUInt32LE(eocd), 0x06054b50);
const count = buf.readUInt16LE(eocd + 10);
const entries = [];
for (let p = buf.readUInt32LE(eocd + 16), i = 0; i < count; i++) {
  assert.equal(buf.readUInt32LE(p), 0x02014b50);
  const nlen = buf.readUInt16LE(p + 28);
  const off = buf.readUInt32LE(p + 42);
  const name = buf.toString("utf8", p + 46, p + 46 + nlen);
  assert.equal(buf.readUInt32LE(off), 0x04034b50);
  assert.equal(buf.readUInt16LE(off + 8), 0, "stored");
  assert.equal(buf.readUInt16LE(off + 6) & 0x800, 0x800, "utf8 flag");
  assert.equal(buf.readUInt16LE(off + 28), 0, "no extra field");
  assert.equal(buf.readUInt32LE(off + 18), buf.readUInt32LE(off + 22));
  const size = buf.readUInt32LE(off + 22);
  const data = buf.subarray(off + 30 + buf.readUInt16LE(off + 26), off + 30 + buf.readUInt16LE(off + 26) + size);
  assert.equal(buf.readUInt32LE(off + 14), buf.readUInt32LE(p + 16));
  // Bitwise CRC, independent of the table in epub.mjs.
  let c = ~0;
  for (const b of data) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  assert.equal(buf.readUInt32LE(off + 14), ~c >>> 0, `crc ${name}`);
  assert.equal(crc32(data), ~c >>> 0);
  entries.push({ name, text: data.toString("utf8"), off });
  p += 46 + nlen;
}
assert.equal(entries[0].off, 0);
assert.deepEqual(entries.map((e) => e.name), ["mimetype", "META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/ch001.xhtml", "OEBPS/ch002.xhtml"]);
assert.equal(entries[0].text, "application/epub+zip");

const ch1 = entries[4].text;
assert.ok(!ch1.includes("<script>") && ch1.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
assert.ok(ch1.includes("&amp;") && ch1.includes("<strong>bold</strong>") && ch1.includes("<em>it</em>") && ch1.includes("<br/>") && ch1.includes("<hr/>"));
assert.ok(entries[2].text.includes("urn:uuid:123e4567") && entries[2].text.includes('>2026-10-22T01:02:03Z<'));
assert.ok(entries[3].text.includes('epub:type="toc"') && entries[3].text.includes("ch002.xhtml"));

const dir = mkdtempSync(join(tmpdir(), "epub-"));
const have = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
if (have("xmllint", ["--version"]).error) console.log("skip: xmllint missing");
else for (const e of entries.slice(1)) {
  writeFileSync(join(dir, "x.xml"), e.text);
  const r = have("xmllint", ["--noout", join(dir, "x.xml")]);
  assert.equal(r.status, 0, `${e.name}: ${r.stderr}`);
}
const file = join(dir, "t.epub");
writeFileSync(file, buf);
const z = have("python3", ["-I", "-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;i=z.infolist();assert i[0].filename=='mimetype' and i[0].compress_type==0;print(len(i))", file]);
if (z.error) console.log("skip: python3 missing"); else assert.equal(z.status, 0, z.stderr);
const u = have("unzip", ["-t", file]);
if (u.error) console.log("skip: unzip missing"); else assert.equal(u.status, 0, u.stdout);
console.log("story-writer epub ok");
