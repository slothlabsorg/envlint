/**
 * The `envlint.toml` schema model and the validation engine.
 */

import { parse as parseToml } from "smol-toml";

import { Report, errorIssue, warningIssue } from "./report.ts";
import {
  type VarType,
  VAR_TYPES,
  DEFAULT_VAR_TYPE,
  coerce,
  asNumber,
} from "./value.ts";

/**
 * The declared constraints for a single variable. This is the programmatic
 * shape; the TOML loader produces the same object after validation.
 */
export interface VarSpec {
  /** Variable type. Defaults to `"string"` when omitted. */
  readonly type?: VarType;
  /** When true, the variable must be present and non-empty. */
  readonly required?: boolean;
  /** Value used when the variable is absent from the environment. */
  readonly default?: string;
  /** Regex (matched on the raw text) the value must satisfy. */
  readonly pattern?: string;
  /** Allowed values for an `enum`-typed variable. */
  readonly values?: readonly string[];
  /** Inclusive lower bound for numeric/duration values. */
  readonly min?: number;
  /** Inclusive upper bound for numeric/duration values. */
  readonly max?: number;
  /** When true, the resolved value is masked as `******` in all output. */
  readonly secret?: boolean;
  /** Human-readable description (informational only). */
  readonly description?: string;
}

/** A schema definition: a set of named variable specs plus a strict flag. */
export interface SchemaDef {
  readonly vars: Record<string, VarSpec>;
  /**
   * When true, variables present in the environment but absent from the schema
   * are reported as errors instead of warnings.
   */
  readonly strict?: boolean;
}

/**
 * An error raised while *loading* a schema (as opposed to validating an
 * environment against it). Schema-authoring mistakes fail fast here so the
 * error points at the schema, not the user's environment.
 */
export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

/**
 * A parsed, internally-consistent schema. Construct one from TOML with
 * {@link Schema.fromTomlStr} or from a TS object with {@link Schema.fromDef}.
 */
export class Schema {
  /** Variable specs, keyed by name. */
  readonly vars: Map<string, VarSpec>;
  /** Whether undeclared variables are errors (true) or warnings (false). */
  strict: boolean;
  /** Compiled patterns, cached per variable (validated at construction). */
  private readonly patterns = new Map<string, RegExp>();

  private constructor(vars: Map<string, VarSpec>, strict: boolean) {
    this.vars = vars;
    this.strict = strict;
    for (const [name, spec] of vars) {
      if (spec.pattern !== undefined) {
        this.patterns.set(name, compilePattern(name, spec.pattern));
      }
    }
  }

  /** Parse a schema from TOML source, validating it for internal consistency. */
  static fromTomlStr(src: string): Schema {
    let parsed: unknown;
    try {
      parsed = parseToml(src);
    } catch (e) {
      throw new SchemaError(`invalid schema: ${(e as Error).message}`);
    }
    return Schema.fromDef(coerceTomlToDef(parsed));
  }

  /**
   * Build a schema from a programmatic definition, validating it for internal
   * consistency (patterns compile, enums declare values, types are known).
   */
  static fromDef(def: SchemaDef): Schema {
    const vars = new Map<string, VarSpec>();
    // Iterate in sorted name order so reports are deterministic regardless of
    // how the definition was authored (mirrors the Rust BTreeMap).
    for (const name of Object.keys(def.vars).sort()) {
      const spec = def.vars[name];
      if (spec === undefined) continue;
      validateSpec(name, spec);
      vars.set(name, spec);
    }
    return new Schema(vars, def.strict ?? false);
  }

  /**
   * Validate a set of variables (parsed from a `.env` file or read from the
   * process environment) against this schema, returning a {@link Report}.
   */
  validate(env: Record<string, string>): Report {
    const report = new Report();

    for (const [name, spec] of this.vars) {
      if (spec.secret) report.markSecret(name);

      // Resolve the raw value: an explicit value wins over the default.
      const explicit = Object.prototype.hasOwnProperty.call(env, name)
        ? env[name]
        : undefined;
      const raw = explicit ?? spec.default;

      if (raw === undefined) {
        if (spec.required) {
          report.add(errorIssue(name, "required variable is not set"));
        }
        continue;
      }

      // An explicitly-set-but-empty value for a required var is an error.
      if (spec.required && raw.length === 0) {
        report.add(errorIssue(name, "required variable is empty"));
        continue;
      }

      this.checkVar(name, spec, raw, report);
    }

    // Report variables present in the environment but not in the schema, in
    // sorted order for deterministic output.
    for (const name of Object.keys(env).sort()) {
      if (!this.vars.has(name)) {
        report.add(
          this.strict
            ? errorIssue(name, "variable is not declared in the schema")
            : warningIssue(name, "variable is not declared in the schema"),
        );
      }
    }

    return report;
  }

  private checkVar(name: string, spec: VarSpec, raw: string, report: Report): void {
    const ty = spec.type ?? DEFAULT_VAR_TYPE;
    const values = spec.values ?? [];

    // Enum membership is checked on the raw string.
    if (ty === "enum" && !values.includes(raw)) {
      report.add(
        errorIssue(name, `must be one of ${formatList(values)}, got ${quote(raw)}`),
      );
      return;
    }

    const result = coerce(raw, ty);
    if (!result.ok) {
      report.add(errorIssue(name, result.error));
      return;
    }
    const value = result.value;

    // `pattern` applies to the raw textual form.
    const re = this.patterns.get(name);
    if (re !== undefined && !re.test(raw)) {
      report.add(errorIssue(name, `does not match pattern /${spec.pattern}/`));
      return;
    }

    // `min`/`max` apply to numeric/duration values.
    const n = asNumber(value);
    if (n !== undefined) {
      if (spec.min !== undefined && n < spec.min) {
        report.add(errorIssue(name, `${formatNumber(n)} is below min ${formatNumber(spec.min)}`));
        return;
      }
      if (spec.max !== undefined && n > spec.max) {
        report.add(errorIssue(name, `${formatNumber(n)} is above max ${formatNumber(spec.max)}`));
        return;
      }
    }

    report.resolve(name, value);
  }
}

