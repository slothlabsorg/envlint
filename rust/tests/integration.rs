//! End-to-end tests against the public library API.

use std::collections::BTreeMap;

use envlint::{env_from_dotenv, Schema};

const SCHEMA: &str = r#"
    [vars.PORT]
    type = "port"
    default = "8080"

    [vars.DATABASE_URL]
    type = "url"
    required = true

    [vars.TIMEOUT]
    type = "duration"
    default = "30s"

    [vars.API_KEY]
    type = "string"
    required = true
    secret = true
"#;

#[test]
fn validates_a_dotenv_file_end_to_end() {
    let dotenv = "\
# service config
export DATABASE_URL=postgres://user:pw@db:5432/app
API_KEY=\"sk-supersecret\"
TIMEOUT=45s
";
    let env = env_from_dotenv(dotenv).unwrap();
    let schema = Schema::from_toml_str(SCHEMA).unwrap();
    let report = schema.validate(&env);

    assert!(!report.has_errors(), "{:?}", report.issues);
    assert_eq!(report.resolved.len(), 4); // PORT filled from default

    // Secret values are masked in serialized output.
    let json = report.to_json();
    assert_eq!(json["resolved"]["API_KEY"], "******");
    assert_eq!(json["ok"], true);
}

#[test]
fn surfaces_missing_required_var() {
    let env: BTreeMap<String, String> = [("API_KEY".to_string(), "sk-x".to_string())]
        .into_iter()
        .collect();
    let schema = Schema::from_toml_str(SCHEMA).unwrap();
    let report = schema.validate(&env);

    assert!(report.has_errors());
    assert!(report.errors().any(|i| i.var == "DATABASE_URL"));
}

#[test]
fn malformed_dotenv_is_reported_with_line() {
    let err = env_from_dotenv("OK=1\nBROKEN").unwrap_err();
    assert_eq!(err.line, 2);
}
