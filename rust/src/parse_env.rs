//! A small, forgiving `.env` parser.
//!
//! Supports `KEY=VALUE`, `export KEY=VALUE`, `#` comments, blank lines, and
//! single- or double-quoted values (with `\n`, `\t`, `\\`, `\"` escapes inside
//! double quotes). Line numbers are preserved for diagnostics.

/// A parsed assignment from a `.env` file.
#[derive(Debug, Clone, PartialEq)]
pub struct EnvEntry {
    pub key: String,
    pub value: String,
    pub line: usize,
}

/// An error encountered while parsing a `.env` file.
#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub line: usize,
    pub message: String,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "line {}: {}", self.line, self.message)
    }
}

impl std::error::Error for ParseError {}

/// Parse the contents of a `.env` file.
pub fn parse(contents: &str) -> Result<Vec<EnvEntry>, ParseError> {
    let mut entries = Vec::new();
    for (idx, raw_line) in contents.lines().enumerate() {
        let line = idx + 1;
        let trimmed = raw_line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let trimmed = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        let Some((key, rest)) = trimmed.split_once('=') else {
            return Err(ParseError {
                line,
                message: format!("missing '=' in assignment: {raw_line:?}"),
            });
        };
        let key = key.trim().to_string();
        if key.is_empty() || !is_valid_key(&key) {
            return Err(ParseError {
                line,
                message: format!("invalid variable name: {key:?}"),
            });
        }
        let value = parse_value(rest.trim(), line)?;
        entries.push(EnvEntry { key, value, line });
    }
    Ok(entries)
}

fn is_valid_key(key: &str) -> bool {
    let mut chars = key.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn parse_value(raw: &str, line: usize) -> Result<String, ParseError> {
    if raw.is_empty() {
        return Ok(String::new());
    }
    let bytes = raw.as_bytes();
    let quote = bytes[0];
    if quote == b'"' || quote == b'\'' {
        let closing = raw[1..].rfind(quote as char).map(|i| i + 1);
        let Some(end) = closing else {
            return Err(ParseError {
                line,
                message: "unterminated quoted value".to_string(),
            });
        };
        let inner = &raw[1..end];
        if quote == b'\'' {
            // Single quotes are literal.
            return Ok(inner.to_string());
        }
        return Ok(unescape(inner));
    }
    // Unquoted: strip a trailing inline comment (preceded by whitespace).
    let value = match raw.find(" #") {
        Some(i) => raw[..i].trim_end(),
        None => raw,
    };
    Ok(value.to_string())
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('\\') => out.push('\\'),
                Some('"') => out.push('"'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_assignments() {
        let entries = parse("FOO=bar\nexport BAZ=qux\n# comment\n\nN=1").unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(
            entries[0],
            EnvEntry {
                key: "FOO".into(),
                value: "bar".into(),
                line: 1
            }
        );
        assert_eq!(entries[1].key, "BAZ");
        assert_eq!(entries[2].line, 5); // comment + blank lines skipped
    }

    #[test]
    fn handles_quotes_and_comments() {
        let entries = parse(
            r#"A="hello world"
B='raw $VALUE'
C=plain # trailing
D="line\nbreak""#,
        )
        .unwrap();
        assert_eq!(entries[0].value, "hello world");
        assert_eq!(entries[1].value, "raw $VALUE");
        assert_eq!(entries[2].value, "plain");
        assert_eq!(entries[3].value, "line\nbreak");
    }

    #[test]
    fn rejects_malformed() {
        assert!(parse("NOEQUALS").is_err());
        assert!(parse("1BAD=x").is_err());
        assert!(parse("A=\"unterminated").is_err());
    }
}
