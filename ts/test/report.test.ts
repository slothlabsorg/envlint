import { test } from "node:test";
import assert from "node:assert/strict";

import { Schema, envFromDotenv } from "../src/index.ts";

const SCHEMA = `
  [vars.PORT]
  type = "port"
  default = "8080"

  [vars.DATABASE_URL]
  type = "url"
  required = true

  [vars.TIMEOUT]
  type = "duration"
  default = "30s"

  [vars.API_KEY]
  type = "string"
  required = true
  secret = true
`;

test("validates a .env file end to end", () => {
  const dotenv = [
    "# service config",
    "export DATABASE_URL=postgres://user:pw@db:5432/app",
    'API_KEY="sk-supersecret"',
    "TIMEOUT=45s",
  ].join("\n");

  const env = envFromDotenv(dotenv);
  const schema = Schema.fromTomlStr(SCHEMA);
  const report = schema.validate(env);

  assert.equal(report.hasErrors(), false);
  assert.equal(report.resolved.size, 4); // PORT filled from default

  const json = report.toJSON();
  assert.equal(json.resolved["API_KEY"], "******"); // secret masked
  assert.equal(json.ok, true);
});

test("text output masks secrets", () => {
  const schema = Schema.fromTomlStr(SCHEMA);
  const report = schema.validate({
    DATABASE_URL: "https://x.y",
    API_KEY: "sk-supersecret",
  });
  const text = report.toText();
  assert.ok(text.includes("ok: 4 variable(s) validated"));
  assert.ok(!text.includes("sk-supersecret"));
});

test("text output lists issues and a summary count", () => {
  const schema = Schema.fromTomlStr(SCHEMA);
  const report = schema.validate({ API_KEY: "sk-x" });
  const text = report.toText();
  assert.ok(text.includes("error: DATABASE_URL: required variable is not set"));
  assert.ok(text.includes("1 error(s), 0 warning(s)"));
});

test("surfaces a missing required variable", () => {
  const schema = Schema.fromTomlStr(SCHEMA);
  const report = schema.validate({ API_KEY: "sk-x" });
  assert.equal(report.hasErrors(), true);
  assert.ok(report.errors().some((i) => i.var === "DATABASE_URL"));
});

test("duration value renders in milliseconds and is unmasked", () => {
  const schema = Schema.fromTomlStr(SCHEMA);
  const report = schema.validate({
    DATABASE_URL: "https://x.y",
    API_KEY: "sk-x",
    TIMEOUT: "45s",
  });
  const json = report.toJSON();
  assert.equal(json.resolved["TIMEOUT"], "45000ms");
});

test("malformed dotenv throws with a line number", () => {
  assert.throws(
    () => envFromDotenv("OK=1\nBROKEN"),
    (e: unknown) => e instanceof Error && (e as { line?: number }).line === 2,
  );
});
