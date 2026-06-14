import { test } from "node:test";
import assert from "node:assert/strict";

import { Schema, SchemaError } from "../src/index.ts";

const SCHEMA = `
  [vars.PORT]
  type = "port"
  default = "8080"

  [vars.LOG_LEVEL]
  type = "enum"
  values = ["debug", "info", "warn", "error"]
  default = "info"

  [vars.DATABASE_URL]
  type = "url"
  required = true

  [vars.API_KEY]
  type = "string"
  required = true
  secret = true
  pattern = "^sk-[A-Za-z0-9]{8,}$"

  [vars.WORKERS]
  type = "int"
  min = 1
  max = 64
  default = "4"
`;

test("happy path uses defaults", () => {
  const schema = Schema.fromTomlStr(SCHEMA);
  const report = schema.validate({
    DATABASE_URL: "postgres://db:5432/app",
    API_KEY: "sk-abcdef12",
  });
  assert.equal(report.hasErrors(), false);
  assert.equal(report.resolved.size, 5); // includes 3 defaults
});

test("flags missing-required, enum, pattern, and max", () => {
  const schema = Schema.fromTomlStr(SCHEMA);
  const report = schema.validate({
    LOG_LEVEL: "verbose",
    API_KEY: "nope",
    WORKERS: "999",
  });
  assert.equal(report.hasErrors(), true);
  const vars = report.errors().map((i) => i.var);
  assert.ok(vars.includes("DATABASE_URL")); // required, missing
  assert.ok(vars.includes("LOG_LEVEL")); // not in enum
  assert.ok(vars.includes("API_KEY")); // pattern mismatch
  assert.ok(vars.includes("WORKERS")); // above max
});

test("undeclared var is a warning, then an error in strict mode", () => {
  const schema = Schema.fromTomlStr(SCHEMA);
  const env = {
    DATABASE_URL: "https://x.y",
    API_KEY: "sk-abcdef12",
    MYSTERY: "1",
  };

  const lenient = schema.validate(env);
  assert.equal(lenient.hasErrors(), false);
  assert.equal(lenient.warnings().length, 1);

  schema.strict = true;
  const strict = schema.validate(env);
  assert.equal(strict.hasErrors(), true);
});

test("required-but-empty value is an error", () => {
  const schema = Schema.fromTomlStr(SCHEMA);
  const report = schema.validate({
    DATABASE_URL: "",
    API_KEY: "sk-abcdef12",
  });
  assert.equal(report.hasErrors(), true);
  assert.ok(report.errors().some((i) => i.var === "DATABASE_URL"));
});

test("min bound is enforced", () => {
  const schema = Schema.fromTomlStr(SCHEMA);
  const report = schema.validate({
    DATABASE_URL: "https://x.y",
    API_KEY: "sk-abcdef12",
    WORKERS: "0",
  });
  assert.ok(report.errors().some((i) => i.var === "WORKERS" && /below min/.test(i.message)));
});

test("rejects a bad schema (uncompilable pattern, empty enum)", () => {
  assert.throws(() => Schema.fromTomlStr('[vars.X]\ntype="string"\npattern="("'), SchemaError);
  assert.throws(() => Schema.fromTomlStr('[vars.X]\ntype="enum"'), SchemaError);
});

test("programmatic schema definition mirrors the TOML loader", () => {
  const schema = Schema.fromDef({
    vars: {
      PORT: { type: "port", default: "8080" },
      DATABASE_URL: { type: "url", required: true },
    },
  });
  const report = schema.validate({ DATABASE_URL: "postgres://db:5432/app" });
  assert.equal(report.hasErrors(), false);
  assert.equal(report.resolved.size, 2); // PORT from default
});

test("numeric default written unquoted is accepted", () => {
  const schema = Schema.fromTomlStr('[vars.PORT]\ntype = "port"\ndefault = 8080\n');
  const report = schema.validate({});
  assert.equal(report.hasErrors(), false);
  assert.equal(report.resolved.get("PORT")?.kind, "port");
});
