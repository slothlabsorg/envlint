import { test } from "node:test";
import assert from "node:assert/strict";

import { coerce, isUrl, parseDuration } from "../src/index.ts";

test("coerces scalars", () => {
  assert.deepEqual(coerce("42", "int"), { ok: true, value: { kind: "int", value: 42 } });
  assert.deepEqual(coerce("3.5", "float"), { ok: true, value: { kind: "float", value: 3.5 } });
  assert.deepEqual(coerce("YES", "bool"), { ok: true, value: { kind: "bool", value: true } });
  assert.deepEqual(coerce("off", "bool"), { ok: true, value: { kind: "bool", value: false } });
  assert.deepEqual(coerce("8080", "port"), { ok: true, value: { kind: "port", value: 8080 } });
});

test("rejects bad scalars", () => {
  assert.equal(coerce("not-int", "int").ok, false);
  assert.equal(coerce("3.5", "int").ok, false); // floats are not ints
  assert.equal(coerce("0", "port").ok, false); // below range
  assert.equal(coerce("70000", "port").ok, false); // above range
  assert.equal(coerce("maybe", "bool").ok, false);
});

test("url shape", () => {
  assert.equal(isUrl("https://example.com"), true);
  assert.equal(isUrl("postgres://user:pass@db:5432/app"), true);
  assert.equal(isUrl("example.com"), false);
  assert.equal(isUrl("://nohost"), false);
  assert.equal(isUrl("1http://x"), false);
  assert.equal(isUrl("http:///path"), false);
});

test("durations parse to milliseconds", () => {
  assert.equal(parseDuration("500ms"), 500);
  assert.equal(parseDuration("30s"), 30_000);
  assert.equal(parseDuration("5m"), 300_000);
  assert.equal(parseDuration("2h"), 7_200_000);
  assert.equal(parseDuration("1d"), 86_400_000);
  assert.equal(parseDuration("10"), 10_000); // bare number = seconds
  assert.equal(parseDuration("-1s"), undefined);
  assert.equal(parseDuration("abc"), undefined);
});

test("string and enum carry through untyped", () => {
  assert.deepEqual(coerce("anything", "string"), {
    ok: true,
    value: { kind: "string", value: "anything" },
  });
  assert.deepEqual(coerce("debug", "enum"), {
    ok: true,
    value: { kind: "string", value: "debug" },
  });
});
