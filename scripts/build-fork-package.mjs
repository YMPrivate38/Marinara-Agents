// Build a fork-owned package (node scripts/build-fork-package.mjs <id>): re-derive its manifest hashes and English locale
// from the committed payloads, write a reproducible artifact zip, and update the
// catalog family. The client.js and server.mjs payloads are contributed as pre-built
// esbuild bundles from the package's own source tree, which lives outside this
// repository; this builder never regenerates them — it only re-derives everything
// the catalog checks from the committed bytes.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readCatalogFamily, writeCatalogFamily } from "./catalog-lanes.mjs";
import { withPackageActivationGuidance } from "./catalog-package-guidance.mjs";
import { resolveContainedPortablePath } from "./catalog-path-safety.mjs";
import { writeEnglishPackageLocale } from "./package-locales.mjs";
import { createDeterministicZip } from "./deterministic-zip.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const id = process.argv[2];
if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) throw new Error("usage: build-fork-package.mjs <package-id>");
const packageRoot = join(repoRoot, "packages", id);
const artifactsDir = join(repoRoot, "artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const manifest = JSON.parse(await readFile(join(packageRoot, "manifest.json"), "utf8"));
manifest.description = withPackageActivationGuidance(manifest.id, manifest.description);

const agentDefinitions = JSON.parse(await readFile(join(packageRoot, "agents.json"), "utf8"));
const agentsBuffer = Buffer.from(`${JSON.stringify(agentDefinitions, null, 2)}\n`);
await writeFile(join(packageRoot, "agents.json"), agentsBuffer);

// The declared payload paths are the contract; their hashes and sizes are re-derived
// from the committed bytes so they can never drift from what actually ships.
const payloads = [];
for (const declared of manifest.files) {
  const path = await resolveContainedPortablePath(packageRoot, declared.path, `Payload for ${manifest.id}`);
  const buffer = declared.path === "agents.json" ? agentsBuffer : await readFile(path);
  payloads.push({ name: declared.path, buffer });
}
manifest.files = payloads.map(({ name, buffer }) => ({ path: name, sha256: sha256(buffer), bytes: buffer.byteLength }));

const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(packageRoot, "manifest.json"), manifestBuffer);
await writeEnglishPackageLocale(packageRoot, manifest, agentDefinitions);

const archive = createDeterministicZip([
  { name: "manifest.json", data: manifestBuffer },
  ...payloads.map(({ name, buffer }) => ({ name, data: buffer })),
]);
await mkdir(artifactsDir, { recursive: true });
const artifactPath = join(artifactsDir, `${id}-${manifest.version}.zip`);
await writeFile(artifactPath, archive);

const { catalog } = await readCatalogFamily(repoRoot);
catalog.packages = catalog.packages.filter((entry) => entry.manifest.id !== id);
catalog.packages.push({
  manifest,
  category: "misc",
  artifact: {
    url: `https://raw.githubusercontent.com/YMPrivate38/Marinara-Agents/main/artifacts/${basename(artifactPath)}`,
    sha256: sha256(archive),
    bytes: archive.byteLength,
  },
  documentationUrl: `https://github.com/YMPrivate38/Marinara-Agents/blob/main/packages/${id}/README.md`,
});
catalog.packages.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
// generatedAt is resolved centrally in writeCatalogFamily (preserved by
// default; refreshed only when MARINARA_CATALOG_STAMP_GENERATED_AT=1).
await writeCatalogFamily(repoRoot, catalog);

console.log(`built ${id} ${manifest.version}`);
console.log(`  ${payloads.length} payload files, artifact ${archive.byteLength} bytes`);
