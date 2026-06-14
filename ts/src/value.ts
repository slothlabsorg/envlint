/**
 * Typed values and coercion from raw environment strings.
 *
 * Every variable in the environment arrives as a string. The schema declares
 * what that string is *supposed* to be; `coerce` turns it into a typed
 * {@link Value} or reports, in human-readable prose, why it could not.
 */

/** The declared type of a variable in the schema. */
export type VarType =
  | "string"
  | "int"
  | "float"
  | "bool"
  | "url"
  | "port"
  | "enum"
  | "duration";

/** The default type when `type` is omitted in the schema. */
export const DEFAULT_VAR_TYPE: VarType = "string";

/** All recognised variable types, for schema validation and diagnostics. */
export const VAR_TYPES: readonly VarType[] = [
  "string",
  "int",
  "float",
  "bool",
  "url",
  "port",
  "enum",
  "duration",
];

/**
 * A successfully coerced value. The discriminated union mirrors the Rust
 * `Value` enum: each variant carries the native representation of its type.
 *
 * `duration` values carry their magnitude in **milliseconds** (matching the
 * Rust port's `Duration` semantics, which renders as `<n>ms`).
 */
export type Value =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "url"; readonly value: string }
  | { readonly kind: "port"; readonly value: number }
  | { readonly kind: "duration"; readonly millis: number };

/**
 * Numeric magnitude for `min`/`max` checks, if the value is comparable.
 * Durations compare by their value in **seconds** (matching the Rust port,
 * which uses `Duration::as_secs_f64`).
 */
export function asNumber(value: Value): number | undefined {
  switch (value.kind) {
    case "int":
    case "float":
    case "port":
      return value.value;
    case "duration":
      return value.millis / 1000;
    default:
      return undefined;
  }
}

/** Render a value as the string a human (or a JSON report) should see. */
export function valueToString(value: Value): string {
  switch (value.kind) {
    case "string":
    case "url":
      return value.value;
    case "int":
    case "port":
      return String(value.value);
    case "float":
      return formatFloat(value.value);
    case "bool":
      return value.value ? "true" : "false";
    case "duration":
      return `${Math.round(value.millis)}ms`;
  }
}

/**
 * Format a float the way Rust's `{}` does: integral values keep no decimal
 * point unless they were genuinely fractional (e.g. `3` not `3.0`, `3.5` as is).
 */
function formatFloat(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

/**
 * Coerce a raw string into the requested {@link VarType}.
 *
 * On success returns `{ ok: true, value }`; on failure `{ ok: false, error }`
 * with a human-readable message describing the expectation.
 */
export type CoerceResult =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: string };

export function coerce(raw: string, ty: VarType): CoerceResult {
  switch (ty) {
    case "string":
      return { ok: true, value: { kind: "string", value: raw } };
    case "int": {
      const n = parseInteger(raw.trim());
      return n === undefined
        ? { ok: false, error: `expected an integer, got ${quote(raw)}` }
        : { ok: true, value: { kind: "int", value: n } };
    }
    case "float": {
      const n = parseFloatStrict(raw.trim());
      return n === undefined
        ? { ok: false, error: `expected a float, got ${quote(raw)}` }
        : { ok: true, value: { kind: "float", value: n } };
    }
    case "bool": {
      const b = parseBool(raw);
      return b === undefined
        ? {
            ok: false,
            error: `expected a boolean (true/false/1/0/yes/no/on/off), got ${quote(raw)}`,
          }
        : { ok: true, value: { kind: "bool", value: b } };
    }
    case "port": {
      const p = parsePort(raw);
      return p === undefined
        ? { ok: false, error: `expected a port in 1..=65535, got ${quote(raw)}` }
        : { ok: true, value: { kind: "port", value: p } };
    }
    case "url":
      return isUrl(raw)
        ? { ok: true, value: { kind: "url", value: raw } }
        : { ok: false, error: `expected a URL with scheme://authority, got ${quote(raw)}` };
    case "enum":
      // Enum values are validated against `values` by the schema layer; here we
      // simply carry the string through.
      return { ok: true, value: { kind: "string", value: raw } };
    case "duration": {
      const ms = parseDuration(raw);
      return ms === undefined
        ? { ok: false, error: `expected a duration like 30s/5m/2h, got ${quote(raw)}` }
        : { ok: true, value: { kind: "duration", millis: ms } };
    }
  }
}

/** Quote a string the way Rust's `{:?}` does, for parity in error messages. */
function quote(s: string): string {
  return JSON.stringify(s);
}

/** Parse a signed 64-bit-range integer. Rejects floats, NaN, and junk. */
function parseInteger(s: string): number | undefined {
  if (!/^[+-]?\d+$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Parse a finite float. Rejects empty strings, NaN, and trailing junk. */
function parseFloatStrict(s: string): number | undefined {
  if (s.length === 0) return undefined;
  // Reject Rust-incompatible spellings while accepting standard float syntax.
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) && !/^[+-]?(inf|infinity)$/i.test(s)) {
    return undefined;
  }
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

function parseBool(raw: string): boolean | undefined {
  switch (raw.trim().toLowerCase()) {
    case "true":
    case "1":
    case "yes":
    case "on":
      return true;
    case "false":
    case "0":
    case "no":
    case "off":
      return false;
    default:
      return undefined;
  }
}

function parsePort(raw: string): number | undefined {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : undefined;
}

/** Minimal, dependency-free URL shape check: `scheme://authority[...]`. */
export function isUrl(raw: string): boolean {
  const s = raw.trim();
  const sep = s.indexOf("://");
  if (sep < 0) return false;
  const scheme = s.slice(0, sep);
  const rest = s.slice(sep + 3);
  if (scheme.length === 0) return false;
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)) return false;
  // Authority must be non-empty and not start with a path/query separator.
  const authority = rest.split(/[/?#]/, 1)[0] ?? "";
  return authority.length > 0;
}

/**
 * Parse a human duration into milliseconds. Supported suffixes: `ms`, `s`,
 * `m`, `h`, `d`. A bare number is interpreted as seconds.
 */
export function parseDuration(raw: string): number | undefined {
  const s = raw.trim();
  if (s.length === 0) return undefined;

  let num: string;
  let multMs: number;
  if (s.endsWith("ms")) {
    num = s.slice(0, -2);
    multMs = 1;
  } else if (s.endsWith("s")) {
    num = s.slice(0, -1);
    multMs = 1_000;
  } else if (s.endsWith("m")) {
    num = s.slice(0, -1);
    multMs = 60_000;
  } else if (s.endsWith("h")) {
    num = s.slice(0, -1);
    multMs = 3_600_000;
  } else if (s.endsWith("d")) {
    num = s.slice(0, -1);
    multMs = 86_400_000;
  } else {
    num = s;
    multMs = 1_000;
  }

  const value = parseFloatStrict(num.trim());
  if (value === undefined || value < 0 || !Number.isFinite(value)) return undefined;
  return value * multMs;
}
