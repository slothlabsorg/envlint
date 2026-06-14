# envlint

**Schema-driven validation for environment variables and `.env` files — one
portable schema, three native implementations.**

Most production incidents that trace back to "config" are not subtle: a required
variable was never set, a `PORT` held a hostname, a `LOG_LEVEL` of `verbose`
silently fell back to a default, a timeout was `30` (seconds? milliseconds?).
These are caught trivially *if* something declares what the service expects.

`envlint` is that something. You describe your environment once in
`envlint.toml`, then validate a `.env` file or the live process environment — in
CI, in a container entrypoint, or at process boot via the library.

```toml
# envlint.toml — the SAME file works across all three implementations
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

## Implementations

| Language   | Path                   | Install                          | Notes                                   |
|------------|------------------------|----------------------------------|-----------------------------------------|
| Rust       | [`rust/`](rust/)       | `cargo install envlint`          | Library + CLI binary                    |
| TypeScript | [`ts/`](ts/)           | `npm i @slothlabs/envlint`       | Library + `envlint` bin, ESM            |
| Kotlin/JVM | [`kotlin/`](kotlin/)   | `com.slothlabs:envlint`          | Library + CLI `main`                    |

All three parse the **same `envlint.toml`**, apply identical validation
semantics, mask secrets as `******`, and use the same CLI exit codes:
`0` clean · `1` validation errors · `2` usage/IO error.

## Supported types

`string` · `int` · `float` · `bool` (`true/false/1/0/yes/no/on/off`) · `url`
(`scheme://authority`) · `port` (`1..=65535`) · `enum` (`values = [...]`) ·
`duration` (`500ms`, `30s`, `5m`, `2h`, `1d`; bare number = seconds).

Per-variable keys: `required`, `default`, `pattern` (regex on the raw text),
`values`, `min` / `max` (numeric & duration), `secret`, `description`. A
top-level `strict = true` turns undeclared variables into errors.

See each subdirectory's README for language-specific API and CLI details.

## License

MIT © SlothLabs
