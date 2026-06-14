//! # envlint
//!
//! Schema-driven validation for environment variables and `.env` files.
//!
//! Most configuration bugs are not logic bugs — they are a missing variable, a
//! port that is actually a hostname, or a `LOG_LEVEL` of `verbose` that silently
//! falls back to a default. `envlint` lets you declare what your service expects
//! in a single `envlint.toml` and fail fast, in CI or at boot, when reality
//! disagrees.
//!
//! ```
//! use std::collections::BTreeMap;
//! use envlint::Schema;
//!
//! let schema = Schema::from_toml_str(r#"
//!     [vars.PORT]
//!     type = "port"
//!     default = "8080"
//!
//!     [vars.DATABASE_URL]
//!     type = "url"
//!     required = true
//! "#).unwrap();
//!
//! let mut env = BTreeMap::new();
//! env.insert("DATABASE_URL".to_string(), "postgres://db:5432/app".to_string());
//!
//! let report = schema.validate(&env);
//! assert!(!report.has_errors());
//! assert_eq!(report.resolved.len(), 2); // PORT resolved from its default
//! ```
//!
//! See the `envlint` binary for a ready-made CLI (`envlint check`).

mod parse_env;
mod report;
mod schema;
mod value;

pub use parse_env::{parse as parse_env, EnvEntry, ParseError};
pub use report::{Issue, Report, Severity};
pub use schema::{Schema, SchemaError, VarSpec};
pub use value::{coerce, Value, VarType};

use std::collections::BTreeMap;

/// Read the current process environment into the map shape [`Schema::validate`]
/// expects.
pub fn process_env() -> BTreeMap<String, String> {
    std::env::vars().collect()
}

/// Convenience: parse a `.env` file's contents into a map, keeping the last
/// assignment when a key is repeated.
///
/// Returns the parse error (with a line number) if the file is malformed.
pub fn env_from_dotenv(contents: &str) -> Result<BTreeMap<String, String>, ParseError> {
    let mut map = BTreeMap::new();
    for entry in parse_env(contents)? {
        map.insert(entry.key, entry.value);
    }
    Ok(map)
}
