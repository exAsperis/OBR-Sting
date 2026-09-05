import { access, readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const packageJson = await readJson("package.json");
const manifest = await readJson("public/manifest.json");
const localManifest = await readJson("public/manifest-local.json");
const expected = packageJson.version;
const versionedPath = `public/manifest-v${expected}.json`;

await access(versionedPath);
const versionedManifest = await readJson(versionedPath);
const versionSource = await readFile("src/version.ts", "utf8");
const versionMatch = versionSource.match(/RELEASE_VERSION\s*=\s*["']([^"']+)["']/);

if (!versionMatch) throw new Error("Could not read RELEASE_VERSION from src/version.ts.");

const versions = new Map([
  ["package.json", expected],
  ["public/manifest.json", manifest.version],
  ["public/manifest-local.json", localManifest.version],
  [versionedPath, versionedManifest.version],
  ["manifest popover query", new URL(manifest.action.popover).searchParams.get("v")],
  ["manifest icon query", new URL(manifest.icon).searchParams.get("v")],
  ["manifest action icon query", new URL(manifest.action.icon).searchParams.get("v")],
  ["manifest background query", new URL(manifest.background_url).searchParams.get("v")],
  ["src/version.ts", versionMatch[1]],
]);

const drift = [...versions].filter(([, version]) => version !== expected);
if (drift.length) {
  throw new Error(`Release version drift (expected ${expected}): ${drift.map(([location, version]) => `${location}=${String(version)}`).join(", ")}`);
}

if (JSON.stringify(manifest) !== JSON.stringify(versionedManifest)) {
  throw new Error(`${versionedPath} must exactly match public/manifest.json.`);
}

console.log(`Release versions synchronized at ${expected}.`);
