import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const initial = {
  "package.json": { name: "fixture", version: "1.2.3" },
  "manifest.json": { name: "Theme", version: "1.2.3", minAppVersion: "1.10.6" },
  "versions.json": { "1.0.0": "1.9.0" },
  "package-lock.json": {
    version: "1.2.2", lockfileVersion: 3,
    packages: { "": { version: "1.2.2" }, "node_modules/dependency": { version: "9.0.0" } }
  }
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "theme-version-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tools"));
  const script = join(root, "tools", "version.mjs");
  copyFileSync(new URL("./version.mjs", import.meta.url), script);
  const write = (name, data) => writeFileSync(join(root, name), `${JSON.stringify(data, null, 2)}\n`);
  for (const [name, data] of Object.entries(initial)) write(name, data);
  return {
    root,
    write,
    read: (name) => JSON.parse(readFileSync(join(root, name), "utf8")),
    snapshot: () => Object.fromEntries(Object.keys(initial).map((name) => [
      name, existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : null
    ])),
    run: (...args) => spawnSync(process.execPath, [script, ...args], { cwd: tmpdir(), encoding: "utf8" })
  };
}

function succeeds(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
}

for (const [command, expected] of [["major", "2.0.0"], ["minor", "1.3.0"], ["patch", "1.2.4"]]) {
  test(`bumps ${command} from another directory and synchronizes all metadata`, (t) => {
    const f = fixture(t);
    const result = f.run(command);
    succeeds(result);
    assert.match(result.stdout, new RegExp(`Version ${expected.replaceAll(".", "\\.")}`));
    assert.deepEqual(f.read("package.json"), { ...initial["package.json"], version: expected });
    assert.deepEqual(f.read("manifest.json"), { ...initial["manifest.json"], version: expected });
    assert.deepEqual(f.read("versions.json"), { "1.0.0": "1.9.0", [expected]: "1.10.6" });
    assert.deepEqual(f.read("package-lock.json"), {
      version: expected, lockfileVersion: 3,
      packages: { "": { version: expected }, "node_modules/dependency": { version: "9.0.0" } }
    });
    for (const contents of Object.values(f.snapshot())) {
      assert.equal(contents.endsWith("\n"), true);
      assert.equal(contents.includes("\r"), false);
    }
  });
}

for (const args of [
  ["set", "3.2.1", "--compat", "1.11.0"],
  ["--compat", "1.11.0", "set", "3.2.1"],
  ["patch", "--compat", "1.11.0"]
]) {
  test(`overrides compatibility: ${args.join(" ")}`, (t) => {
    const f = fixture(t);
    const expected = args.includes("set") ? "3.2.1" : "1.2.4";
    succeeds(f.run(...args));
    assert.equal(f.read("package.json").version, expected);
    assert.deepEqual(f.read("manifest.json"), {
      ...initial["manifest.json"], version: expected, minAppVersion: "1.11.0"
    });
    assert.deepEqual(f.read("versions.json"), { "1.0.0": "1.9.0", [expected]: "1.11.0" });
    assert.equal(f.read("package-lock.json").version, expected);
    assert.equal(f.read("package-lock.json").packages[""].version, expected);
  });
}

test("sets an explicit version and preserves the minimum and history", (t) => {
  const f = fixture(t);
  succeeds(f.run("set", "0.9.0"));
  assert.equal(f.read("package.json").version, "0.9.0");
  assert.deepEqual(f.read("manifest.json"), { ...initial["manifest.json"], version: "0.9.0" });
  assert.deepEqual(f.read("versions.json"), { "1.0.0": "1.9.0", "0.9.0": "1.10.6" });
  assert.equal(f.read("package-lock.json").packages[""].version, "0.9.0");
});

test("supports an absent lockfile without creating one", (t) => {
  const f = fixture(t);
  rmSync(join(f.root, "package-lock.json"));
  succeeds(f.run("patch"));
  assert.equal(f.read("package.json").version, "1.2.4");
  assert.equal(existsSync(join(f.root, "package-lock.json")), false);
});

test("supports legacy lockfiles without a packages map", (t) => {
  const f = fixture(t);
  f.write("package-lock.json", { version: "1.2.3", lockfileVersion: 1, dependencies: {} });
  succeeds(f.run("minor"));
  assert.deepEqual(f.read("package-lock.json"), { version: "1.3.0", lockfileVersion: 1, dependencies: {} });
});

test("increments version components without losing integer precision", (t) => {
  const f = fixture(t);
  f.write("package.json", { ...initial["package.json"], version: "1.2.9007199254740992" });
  succeeds(f.run("patch"));
  assert.equal(f.read("package.json").version, "1.2.9007199254740993");
});

for (const args of [
  [], ["unknown"], ["patch", "extra"], ["set"], ["set", "1.2"],
  ["set", "v1.2.3"], ["set", "01.2.3"], ["set", "1.2.3-beta"],
  ["set", "1.2.3+build"], ["set", "-1.2.3"], ["patch", "--unknown"],
  ["patch", "--compat"], ["patch", "--compat", "bad"],
  ["patch", "--compat", "1.0.0", "--compat", "2.0.0"]
]) {
  test(`rejects invalid arguments without writes: ${JSON.stringify(args)}`, (t) => {
    const f = fixture(t);
    const before = f.snapshot();
    const result = f.run(...args);
    assert.equal(result.status, 1);
    assert.notEqual(result.stderr, "");
    assert.deepEqual(f.snapshot(), before);
  });
}

for (const name of Object.keys(initial)) {
  for (const contents of ["{broken", "null", "[]"]) {
    test(`rejects malformed ${name} (${contents}) before writing any file`, (t) => {
      const f = fixture(t);
      writeFileSync(join(f.root, name), contents);
      const before = f.snapshot();
      assert.equal(f.run("patch").status, 1);
      assert.deepEqual(f.snapshot(), before);
    });
  }
}

for (const [name, data] of [
  ["package.json", { version: "bad" }],
  ["manifest.json", { version: "1.2.3", minAppVersion: "bad" }],
  ["package-lock.json", { packages: [] }],
  ["package-lock.json", { packages: { "": null } }]
]) {
  test(`rejects invalid metadata without writes: ${name} ${JSON.stringify(data)}`, (t) => {
    const f = fixture(t);
    f.write(name, data);
    const before = f.snapshot();
    assert.equal(f.run("patch").status, 1);
    assert.deepEqual(f.snapshot(), before);
  });
}
