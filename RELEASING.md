# Releasing envlint

This monorepo ships three independent packages (Rust, TypeScript, Kotlin/JVM).
Each is released by pushing a **tag with the package's prefix**; a dedicated
GitHub Actions workflow then publishes that one package. The tags are
independent — bumping one ecosystem never forces the others.

| Ecosystem  | Tag prefix  | Workflow                          | Publishes to        |
|------------|-------------|-----------------------------------|---------------------|
| Rust       | `rust-v*`   | `.github/workflows/release-rust.yml`  | crates.io           |
| TypeScript | `npm-v*`    | `.github/workflows/release-npm.yml`   | npmjs.org (public)  |
| Kotlin/JVM | `jvm-v*`    | `.github/workflows/release-maven.yml` | GitHub Packages     |
| Kotlin/JVM | _(any tag)_ | — (JitPack, on demand)            | jitpack.io          |

A plain `vX.Y.Z` tag (e.g. `v0.1.0`) matches **none** of the release-workflow
prefixes, so it fires no publish workflow. It still makes the JVM artifact
resolvable through JitPack (see below).

## One-time setup

### Rust → crates.io
1. Create an API token at <https://crates.io/settings/tokens> with the
   "publish-new" + "publish-update" scopes for the `envlint` crate.
2. Add it as the repository secret **`CARGO_REGISTRY_TOKEN`**
   (Settings → Secrets and variables → Actions).

The crate name `envlint` is reserved/owned on crates.io. Nothing else is needed.

### TypeScript → npm
1. Own/create the **`@slothlabs`** npm organization (the package is
   `@slothlabs/envlint`, a scoped public package).
2. Create an npm **automation** access token that can publish to that org.
3. Add it as the repository secret **`NPM_TOKEN`**.

The workflow publishes with `--provenance` (npm provenance), which needs the
`id-token: write` permission already set in the workflow.

### Kotlin/JVM → GitHub Packages
Nothing to set up. The workflow authenticates with the built-in
`GITHUB_TOKEN` and the `packages: write` permission. Consumers of GitHub
Packages must authenticate with a GitHub token to resolve the artifact.

### Kotlin/JVM → Maven Central (optional)
Not configured here. If you later want Central instead of (or in addition to)
GitHub Packages, add the `signing` plugin, an OSSRH/Central Portal account, and
the `sonatype`/signing credentials as secrets, then publish to the Central
staging repository from a workflow. JitPack already covers "consumable now"
without any of this.

## Cutting a release

```bash
# Rust → crates.io
git tag -a rust-v0.1.0 -m "rust-v0.1.0" && git push origin rust-v0.1.0

# npm → npmjs.org
git tag -a npm-v0.1.0 -m "npm-v0.1.0" && git push origin npm-v0.1.0

# Kotlin/JVM → GitHub Packages
git tag -a jvm-v0.1.0 -m "jvm-v0.1.0" && git push origin jvm-v0.1.0
```

Each workflow derives the published version from the tag (the JVM workflow and
JitPack strip the leading `v`, so `jvm-v0.1.0` publishes `0.1.0`).

## JitPack — zero-setup JVM consumption

JitPack needs **nothing but a git tag** (no account, no secrets). On the first
request for a coordinate, JitPack checks out the tag, reads `jitpack.yml`, and
runs `./gradlew publishToMavenLocal` in `kotlin/`.

Consume the artifact in a Gradle (Kotlin DSL) build:

```kotlin
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.slothlabsorg:envlint:0.1.0")
}
```

Use any pushed tag (e.g. `0.1.0` resolves the `v0.1.0` tag) or a commit SHA as
the version.
