import { test } from "node:test";
import assert from "node:assert/strict";

import { parseEnv, envFromDotenv, ParseError } from "../src/index.ts";

test("parses basic assignments", () => {
  const entries = parseEnv("FOO=bar\nexport BAZ=qux\n# comment\n\nN=1");
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], { key: "FOO", value: "bar", line: 1 });
  assert.equal(entries[1]?.key, "BAZ");
  assert.equal(entries[2]?.line, 5); // comment + blank lines skipped
});

test("handles quotes and comments", () => {
  const entries = parseEnv(
    ['A="hello world"', "B='raw $VALUE'", "C=plain # trailing", 'D="line\\nbreak"'].join("\n"),
  );
  assert.equal(entries[0]?.value, "hello world");
  assert.equal(entries[1]?.value, "raw $VALUE");
  assert.equal(entries[2]?.value, "plain");
  assert.equal(entries[3]?.value, "line\nbreak");
});

test("rejects malformed lines with a line number", () => {
  assert.throws(() => parseEnv("NOEQUALS"), ParseError);
  assert.throws(() => parseEnv("1BAD=x"), ParseError);
  assert.throws(() => parseEnv('A="unterminated'), ParseError);
});

test("malformed dotenv reports the offending line", () => {
  try {
    parseEnv("OK=1\nBROKEN");
    assert.fail("expected ParseError");
  } catch (e) {
    assert.ok(e instanceof ParseError);
    assert.equal(e.line, 2);
  }
});

test("envFromDotenv keeps the last assignment for a repeated key", () => {
  const map = envFromDotenv("X=1\nX=2\nY=a");
  // envFromDotenv returns a null-prototype map (no __proto__ pollution risk),
  // so compare its entries rather than its prototype.
  assert.deepEqual({ ...map }, { X: "2", Y: "a" });
});

test("tolerates CRLF line endings", () => {
  const entries = parseEnv("A=1\r\nB=2\r\n");
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.value, "1");
  assert.equal(entries[1]?.value, "2");
});
