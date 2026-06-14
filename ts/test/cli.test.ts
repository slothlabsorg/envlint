import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "src", "cli.ts");

/** Run the CLI under Node's type-stripping loader and capture the result. */
function runCli(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, ["--no-warnings", CLI, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
  });
  return { status: res.status ?? 2, stdout: res.stdout, stderr: res.stderr };
}

const SCHEMA = `
[vars.PORT]
type = "port"
default = "8080"

[vars.DATABASE_URL]
type = "url"
required = true

[vars.API_KEY]
type = "string"
required = true
secret = true
`;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "envlint-ts-"));
}

test("check exits 0 on a clean env file", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "envlint.toml"), SCHEMA);
    writeFileSync(join(dir, ".env"), "DATABASE_URL=https://db\nAPI_KEY=sk-secret\n");
    const res = runCli(["check", "--env-file", ".env"], { cwd: dir });
    assert.equal(res.status, 0, res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check exits 1 on validation errors and masks secrets in json", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "envlint.toml"), SCHEMA);
    writeFileSync(join(dir, ".env"), "API_KEY=sk-secret\n"); // missing DATABASE_URL
    const res = runCli(["check", "--env-file", ".env", "--format", "json"], { cwd: dir });
    assert.equal(res.status, 1);
    const report = JSON.parse(res.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.resolved["API_KEY"], "******");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check exits 2 on IO error (missing schema)", () => {
  const dir = tempDir();
  try {
    const res = runCli(["check", "--schema", "does-not-exist.toml"], { cwd: dir });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /envlint:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("strict flag turns an undeclared var into an error (exit 1)", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "envlint.toml"), SCHEMA);
    writeFileSync(join(dir, ".env"), "DATABASE_URL=https://db\nAPI_KEY=sk-x\nMYSTERY=1\n");
    const lenient = runCli(["check", "--env-file", ".env"], { cwd: dir });
    assert.equal(lenient.status, 0);
    const strict = runCli(["check", "--env-file", ".env", "--strict"], { cwd: dir });
    assert.equal(strict.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("init scaffolds envlint.toml and refuses to overwrite", () => {
  const dir = tempDir();
  try {
    const first = runCli(["init"], { cwd: dir });
    assert.equal(first.status, 0);
    assert.match(first.stdout, /wrote envlint.toml/);
    const second = runCli(["init"], { cwd: dir });
    assert.equal(second.status, 2); // already exists
    const forced = runCli(["init", "--force"], { cwd: dir });
    assert.equal(forced.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no command prints usage and exits 2", () => {
  const res = runCli([]);
  assert.equal(res.status, 2);
  assert.match(res.stdout, /USAGE:/);
});
