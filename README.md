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

| Language   | Path                   | Distribution                       | Notes                          |
|------------|------------------------|------------------------------------|--------------------------------|
| Rust       | [`rust/`](rust/)       | git dependency / `cargo install`   | Library + CLI binary           |
| TypeScript | [`ts/`](ts/)           | `@slothlabs/envlint` (npm)         | Library + `envlint` bin, ESM   |
| Kotlin/JVM | [`kotlin/`](kotlin/)   | JitPack (`com.github.slothlabsorg`)| Library + CLI `main`           |

All three parse the **same `envlint.toml`**, apply identical validation
semantics, mask secrets as `******`, and use the same CLI exit codes:
`0` clean · `1` validation errors · `2` usage/IO error.

## Install

### Rust — straight from git (no registry needed)

Add the library to a Cargo project:

```bash
cargo add envlint --git https://github.com/slothlabsorg/envlint
```

Or install the CLI binary:

```bash
cargo install --git https://github.com/slothlabsorg/envlint envlint
```

The repository root is a Cargo virtual workspace, so the git dependency
resolves the `rust/` member crate automatically. (A crates.io release —
`cargo add envlint` / `cargo install envlint` — is wired up behind a `rust-v*`
tag.)

### Kotlin/JVM — JitPack (no credentials needed)

```kotlin
repositories {
    mavenCentral()
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.slothlabsorg:envlint:v0.1.0")
}
```

JitPack builds the `kotlin/` module on first request for a tagged version.

### TypeScript — npm

```bash
npm i @slothlabs/envlint
```

(Published to the public npm registry by the `npm-v*` release workflow.)

See [`RELEASING.md`](RELEASING.md) for the tag-driven release workflows and the
one-time setup each registry needs.

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
