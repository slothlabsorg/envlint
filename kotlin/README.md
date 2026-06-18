# envlint

**Schema-driven validation for environment variables and `.env` files.**

Most production incidents that trace back to "config" are not subtle: a required
variable was never set, a `PORT` held a hostname, a `LOG_LEVEL` of `verbose`
silently fell back to a default, a timeout was `30` (seconds? milliseconds?).
These are caught trivially *if* something declares what the service expects.

`envlint` is that something. You describe your environment once in
`envlint.toml`, then validate a `.env` file or the live process environment — in
CI, in a container entrypoint, or at process boot via the library.

This is the Kotlin/JVM port. The `envlint.toml` schema format is identical
across the Rust, TypeScript, and Kotlin implementations, so the same schema
validates a Kotlin service, a Rust binary, and a Node container.

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

## Why not a config library?

Libraries like dotenv / Spring `@ConfigurationProperties` make a *running
program* read its config. `envlint` is a **gate that runs before your program
(or your deploy) does**, with no code in the target service and no language
lock-in — the same `envlint.toml` validates a Kotlin service, a Rust binary, and
a shell-based job. It is a CI/CD check first, a library second.

## Install

Add the library to a Gradle (Kotlin DSL) project via JitPack — works today
with no credentials, built straight from a git tag:

```kotlin
repositories {
    mavenCentral()
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.slothlabsorg:envlint:v0.1.0")
}
```

A `jvm-v*` tag additionally publishes `com.slothlabs:envlint` to GitHub
Packages (which requires a GitHub token to resolve). See the repo-root
[`RELEASING.md`](../RELEASING.md).

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

Build a runnable distribution with the Gradle `application` plugin:

```bash
./gradlew installDist
./build/install/envlint/bin/envlint check --env-file .env --strict
```

### GitHub Actions

```yaml
- run: ./gradlew installDist
- run: ./build/install/envlint/bin/envlint check --env-file .env.ci --strict --format json
```

## Supported types

| `type`     | Accepts                                                        |
|------------|----------------------------------------------------------------|
| `string`   | any value (the default)                                        |
| `int`      | signed integer; honours `min` / `max`                          |
| `float`    | floating point; honours `min` / `max`                          |
| `bool`     | `true/false`, `1/0`, `yes/no`, `on/off` (case-insensitive)     |
| `url`      | `scheme://authority[...]`                                      |
| `port`     | integer in `1..65535`                                          |
| `enum`     | one of `values = [...]`                                        |
| `duration` | `500ms`, `30s`, `5m`, `2h`, `1d`; bare number = seconds        |

Per-variable keys: `required`, `default`, `pattern` (regex, matched on the raw
text), `values` (for `enum`), `min` / `max` (numeric & duration, in seconds),
`secret` (masks the value in all output), `description`.

## Library

```kotlin
import com.slothlabs.envlint.Schema
import com.slothlabs.envlint.envFromDotenv
import java.io.File
import kotlin.system.exitProcess

val schema = Schema.fromTomlString(File("envlint.toml").readText())
val env = envFromDotenv(File(".env").readText())
val report = schema.validate(env)

if (report.hasErrors) {
    System.err.print(report.toText())
    exitProcess(1)
}
```

`report.resolved` is a `Map<String, Value>` of typed, default-filled values
(sorted by name) you can hand straight to the rest of your config layer. `Value`
is a sealed class — `Value.Int`, `Value.Port`, `Value.Dur` (a
`kotlin.time.Duration`), and so on. `report.toText()` and `report.toJson()`
render the outcome with every `secret` value masked as `******`.

The `.env` parser is available directly as `parseEnv(contents)` (returning
line-numbered `EnvEntry` records) and throws `EnvParseException` — carrying the
offending `line` — on malformed input.

## License

MIT © SlothLabs
