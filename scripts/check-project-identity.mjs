import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const constantsSource = await readFile("src/constants.ts", "utf8");
const manifest = await readJson("public/manifest.json");
const localManifest = await readJson("public/manifest-local.json");
const packageJson = await readJson("package.json");
const staticWebApp = await readJson("public/staticwebapp.config.json");

const readConstant = (name) => constantsSource.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*["']([^"']+)["']`))?.[1];
const extensionName = readConstant("EXTENSION_NAME");
const extensionId = readConstant("EXTENSION_ID");

if (!extensionName || !extensionId) throw new Error("Could not read EXTENSION_NAME and EXTENSION_ID from src/constants.ts.");

const slug = extensionName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const expectedId = `com.ex-asperis.${slug}`;
const failures = [];

if (extensionId !== expectedId) failures.push(`EXTENSION_ID must be ${expectedId}, received ${extensionId}`);
if (packageJson.name !== slug) failures.push(`package.json name must be ${slug}, received ${packageJson.name}`);
if (manifest.name !== extensionName) failures.push(`manifest name must be ${extensionName}, received ${manifest.name}`);
if (manifest.author !== "ex Asperis") failures.push(`manifest author must be ex Asperis, received ${String(manifest.author)}`);
if (localManifest.name !== `${extensionName} (Local)`) failures.push(`local manifest name must be ${extensionName} (Local), received ${localManifest.name}`);
if (localManifest.author !== "ex Asperis") failures.push(`local manifest author must be ex Asperis, received ${String(localManifest.author)}`);
if (localManifest.action?.title !== `${extensionName} (Local)`) failures.push(`local manifest action title must be ${extensionName} (Local), received ${String(localManifest.action?.title)}`);
if (localManifest.action?.popover !== "http://localhost:5173/extension.html") failures.push(`local manifest popover must be http://localhost:5173/extension.html, received ${String(localManifest.action?.popover)}`);
if (staticWebApp.globalHeaders?.["Access-Control-Allow-Origin"] !== "https://www.owlbear.rodeo") failures.push("Azure Static Web Apps must allow the Owlbear Rodeo origin");

try {
  const storeSource = await readFile("public/store.md", "utf8");
  const storeAuthor = storeSource.match(/^author:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1]?.trim();
  if (storeAuthor !== "ex Asperis") failures.push(`public/store.md author must be ex Asperis, received ${String(storeAuthor)}`);
} catch (cause) {
  if (cause?.code !== "ENOENT") throw cause;
}

const domainIds = [...constantsSource.matchAll(/com\.[a-z0-9.-]+/g)].map((match) => match[0]);
const unexpectedIds = [...new Set(domainIds.filter((id) => id !== extensionId))];
if (unexpectedIds.length) failures.push(`unexpected namespace identifiers in src/constants.ts: ${unexpectedIds.join(", ")}`);

if (failures.length) throw new Error(`Project identity check failed:\n- ${failures.join("\n- ")}`);

console.log(`Project identity verified: ${extensionId}; published author ex Asperis.`);
