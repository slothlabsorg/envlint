//! The `envlint.toml` schema model and the validation engine.

use std::collections::BTreeMap;

use regex::Regex;
use serde::Deserialize;

use crate::report::{Issue, Report};
use crate::value::{coerce, VarType};

/// A parsed schema: a set of named variable specs.
#[derive(Debug, Deserialize)]
pub struct Schema {
    #[serde(default)]
    pub vars: BTreeMap<String, VarSpec>,
    /// When true, variables present in the environment but absent from the
    /// schema are reported as errors instead of warnings.
    #[serde(default)]
    pub strict: bool,
}

/// The declared constraints for a single variable.
#[derive(Debug, Deserialize)]
pub struct VarSpec {
    #[serde(rename = "type", default)]
    pub ty: VarType,
    #[serde(default)]
    pub required: bool,
    pub default: Option<String>,
    pub pattern: Option<String>,
    #[serde(default)]
    pub values: Vec<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    #[serde(default)]
    pub secret: bool,
    pub description: Option<String>,
}

/// Errors that can occur while loading a schema (as opposed to validating
/// against it).
#[derive(Debug)]
pub enum SchemaError {
    Toml(toml::de::Error),
    /// A `pattern` failed to compile, for the named variable.
    BadPattern {
        var: String,
        message: String,
    },
    /// An `enum`-typed var declared no `values`.
    EmptyEnum {
        var: String,
    },
}

impl std::fmt::Display for SchemaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SchemaError::Toml(e) => write!(f, "invalid schema: {e}"),
            SchemaError::BadPattern { var, message } => {
                write!(f, "{var}: invalid pattern: {message}")
            }
            SchemaError::EmptyEnum { var } => {
                write!(f, "{var}: enum type requires a non-empty `values` list")
            }
        }
    }
}

impl std::error::Error for SchemaError {}

impl Schema {
    /// Parse a schema from TOML source, validating it for internal consistency.
    pub fn from_toml_str(src: &str) -> Result<Schema, SchemaError> {
        let schema: Schema = toml::from_str(src).map_err(SchemaError::Toml)?;
        // Fail fast on schema-authoring mistakes so the error points at the
        // schema, not the user's environment.
        for (name, spec) in &schema.vars {
            if let Some(pat) = &spec.pattern {
                Regex::new(pat).map_err(|e| SchemaError::BadPattern {
                    var: name.clone(),
                    message: e.to_string(),
                })?;
            }
            if spec.ty == VarType::Enum && spec.values.is_empty() {
                return Err(SchemaError::EmptyEnum { var: name.clone() });
            }
        }
        Ok(schema)
    }

    /// Validate a set of variables (e.g. parsed from a `.env` file or read from
    /// the process environment) against this schema.
    pub fn validate(&self, env: &BTreeMap<String, String>) -> Report {
        let mut report = Report::default();

        for (name, spec) in &self.vars {
            if spec.secret {
                report.secrets.insert(name.clone(), ());
            }
            // Resolve the raw value: explicit value wins over default.
            let raw = env.get(name).cloned().or_else(|| spec.default.clone());

            let Some(raw) = raw else {
                if spec.required {
                    report
                        .issues
                        .push(Issue::error(name, "required variable is not set"));
                }
                continue;
            };

            // An explicitly-set-but-empty value for a required var is an error.
            if spec.required && raw.is_empty() {
                report
                    .issues
                    .push(Issue::error(name, "required variable is empty"));
                continue;
            }

            self.check_var(name, spec, &raw, &mut report);
        }

        // Report variables present in the environment but not in the schema.
        for name in env.keys() {
            if !self.vars.contains_key(name) {
                let issue = if self.strict {
                    Issue::error(name, "variable is not declared in the schema")
                } else {
                    Issue::warning(name, "variable is not declared in the schema")
                };
                report.issues.push(issue);
            }
        }

        report
    }

