# envlint

**Schema-driven validation for environment variables and `.env` files.**

Most production incidents that trace back to "config" are not subtle: a required
variable was never set, a `PORT` held a hostname, a `LOG_LEVEL` of `verbose`
silently fell back to a default, a timeout was `30` (seconds? milliseconds?).
These are caught trivially *if* something declares what the service expects.

`envlint` is that something. You describe your environment once in
`envlint.toml`, then validate a `.env` file or the live process environment — in
CI, in a container entrypoint, or at process boot via the library.

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
$ envlint check --env-file .env
envlint: validating .env
error: DATABASE_URL: required variable is not set
error: LOG_LEVEL: must be one of ["debug", "info", "warn", "error"], got "verbose"
2 error(s), 0 warning(s)
$ echo $?
1
```

## Why not `dotenv` / `envy` / `zod`?

Those make a *running program* read its config. `envlint` is a **gate that runs
before your program (or your deploy) does**, with no code in the target service
and no language lock-in — the same `envlint.toml` validates a Rust binary, a
Node container, and a shell-based job. It is a CI/CD check first, a library
second.

## Install

Straight from git — works today, no registry account required:

```bash
cargo install --git https://github.com/slothlabsorg/envlint envlint   # CLI
cargo add envlint --git https://github.com/slothlabsorg/envlint        # library
```

The repository root is a Cargo virtual workspace, so the git dependency
resolves this `rust/` member crate automatically.

Once a `rust-v*` tag has published the crate to crates.io, the registry forms
also work:

```bash
cargo install envlint          # CLI + library
cargo add envlint              # library
```

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
- run: cargo install envlint
- run: envlint check --env-file .env.ci --strict --format json
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

```rust
use envlint::{Schema, env_from_dotenv};

let schema = Schema::from_toml_str(std::fs::read_to_string("envlint.toml")?.as_str())?;
let env = env_from_dotenv(&std::fs::read_to_string(".env")?)?;
let report = schema.validate(&env);

if report.has_errors() {
    eprint!("{}", report.to_text());
    std::process::exit(1);
}
# Ok::<(), Box<dyn std::error::Error>>(())
```

`report.resolved` is a `BTreeMap<String, Value>` of typed, default-filled values
you can hand straight to the rest of your config layer.

## License

MIT © SlothLabs
