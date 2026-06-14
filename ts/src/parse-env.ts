/**
 * A small, forgiving `.env` parser.
 *
 * Supports `KEY=VALUE`, `export KEY=VALUE`, `#` comments, blank lines, and
 * single- or double-quoted values (with `\n`, `\t`, `\r`, `\\`, `\"` escapes
 * inside double quotes). Line numbers are preserved for diagnostics.
 */

/** A parsed assignment from a `.env` file. */
export interface EnvEntry {
  readonly key: string;
  readonly value: string;
  /** 1-based line number the assignment was found on. */
  readonly line: number;
}

/**
 * An error encountered while parsing a `.env` file. Carries the offending
 * 1-based line number so callers can point users at the exact spot.
 */
export class ParseError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.name = "ParseError";
    this.line = line;
  }
}

/** Parse the contents of a `.env` file into a list of entries. */
export function parseEnv(contents: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  const lines = contents.split("\n");

  for (let idx = 0; idx < lines.length; idx++) {
    // `String.split("\n")` yields a trailing "" for content ending in a
    // newline; Rust's `.lines()` does not. Skipping blank/comment lines below
    // makes the two behave identically without special-casing.
    const rawLine = stripCarriageReturn(lines[idx] ?? "");
    const line = idx + 1;
    const trimmedStart = trimStart(rawLine);
    if (trimmedStart.length === 0 || trimmedStart.startsWith("#")) {
      continue;
    }

    const withoutExport = trimmedStart.startsWith("export ")
      ? trimmedStart.slice("export ".length)
      : trimmedStart;

    const eq = withoutExport.indexOf("=");
    if (eq < 0) {
      throw new ParseError(line, `missing '=' in assignment: ${quote(rawLine)}`);
    }

    const key = withoutExport.slice(0, eq).trim();
    if (key.length === 0 || !isValidKey(key)) {
      throw new ParseError(line, `invalid variable name: ${quote(key)}`);
    }

    const value = parseValue(withoutExport.slice(eq + 1).trim(), line);
    entries.push({ key, value, line });
  }

  return entries;
}

/**
 * Parse a `.env` file's contents into a map, keeping the last assignment when
 * a key is repeated. Throws {@link ParseError} (with a line number) if the
 * file is malformed.
 */
export function envFromDotenv(contents: string): Record<string, string> {
  const map: Record<string, string> = Object.create(null);
  for (const entry of parseEnv(contents)) {
    map[entry.key] = entry.value;
  }
  return map;
}

function isValidKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

function parseValue(raw: string, line: number): string {
  if (raw.length === 0) return "";

  const quoteChar = raw[0];
  if (quoteChar === '"' || quoteChar === "'") {
    const end = raw.lastIndexOf(quoteChar);
    if (end <= 0) {
      throw new ParseError(line, "unterminated quoted value");
    }
    const inner = raw.slice(1, end);
    // Single quotes are literal; double quotes honour escape sequences.
    return quoteChar === "'" ? inner : unescape(inner);
  }

  // Unquoted: strip a trailing inline comment (preceded by whitespace).
  const commentAt = raw.indexOf(" #");
  const value = commentAt >= 0 ? raw.slice(0, commentAt) : raw;
  return trimEnd(value);
}

function unescape(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      const next = s[i + 1];
      switch (next) {
        case "n":
          out += "\n";
          i++;
          break;
        case "t":
          out += "\t";
          i++;
          break;
        case "r":
          out += "\r";
          i++;
          break;
        case "\\":
          out += "\\";
          i++;
          break;
        case '"':
          out += '"';
          i++;
          break;
        case undefined:
          out += "\\";
          break;
        default:
          out += "\\" + next;
          i++;
          break;
      }
    } else {
      out += c;
    }
  }
  return out;
}

/** Quote a string the way Rust's `{:?}` does, for parity in error messages. */
function quote(s: string): string {
  return JSON.stringify(s);
}

function stripCarriageReturn(s: string): string {
  return s.endsWith("\r") ? s.slice(0, -1) : s;
}

function trimStart(s: string): string {
  return s.replace(/^\s+/, "");
}

function trimEnd(s: string): string {
  return s.replace(/\s+$/, "");
}
