import { readFile, writeFile } from "node:fs/promises";

const usage = "Usage: node tools/version.mjs <major|minor|patch|set VERSION> [--compat VERSION]";
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function validateVersion(version) {
  if (typeof version !== "string" || !versionPattern.test(version)) {
    throw new Error(`Invalid version: ${String(version)}. Expected X.Y.Z without leading zeroes.`);
  }
  return version;
}

function validateObject(value, name) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${name} must contain an object.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let compatibility;
  const positional = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--compat") {
      if (compatibility !== undefined) throw new Error(usage);
      compatibility = validateVersion(args[++index]);
    } else {
      positional.push(arg);
    }
  }

  const [command, explicitVersion] = positional;
  if (!((command === "set" && positional.length === 2)
    || (["major", "minor", "patch"].includes(command) && positional.length === 1))) {
    throw new Error(usage);
  }
  if (command === "set") validateVersion(explicitVersion);

  const root = new URL("../", import.meta.url);
  const filenames = ["package.json", "manifest.json", "versions.json", "package-lock.json"];
  const files = await Promise.all(filenames.map(async (filename) => {
    const url = new URL(filename, root);
    try {
      const data = JSON.parse(await readFile(url, "utf8"));
      validateObject(data, filename);
      return { url, data };
    } catch (error) {
      if (filename === "package-lock.json" && error.code === "ENOENT") return undefined;
      throw error;
    }
  }));
  const [packageFile, manifestFile, versionsFile, lockFile] = files;
  const currentVersion = validateVersion(packageFile.data.version);
  let nextVersion = explicitVersion;
  if (command !== "set") {
    const parts = currentVersion.split(".").map(BigInt);
    const index = ["major", "minor", "patch"].indexOf(command);
    parts[index] += 1n;
    parts.fill(0n, index + 1);
    nextVersion = parts.join(".");
  }
  const minAppVersion = validateVersion(compatibility ?? manifestFile.data.minAppVersion);
  if (lockFile?.data.packages !== undefined) {
    validateObject(lockFile.data.packages, "package-lock.json packages");
    if (lockFile.data.packages[""] !== undefined) {
      validateObject(lockFile.data.packages[""], "package-lock.json root package");
    }
  }

  packageFile.data.version = nextVersion;
  manifestFile.data.version = nextVersion;
  manifestFile.data.minAppVersion = minAppVersion;
  versionsFile.data[nextVersion] = minAppVersion;
  if (lockFile) {
    lockFile.data.version = nextVersion;
    if (lockFile.data.packages?.[""]) lockFile.data.packages[""].version = nextVersion;
  }
  for (const file of files) {
    if (file) await writeFile(file.url, `${JSON.stringify(file.data, null, 2)}\n`);
  }
  console.log(`Version ${nextVersion} (Obsidian >= ${minAppVersion})`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
