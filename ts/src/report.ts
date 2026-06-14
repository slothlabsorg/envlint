/**
 * Validation issues and the report produced by a validation run.
 */

import { type Value, valueToString } from "./value.ts";

/** Severity of an {@link Issue}. */
export type Severity = "error" | "warning";

/** A single problem found while validating the environment. */
export interface Issue {
  readonly var: string;
  readonly severity: Severity;
  readonly message: string;
}

/** Construct an error-severity issue. */
export function errorIssue(variable: string, message: string): Issue {
  return { var: variable, severity: "error", message };
}

/** Construct a warning-severity issue. */
export function warningIssue(variable: string, message: string): Issue {
  return { var: variable, severity: "warning", message };
}

/** The JSON shape produced by {@link Report.toJSON}. Secrets are masked. */
export interface ReportJson {
  readonly ok: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly issues: ReadonlyArray<{
    readonly var: string;
    readonly severity: Severity;
    readonly message: string;
  }>;
  readonly resolved: Record<string, string>;
}

/** Mask used for any variable declared `secret = true`. */
const SECRET_MASK = "******";

/**
 * The outcome of validating a set of variables against a schema.
 *
 * `resolved` holds the successfully coerced, default-filled values keyed by
 * variable name — exactly the typed config you can hand to the rest of your
 * application. Secret values are never exposed in {@link Report.toText} or
 * {@link Report.toJSON}.
 */
export class Report {
  readonly issues: Issue[] = [];
  /** Successfully resolved values, keyed by variable name. Includes defaults. */
  readonly resolved = new Map<string, Value>();
  /** Names of variables whose schema marked them `secret = true`. */
  private readonly secrets = new Set<string>();

  /** Mark a variable as secret so its value is masked in all output. */
  markSecret(variable: string): void {
    this.secrets.add(variable);
  }

  /** Record an issue (error or warning). */
  add(issue: Issue): void {
    this.issues.push(issue);
  }

  /** Record a successfully resolved value. */
  resolve(variable: string, value: Value): void {
    this.resolved.set(variable, value);
  }

  /** True if any issue is an error. */
  hasErrors(): boolean {
    return this.issues.some((i) => i.severity === "error");
  }

  /** All error-severity issues, in insertion order. */
  errors(): Issue[] {
    return this.issues.filter((i) => i.severity === "error");
  }

  /** All warning-severity issues, in insertion order. */
  warnings(): Issue[] {
    return this.issues.filter((i) => i.severity === "warning");
  }

  /** Whether a variable was declared secret. */
  isSecret(variable: string): boolean {
    return this.secrets.has(variable);
  }

  private displayValue(variable: string, value: Value): string {
    return this.isSecret(variable) ? SECRET_MASK : valueToString(value);
  }

  /** Render a human-readable report. Secret values are masked. */
  toText(): string {
    let out = "";
    for (const issue of this.issues) {
      out += `${issue.severity}: ${issue.var}: ${issue.message}\n`;
    }
    const err = this.errors().length;
    const warn = this.warnings().length;
    if (err === 0 && warn === 0) {
      out += `ok: ${this.resolved.size} variable(s) validated\n`;
    } else {
      out += `${err} error(s), ${warn} warning(s)\n`;
    }
    return out;
  }

  /**
   * Render the report as a JSON-serialisable object. Secret values are masked.
   * `resolved` preserves the schema's variable order (insertion order).
   */
  toJSON(): ReportJson {
    const resolved: Record<string, string> = {};
    for (const [name, value] of this.resolved) {
      resolved[name] = this.displayValue(name, value);
    }
    return {
      ok: !this.hasErrors(),
      errors: this.errors().length,
      warnings: this.warnings().length,
      issues: this.issues.map((i) => ({
        var: i.var,
        severity: i.severity,
        message: i.message,
      })),
      resolved,
    };
  }
}