    fn check_var(&self, name: &str, spec: &VarSpec, raw: &str, report: &mut Report) {
        // Enum membership is checked on the raw string.
        if spec.ty == VarType::Enum && !spec.values.iter().any(|v| v == raw) {
            report.issues.push(Issue::error(
                name,
                format!("must be one of {:?}, got {:?}", spec.values, raw),
            ));
            return;
        }

        let value = match coerce(raw, spec.ty) {
            Ok(v) => v,
            Err(msg) => {
                report.issues.push(Issue::error(name, msg));
                return;
            }
        };

        // `pattern` applies to the raw textual form.
        if let Some(pat) = &spec.pattern {
            // Safe to unwrap: patterns are compiled in `from_toml_str`.
            let re = Regex::new(pat).expect("pattern validated at load time");
            if !re.is_match(raw) {
                report.issues.push(Issue::error(
                    name,
                    format!("does not match pattern /{pat}/"),
                ));
                return;
            }
        }

        // `min`/`max` apply to numeric/duration values.
        if let Some(n) = value.as_number() {
            if let Some(min) = spec.min {
                if n < min {
                    report
                        .issues
                        .push(Issue::error(name, format!("{n} is below min {min}")));
                    return;
                }
            }
            if let Some(max) = spec.max {
                if n > max {
                    report
                        .issues
                        .push(Issue::error(name, format!("{n} is above max {max}")));
                    return;
                }
            }
        }

        report.resolved.insert(name.to_string(), value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    const SCHEMA: &str = r#"
        [vars.PORT]
        type = "port"
        default = "8080"

        [vars.LOG_LEVEL]
        type = "enum"
        values = ["debug", "info", "warn", "error"]
        default = "info"

        [vars.DATABASE_URL]
        type = "url"
        required = true

        [vars.API_KEY]
        type = "string"
        required = true
        secret = true
        pattern = "^sk-[A-Za-z0-9]{8,}$"

        [vars.WORKERS]
        type = "int"
        min = 1
        max = 64
        default = "4"
    "#;

    #[test]
    fn happy_path_uses_defaults() {
        let schema = Schema::from_toml_str(SCHEMA).unwrap();
        let report = schema.validate(&env(&[
            ("DATABASE_URL", "postgres://db:5432/app"),
            ("API_KEY", "sk-abcdef12"),
        ]));
        assert!(!report.has_errors(), "{:?}", report.issues);
        assert_eq!(report.resolved.len(), 5); // includes 3 defaults
    }

    #[test]
    fn flags_missing_required_and_bad_values() {
        let schema = Schema::from_toml_str(SCHEMA).unwrap();
        let report = schema.validate(&env(&[
            ("LOG_LEVEL", "verbose"),
            ("API_KEY", "nope"),
            ("WORKERS", "999"),
        ]));
        assert!(report.has_errors());
        let vars: Vec<_> = report.errors().map(|i| i.var.as_str()).collect();
        assert!(vars.contains(&"DATABASE_URL")); // required, missing
        assert!(vars.contains(&"LOG_LEVEL")); // not in enum
        assert!(vars.contains(&"API_KEY")); // pattern mismatch
        assert!(vars.contains(&"WORKERS")); // above max
    }

    #[test]
    fn undeclared_var_is_warning_then_error_in_strict() {
        let mut schema = Schema::from_toml_str(SCHEMA).unwrap();
        let e = env(&[
            ("DATABASE_URL", "https://x.y"),
            ("API_KEY", "sk-abcdef12"),
            ("MYSTERY", "1"),
        ]);
        let report = schema.validate(&e);
        assert!(!report.has_errors());
        assert_eq!(report.warnings().count(), 1);

        schema.strict = true;
        let report = schema.validate(&e);
        assert!(report.has_errors());
    }

    #[test]
    fn rejects_bad_schema() {
        assert!(Schema::from_toml_str("[vars.X]\ntype=\"string\"\npattern=\"(\"").is_err());
        assert!(Schema::from_toml_str("[vars.X]\ntype=\"enum\"").is_err());
    }
}
