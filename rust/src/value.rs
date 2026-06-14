//! Typed values and coercion from raw environment strings.

use std::fmt;
use std::time::Duration;

use serde::Deserialize;

/// The declared type of a variable in the schema.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum VarType {
    /// Any UTF-8 string (the default when `type` is omitted).
    #[default]
    String,
    /// A signed 64-bit integer.
    Int,
    /// A 64-bit float.
    Float,
    /// A boolean: `true/false`, `1/0`, `yes/no`, `on/off` (case-insensitive).
    Bool,
    /// A URL with a scheme and authority, e.g. `https://host[:port]/path`.
    Url,
    /// A TCP/UDP port in the range `1..=65535`.
    Port,
    /// One of an explicit set of allowed string values (`values = [...]`).
    Enum,
    /// A human duration such as `500ms`, `30s`, `5m`, `2h`, `1d`.
    Duration,
}

impl fmt::Display for VarType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            VarType::String => "string",
            VarType::Int => "int",
            VarType::Float => "float",
            VarType::Bool => "bool",
            VarType::Url => "url",
            VarType::Port => "port",
            VarType::Enum => "enum",
            VarType::Duration => "duration",
        };
        f.write_str(s)
    }
}

/// A successfully coerced value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Str(String),
    Int(i64),
    Float(f64),
    Bool(bool),
    Url(String),
    Port(u16),
    Duration(Duration),
}

impl Value {
    /// Numeric magnitude for `min`/`max` checks, if the value is comparable.
    pub(crate) fn as_number(&self) -> Option<f64> {
        match self {
            Value::Int(i) => Some(*i as f64),
            Value::Float(f) => Some(*f),
            Value::Port(p) => Some(*p as f64),
            Value::Duration(d) => Some(d.as_secs_f64()),
            _ => None,
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Str(s) | Value::Url(s) => f.write_str(s),
            Value::Int(i) => write!(f, "{i}"),
            Value::Float(x) => write!(f, "{x}"),
            Value::Bool(b) => write!(f, "{b}"),
            Value::Port(p) => write!(f, "{p}"),
            Value::Duration(d) => write!(f, "{}ms", d.as_millis()),
        }
    }
}

/// Coerce a raw string into the requested [`VarType`].
///
/// Returns a human-readable error describing the expectation on failure.
pub fn coerce(raw: &str, ty: VarType) -> Result<Value, String> {
    match ty {
        VarType::String => Ok(Value::Str(raw.to_string())),
        VarType::Int => raw
            .trim()
            .parse::<i64>()
            .map(Value::Int)
            .map_err(|_| format!("expected an integer, got {raw:?}")),
        VarType::Float => raw
            .trim()
            .parse::<f64>()
            .map(Value::Float)
            .map_err(|_| format!("expected a float, got {raw:?}")),
        VarType::Bool => parse_bool(raw).map(Value::Bool).ok_or_else(|| {
            format!("expected a boolean (true/false/1/0/yes/no/on/off), got {raw:?}")
        }),
        VarType::Port => parse_port(raw)
            .map(Value::Port)
            .ok_or_else(|| format!("expected a port in 1..=65535, got {raw:?}")),
        VarType::Url => {
            if is_url(raw) {
                Ok(Value::Url(raw.to_string()))
            } else {
                Err(format!(
                    "expected a URL with scheme://authority, got {raw:?}"
                ))
            }
        }
        // Enum values are validated against `values` by the schema layer; here we
        // simply carry the string through.
        VarType::Enum => Ok(Value::Str(raw.to_string())),
        VarType::Duration => parse_duration(raw)
            .map(Value::Duration)
            .ok_or_else(|| format!("expected a duration like 30s/5m/2h, got {raw:?}")),
    }
}

fn parse_bool(raw: &str) -> Option<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Some(true),
        "false" | "0" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn parse_port(raw: &str) -> Option<u16> {
    match raw.trim().parse::<u32>() {
        Ok(n) if (1..=65535).contains(&n) => Some(n as u16),
        _ => None,
    }
}

/// Minimal, dependency-free URL shape check: `scheme://authority[...]`.
fn is_url(raw: &str) -> bool {
    let raw = raw.trim();
    let Some((scheme, rest)) = raw.split_once("://") else {
        return false;
    };
    if scheme.is_empty()
        || !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return false;
    }
    if !scheme
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic())
    {
        return false;
    }
    // Authority must be non-empty and not start with a path/query separator.
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    !authority.is_empty()
}

/// Parse a human duration. Supported suffixes: `ms`, `s`, `m`, `h`, `d`.
/// A bare number is interpreted as seconds.
fn parse_duration(raw: &str) -> Option<Duration> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let (num, mult_ms): (&str, f64) = if let Some(n) = raw.strip_suffix("ms") {
        (n, 1.0)
    } else if let Some(n) = raw.strip_suffix('s') {
        (n, 1_000.0)
    } else if let Some(n) = raw.strip_suffix('m') {
        (n, 60_000.0)
    } else if let Some(n) = raw.strip_suffix('h') {
        (n, 3_600_000.0)
    } else if let Some(n) = raw.strip_suffix('d') {
        (n, 86_400_000.0)
    } else {
        (raw, 1_000.0)
    };
    let value: f64 = num.trim().parse().ok()?;
    if value < 0.0 || !value.is_finite() {
        return None;
    }
    Some(Duration::from_secs_f64(value * mult_ms / 1_000.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coerces_scalars() {
        assert_eq!(coerce("42", VarType::Int).unwrap(), Value::Int(42));
        assert_eq!(coerce("3.5", VarType::Float).unwrap(), Value::Float(3.5));
        assert_eq!(coerce("YES", VarType::Bool).unwrap(), Value::Bool(true));
        assert_eq!(coerce("off", VarType::Bool).unwrap(), Value::Bool(false));
        assert_eq!(coerce("8080", VarType::Port).unwrap(), Value::Port(8080));
    }

    #[test]
    fn rejects_bad_scalars() {
        assert!(coerce("not-int", VarType::Int).is_err());
        assert!(coerce("0", VarType::Port).is_err());
        assert!(coerce("70000", VarType::Port).is_err());
        assert!(coerce("maybe", VarType::Bool).is_err());
    }

    #[test]
    fn url_shape() {
        assert!(is_url("https://example.com"));
        assert!(is_url("postgres://user:pass@db:5432/app"));
        assert!(!is_url("example.com"));
        assert!(!is_url("://nohost"));
        assert!(!is_url("1http://x"));
        assert!(!is_url("http:///path"));
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration("500ms"), Some(Duration::from_millis(500)));
        assert_eq!(parse_duration("30s"), Some(Duration::from_secs(30)));
        assert_eq!(parse_duration("5m"), Some(Duration::from_secs(300)));
        assert_eq!(parse_duration("2h"), Some(Duration::from_secs(7200)));
        assert_eq!(parse_duration("1d"), Some(Duration::from_secs(86_400)));
        assert_eq!(parse_duration("10"), Some(Duration::from_secs(10)));
        assert_eq!(parse_duration("-1s"), None);
        assert_eq!(parse_duration("abc"), None);
    }
}