/** Compile a pattern, raising a {@link SchemaError} attributed to its var. */
function compilePattern(name: string, pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (e) {
    throw new SchemaError(`${name}: invalid pattern: ${(e as Error).message}`);
  }
}

/** Validate a single spec for internal consistency. */
function validateSpec(name: string, spec: VarSpec): void {
  const ty = spec.type ?? DEFAULT_VAR_TYPE;
  if (!VAR_TYPES.includes(ty)) {
    throw new SchemaError(`${name}: unknown type ${quote(ty)}`);
  }
  if (spec.pattern !== undefined) {
    compilePattern(name, spec.pattern);
  }
  if (ty === "enum" && (spec.values === undefined || spec.values.length === 0)) {
    throw new SchemaError(`${name}: enum type requires a non-empty \`values\` list`);
  }
}

/**
 * Convert the loosely-typed result of TOML parsing into a {@link SchemaDef},
 * rejecting structurally-invalid documents with a {@link SchemaError}.
 */
function coerceTomlToDef(parsed: unknown): SchemaDef {
  if (parsed === null || typeof parsed !== "object") {
    throw new SchemaError("invalid schema: expected a TOML table");
  }
  const root = parsed as Record<string, unknown>;

  const strict = root["strict"];
  if (strict !== undefined && typeof strict !== "boolean") {
    throw new SchemaError("invalid schema: `strict` must be a boolean");
  }

  const rawVars = root["vars"] ?? {};
  if (rawVars === null || typeof rawVars !== "object") {
    throw new SchemaError("invalid schema: `vars` must be a table");
  }

  const vars: Record<string, VarSpec> = {};
  for (const [name, rawSpec] of Object.entries(rawVars as Record<string, unknown>)) {
    vars[name] = coerceTomlToSpec(name, rawSpec);
  }

  return { vars, strict: strict as boolean | undefined };
}

function coerceTomlToSpec(name: string, raw: unknown): VarSpec {
  if (raw === null || typeof raw !== "object") {
    throw new SchemaError(`invalid schema: [vars.${name}] must be a table`);
  }
  const t = raw as Record<string, unknown>;

  const spec: {
    type?: VarType;
    required?: boolean;
    default?: string;
    pattern?: string;
    values?: string[];
    min?: number;
    max?: number;
    secret?: boolean;
    description?: string;
  } = {};

  if (t["type"] !== undefined) {
    if (typeof t["type"] !== "string") {
      throw new SchemaError(`${name}: \`type\` must be a string`);
    }
    spec.type = t["type"] as VarType;
  }
  if (t["required"] !== undefined) {
    if (typeof t["required"] !== "boolean") {
      throw new SchemaError(`${name}: \`required\` must be a boolean`);
    }
    spec.required = t["required"];
  }
  if (t["default"] !== undefined) {
    spec.default = stringifyScalar(name, "default", t["default"]);
  }
  if (t["pattern"] !== undefined) {
    if (typeof t["pattern"] !== "string") {
      throw new SchemaError(`${name}: \`pattern\` must be a string`);
    }
    spec.pattern = t["pattern"];
  }
  if (t["values"] !== undefined) {
    if (!Array.isArray(t["values"]) || t["values"].some((v) => typeof v !== "string")) {
      throw new SchemaError(`${name}: \`values\` must be an array of strings`);
    }
    spec.values = t["values"] as string[];
  }
  if (t["min"] !== undefined) {
    if (typeof t["min"] !== "number") {
      throw new SchemaError(`${name}: \`min\` must be a number`);
    }
    spec.min = t["min"];
  }
  if (t["max"] !== undefined) {
    if (typeof t["max"] !== "number") {
      throw new SchemaError(`${name}: \`max\` must be a number`);
    }
    spec.max = t["max"];
  }
  if (t["secret"] !== undefined) {
    if (typeof t["secret"] !== "boolean") {
      throw new SchemaError(`${name}: \`secret\` must be a boolean`);
    }
    spec.secret = t["secret"];
  }
  if (t["description"] !== undefined) {
    if (typeof t["description"] !== "string") {
      throw new SchemaError(`${name}: \`description\` must be a string`);
    }
    spec.description = t["description"];
  }

  return spec;
}

/**
 * The schema's `default` is a string in the TOML, but authors occasionally
 * write `default = 8080`. Accept scalar numbers/booleans and stringify them so
 * the value flows through coercion exactly as a quoted string would.
 */
function stringifyScalar(name: string, key: string, value: unknown): string {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
      return formatNumber(value);
    case "boolean":
      return String(value);
    case "bigint":
      return value.toString();
    default:
      throw new SchemaError(`${name}: \`${key}\` must be a string, number, or boolean`);
  }
}

/** Quote a string the way Rust's `{:?}` does, for parity in messages. */
function quote(s: string): string {
  return JSON.stringify(s);
}

/** Render a string list the way Rust's `{:?}` renders a `Vec<String>`. */
function formatList(values: readonly string[]): string {
  return `[${values.map(quote).join(", ")}]`;
}

/** Render a number the way Rust's `{}` does (no trailing `.0` on integers). */
function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}
