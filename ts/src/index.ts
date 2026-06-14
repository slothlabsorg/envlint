/**
 * # @slothlabs/envlint
 *
 * Schema-driven validation for environment variables and `.env` files.
 *
 * Most configuration bugs are not logic bugs — they are a missing variable, a
 * port that is actually a hostname, or a `LOG_LEVEL` of `verbose` that silently
 * falls back to a default. `envlint` lets you declare what your service expects
 * in a single `envlint.toml` (or a typed TS object) and fail fast, in CI or at
 * boot, when reality disagrees.
 *
 * ```ts
 * import { Schema } from "@slothlabs/envlint";
 *
 * const schema = Schema.fromTomlStr(`
 *   [vars.PORT]
 *   type = "port"
 *   default = "8080"
 *
 *   [vars.DATABASE_URL]
 *   type = "url"
 *   required = true
 * `);
 *
 * const report = schema.validate({ DATABASE_URL: "postgres://db:5432/app" });
 * report.hasErrors(); // false
 * report.resolved.size; // 2 — PORT resolved from its default
 * ```
 *
 * See the `envlint` binary for a ready-made CLI (`envlint check`).
 */

export {
  Schema,
  SchemaError,
  type SchemaDef,
  type VarSpec,
} from "./schema.ts";

export {
  Report,
  type Issue,
  type Severity,
  type ReportJson,
  errorIssue,
  warningIssue,
} from "./report.ts";

export {
  coerce,
  isUrl,
  parseDuration,
  valueToString,
  asNumber,
  type Value,
  type VarType,
  type CoerceResult,
  VAR_TYPES,
  DEFAULT_VAR_TYPE,
} from "./value.ts";

export {
  parseEnv,
  envFromDotenv,
  ParseError,
  type EnvEntry,
} from "./parse-env.ts";

/**
 * Read the current process environment into the map shape
 * {@link Schema.validate} expects.
 */
export function processEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
