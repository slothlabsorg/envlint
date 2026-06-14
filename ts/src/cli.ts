#!/usr/bin/env node
/**
 * `envlint` command-line interface.
 *
 * Exit codes mirror the Rust port:
 *   0  no errors
 *   1  validation errors found
 *   2  usage or I/O error
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Schema } from "./schema.ts";
import { envFromDotenv } from "./parse-env.ts";
import { processEnv } from "./index.ts";

const USAGE = `\
envlint — schema-driven validation for environment variables

USAGE:
    envlint check [OPTIONS]
    envlint init [--force]
    envlint --help | --version

OPTIONS (check):
    -s, --schema <FILE>     Schema file (default: envlint.toml)
    -f, --env-file <FILE>   Validate this .env file
        --env               Validate the live process environment
        --format <FMT>      Output format: text | json (default: text)
        --strict            Treat undeclared variables as errors

If neither --env-file nor --env is given, envlint validates ./.env when present,
otherwise the live process environment.

EXIT CODES:
    0   no errors
    1   validation errors found
    2   usage or I/O error
`;

/** Thrown for usage/IO errors; surfaced as `envlint: <msg>` with exit code 2. */
class CliError extends Error {}

type Format = "text" | "json";

interface CheckOpts {
  schema?: string;
  envFile?: string;
  useProcessEnv: boolean;
  format: Format;
  strict: boolean;
}

function main(argv: string[]): number {
  try {
    return run(argv);
  } catch (e) {
    process.stderr.write(`envlint: ${(e as Error).message}\n`);
    return 2;
  }
}

function run(args: string[]): number {
  const first = args[0];
  if (first === undefined) {
    process.stdout.write(USAGE);
    return 2;
  }

  switch (first) {
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return 0;
    case "--version":
    case "-V":
      process.stdout.write(`envlint ${version()}\n`);
      return 0;
    case "init":
      return cmdInit(args.slice(1));
    case "check":
      return cmdCheck(args.slice(1));
    default:
      throw new CliError(`unknown command ${quote(first)}; try \`envlint --help\``);
  }
}

function cmdInit(args: string[]): number {
  const force = args.includes("--force");
  const path = "envlint.toml";
  if (existsSync(path) && !force) {
    throw new CliError("envlint.toml already exists (use --force to overwrite)");
  }
  try {
    writeFileSync(path, sampleSchema());
  } catch (e) {
    throw new CliError(`writing envlint.toml: ${(e as Error).message}`);
  }
  process.stdout.write("wrote envlint.toml\n");
  return 0;
}

function cmdCheck(args: string[]): number {
  const opts = parseCheckOpts(args);

  const schemaPath = opts.schema ?? "envlint.toml";
  let schemaSrc: string;
  try {
    schemaSrc = readFileSync(schemaPath, "utf8");
  } catch (e) {
    throw new CliError(`reading schema ${schemaPath}: ${ioMessage(e)}`);
  }

  let schema: Schema;
  try {
    schema = Schema.fromTomlStr(schemaSrc);
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  if (opts.strict) schema.strict = true;

  const { env, source } = loadEnv(opts);
  const report = schema.validate(env);

  if (opts.format === "text") {
    process.stderr.write(`envlint: validating ${source}\n`);
    process.stdout.write(report.toText());
  } else {
    process.stdout.write(`${JSON.stringify(report.toJSON())}\n`);
  }

  return report.hasErrors() ? 1 : 0;
}

function parseCheckOpts(args: string[]): CheckOpts {
  const opts: CheckOpts = { useProcessEnv: false, format: "text", strict: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    switch (arg) {
      case "-s":
      case "--schema":
        opts.schema = expectValue(args, ++i, arg);
        break;
      case "-f":
      case "--env-file":
        opts.envFile = expectValue(args, ++i, arg);
        break;
      case "--env":
        opts.useProcessEnv = true;
        break;
      case "--strict":
        opts.strict = true;
        break;
      case "--format": {
        const fmt = expectValue(args, ++i, arg);
        if (fmt !== "text" && fmt !== "json") {
          throw new CliError(`unknown --format ${quote(fmt)}`);
        }
        opts.format = fmt;
        break;
      }
      default:
        throw new CliError(`unexpected argument ${quote(arg)}`);
    }
  }
  if (opts.envFile !== undefined && opts.useProcessEnv) {
    throw new CliError("--env-file and --env are mutually exclusive");
  }
  return opts;
}

function expectValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined) throw new CliError(`${flag} requires a value`);
  return value;
}

function loadEnv(opts: CheckOpts): { env: Record<string, string>; source: string } {
  if (opts.envFile !== undefined) {
    const contents = readFileOrThrow(opts.envFile, opts.envFile);
    return { env: parseDotenvOrThrow(contents, opts.envFile), source: opts.envFile };
  }
  if (opts.useProcessEnv) {
    return { env: processEnv(), source: "process environment" };
  }
  // Default: prefer ./.env if it exists, else the live environment.
  if (existsSync(".env")) {
    const contents = readFileOrThrow(".env", ".env");
    return { env: parseDotenvOrThrow(contents, ".env"), source: ".env" };
  }
  return { env: processEnv(), source: "process environment" };
}

function readFileOrThrow(path: string, label: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    throw new CliError(`reading ${label}: ${ioMessage(e)}`);
  }
}

function parseDotenvOrThrow(contents: string, label: string): Record<string, string> {
  try {
    return envFromDotenv(contents);
  } catch (e) {
    throw new CliError(`${label}: ${(e as Error).message}`);
  }
}

/** The bundled sample schema, shipped alongside the package. */
function sampleSchema(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/cli.js -> ../examples/envlint.toml (also resolves from src/ in tests).
  const path = join(here, "..", "examples", "envlint.toml");
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    throw new CliError(`locating bundled sample schema: ${ioMessage(e)}`);
  }
}

function version(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function ioMessage(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  if (err && err.code === "ENOENT") return "no such file or directory";
  return (e as Error).message;
}

function quote(s: string): string {
  return JSON.stringify(s);
}

process.exit(main(process.argv.slice(2)));
