# @slothlabs/envlint

**Schema-driven validation for environment variables and `.env` files.**

Most production incidents that trace back to "config" are not subtle: a required
variable was never set, a `PORT` held a hostname, a `LOG_LEVEL` of `verbose`
silently fell back to a default, a timeout was `30` (seconds? milliseconds?).
These are caught trivially *if* something declares what the service expects.

`envlint` is that something. You describe your environment once in
`envlint.toml`, then validate a `.env` file or the live process environment — in
CI, in a container entrypoint, or at process boot via the library.

This is the TypeScript port. The `envlint.toml` schema format is identical
across the Rust, TypeScript, and Kotlin implementations, so one schema file
validates a Rust binary, a Node container, and a JVM service alike.

```toml
# envlint.toml
[vars.DATABASE_URL]
type = "url"
required = true

[vars.PORT]
type = "port"
default = "8080"

[vars.LOG_LEVEL]
type = "enum"
values = ["debug", "info", "warn", "error"]
default = "info"

[vars.API_KEY]
type = "string"
required = true
secret = true                       # masked in all output
pattern = "^sk-[A-Za-z0-9]{16,}$"
```

```console
$ npx envlint check --env-file .env
envlint: validating .env
error: DATABASE_URL: required variable is not set
error: LOG_LEVEL: must be one of ["debug", "info", "warn", "error"], got "verbose"
2 error(s), 0 warning(s)
$ echo $?
1
```

## Why not `dotenv` / `envalid` / `zod`?

Those make a *running program* read its config. `envlint` is a **gate that runs
before your program (or your deploy) does**, with no code in the target service
and no language lock-in — the same `envlint.toml` validates a Rust binary, a
Node container, and a JVM service. It is a CI/CD check first, a library second.

## Install

```bash
npm install @slothlabs/envlint     # library + CLI
```

The package ships a `bin`, so `npx envlint` (or a `package.json` script) works
without a global install.

## CLI

```
envlint check [OPTIONS]
envlint init [--force]          # scaffold a sample envlint.toml

OPTIONS (check):
  -s, --schema <FILE>    Schema file (default: envlint.toml)
  -f, --env-file <FILE>  Validate this .env file
      --env              Validate the live process environment
      --format <FMT>     text | json   (default: text)
      --strict           Treat undeclared variables as errors
```

If neither `--env-file` nor `--env` is given, `envlint` validates `./.env` when
present, otherwise the live environment. Exit code is `0` (clean), `1`
(validation errors), or `2` (usage/IO error) — ready to drop into a pipeline.

### GitHub Actions

```yaml
- run: npx -y @slothlabs/envlint check --env-file .env.ci --strict --format json
```

## Supported types

| `type`     | Accepts                                                        |
|------------|----------------------------------------------------------------|
| `string`   | any value (the default)                                        |
| `int`      | signed integer; honours `min` / `max`                          |
| `float`    | floating point; honours `min` / `max`                          |
| `bool`     | `true/false`, `1/0`, `yes/no`, `on/off` (case-insensitive)     |
| `url`      | `scheme://authority[...]`                                      |
| `port`     | integer in `1..=65535`                                         |
| `enum`     | one of `values = [...]`                                        |
| `duration` | `500ms`, `30s`, `5m`, `2h`, `1d`; bare number = seconds        |

Per-variable keys: `required`, `default`, `pattern` (regex, matched on the raw
text), `values` (for `enum`), `min` / `max` (numeric & duration), `secret`
(masks the value in all output), `description`.

## Library

Load a schema from TOML, or define one as a typed object — both produce the
same `Schema`:

```ts
import { readFileSync } from "node:fs";
import { Schema, envFromDotenv } from "@slothlabs/envlint";

const schema = Schema.fromTomlStr(readFileSync("envlint.toml", "utf8"));
const env = envFromDotenv(readFileSync(".env", "utf8"));
const report = schema.validate(env);

if (report.hasErrors()) {
  process.stderr.write(report.toText());
  process.exit(1);
}
```

```ts
// Define the schema programmatically — fully typed, no TOML required.
const schema = Schema.fromDef({
  vars: {
    PORT: { type: "port", default: "8080" },
    DATABASE_URL: { type: "url", required: true },
    API_KEY: { type: "string", required: true, secret: true },
  },
  strict: true,
});

const report = schema.validate(process.env as Record<string, string>);
```

`report.resolved` is a `Map<string, Value>` of typed, default-filled values you
can hand straight to the rest of your config layer. `report.toText()` and
`report.toJSON()` render the report with secret values masked as `******`.

## Durations

`duration` values resolve to a discriminated `{ kind: "duration", millis }`
union member, and render as `<n>ms` in reports (so `30s` becomes `30000ms`).
`min` / `max` on a duration compare against the value in **seconds**, matching
the reference implementation.

## License

MIT © SlothLabs
