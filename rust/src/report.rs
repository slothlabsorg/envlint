//! Validation issues and the report produced by a run.

use std::collections::BTreeMap;
use std::fmt;

use crate::value::Value;

/// Severity of an [`Issue`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Severity::Error => f.write_str("error"),
            Severity::Warning => f.write_str("warning"),
        }
    }
}

/// A single problem found while validating the environment.
#[derive(Debug, Clone, PartialEq)]
pub struct Issue {
    pub var: String,
    pub severity: Severity,
    pub message: String,
}

impl Issue {
    pub fn error(var: impl Into<String>, message: impl Into<String>) -> Self {
        Issue {
            var: var.into(),
            severity: Severity::Error,
            message: message.into(),
        }
    }

    pub fn warning(var: impl Into<String>, message: impl Into<String>) -> Self {
        Issue {
            var: var.into(),
            severity: Severity::Warning,
            message: message.into(),
        }
    }
}

/// The outcome of validating a set of variables against a schema.
#[derive(Debug, Default)]
pub struct Report {
    pub issues: Vec<Issue>,
    /// Successfully resolved values, keyed by variable name. Includes defaults.
    pub resolved: BTreeMap<String, Value>,
    /// Names of variables whose schema marked them `secret = true`.
    pub(crate) secrets: BTreeMap<String, ()>,
}

impl Report {
    pub fn has_errors(&self) -> bool {
        self.issues.iter().any(|i| i.severity == Severity::Error)
    }

    pub fn errors(&self) -> impl Iterator<Item = &Issue> {
        self.issues.iter().filter(|i| i.severity == Severity::Error)
    }

    pub fn warnings(&self) -> impl Iterator<Item = &Issue> {
        self.issues
            .iter()
            .filter(|i| i.severity == Severity::Warning)
    }

    pub(crate) fn is_secret(&self, var: &str) -> bool {
        self.secrets.contains_key(var)
    }

    fn display_value(&self, var: &str, value: &Value) -> String {
        if self.is_secret(var) {
            "******".to_string()
        } else {
            value.to_string()
        }
    }

    /// Render a human-readable report. Secret values are masked.
    pub fn to_text(&self) -> String {
        let mut out = String::new();
        for issue in &self.issues {
            out.push_str(&format!(
                "{}: {}: {}\n",
                issue.severity, issue.var, issue.message
            ));
        }
        let err = self.errors().count();
        let warn = self.warnings().count();
        if err == 0 && warn == 0 {
            out.push_str(&format!(
                "ok: {} variable(s) validated\n",
                self.resolved.len()
            ));
        } else {
            out.push_str(&format!("{err} error(s), {warn} warning(s)\n"));
        }
        out
    }

    /// Render the report as a JSON document. Secret values are masked.
    pub fn to_json(&self) -> serde_json::Value {
        let issues: Vec<_> = self
            .issues
            .iter()
            .map(|i| {
                serde_json::json!({
                    "var": i.var,
                    "severity": i.severity.to_string(),
                    "message": i.message,
                })
            })
            .collect();
        let resolved: serde_json::Map<String, serde_json::Value> = self
            .resolved
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    serde_json::Value::String(self.display_value(k, v)),
                )
            })
            .collect();
        serde_json::json!({
            "ok": !self.has_errors(),
            "errors": self.errors().count(),
            "warnings": self.warnings().count(),
            "issues": issues,
            "resolved": resolved,
        })
    }
}
