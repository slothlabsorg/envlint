//! `envlint` command-line interface.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::ExitCode;

use envlint::{env_from_dotenv, process_env, Schema};

const USAGE: &str = "\
envlint — schema-driven validation for environment variables

USAGE:
    envlint check [OPTIONS]
    envlint init [--force]
    envlint --help | --version

OPTIONS (check):
    -s, --schema <FILE>     Schema file (default: envlint.toml)
    -f, --env-file <FILE>   Validate this .env file
        --env               Validate the live process environment
        --format <FMT>      Output format: text | json (default: text)
        --strict            Treat undeclared variables as errors

If neither --env-file nor --env is given, envlint validates ./.env when present,
otherwise the live process environment.

EXIT CODES:
    0   no errors
    1   validation errors found
    2   usage or I/O error
";

const SAMPLE_SCHEMA: &str = include_str!("../examples/envlint.toml");

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("envlint: {e}");
            ExitCode::from(2)
        }
    }
}

fn run(args: &[String]) -> Result<ExitCode, String> {
    let Some(first) = args.first().map(String::as_str) else {
        print!("{USAGE}");
        return Ok(ExitCode::from(2));
    };

    match first {
        "--help" | "-h" => {
            print!("{USAGE}");
            Ok(ExitCode::SUCCESS)
        }
        "--version" | "-V" => {
            println!("envlint {}", env!("CARGO_PKG_VERSION"));
            Ok(ExitCode::SUCCESS)
        }
        "init" => cmd_init(&args[1..]),
        "check" => cmd_check(&args[1..]),
        other => Err(format!("unknown command {other:?}; try `envlint --help`")),
    }
}

fn cmd_init(args: &[String]) -> Result<ExitCode, String> {
    let force = args.iter().any(|a| a == "--force");
    let path = Path::new("envlint.toml");
    if path.exists() && !force {
        return Err("envlint.toml already exists (use --force to overwrite)".into());
    }
    std::fs::write(path, SAMPLE_SCHEMA).map_err(|e| format!("writing envlint.toml: {e}"))?;
    println!("wrote envlint.toml");
    Ok(ExitCode::SUCCESS)
}

#[derive(Default)]
struct CheckOpts {
    schema: Option<String>,
    env_file: Option<String>,
    use_process_env: bool,
    format: Format,
    strict: bool,
}

#[derive(Default, PartialEq)]
enum Format {
    #[default]
    Text,
    Json,
}

fn cmd_check(args: &[String]) -> Result<ExitCode, String> {
    let opts = parse_check_opts(args)?;

    let schema_path = opts.schema.as_deref().unwrap_or("envlint.toml");
    let schema_src = std::fs::read_to_string(schema_path)
        .map_err(|e| format!("reading schema {schema_path}: {e}"))?;
    let mut schema = Schema::from_toml_str(&schema_src).map_err(|e| e.to_string())?;
    if opts.strict {
        schema.strict = true;
    }

    let (env, source) = load_env(&opts)?;
    let report = schema.validate(&env);

    match opts.format {
        Format::Text => {
            eprintln!("envlint: validating {source}");
            print!("{}", report.to_text());
        }
        Format::Json => println!("{}", report.to_json()),
    }

    Ok(if report.has_errors() {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    })
}

fn parse_check_opts(args: &[String]) -> Result<CheckOpts, String> {
    let mut opts = CheckOpts::default();
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "-s" | "--schema" => opts.schema = Some(expect_value(&mut it, arg)?),
            "-f" | "--env-file" => opts.env_file = Some(expect_value(&mut it, arg)?),
            "--env" => opts.use_process_env = true,
            "--strict" => opts.strict = true,
            "--format" => {
                opts.format = match expect_value(&mut it, arg)?.as_str() {
                    "text" => Format::Text,
                    "json" => Format::Json,
                    other => return Err(format!("unknown --format {other:?}")),
                }
            }
            other => return Err(format!("unexpected argument {other:?}")),
        }
    }
    if opts.env_file.is_some() && opts.use_process_env {
        return Err("--env-file and --env are mutually exclusive".into());
    }
    Ok(opts)
}

fn expect_value<'a>(
    it: &mut impl Iterator<Item = &'a String>,
    flag: &str,
) -> Result<String, String> {
    it.next()
        .cloned()
        .ok_or_else(|| format!("{flag} requires a value"))
}

fn load_env(opts: &CheckOpts) -> Result<(BTreeMap<String, String>, String), String> {
    if let Some(file) = &opts.env_file {
        let contents = std::fs::read_to_string(file).map_err(|e| format!("reading {file}: {e}"))?;
        let env = env_from_dotenv(&contents).map_err(|e| format!("{file}: {e}"))?;
        return Ok((env, file.clone()));
    }
    if opts.use_process_env {
        return Ok((process_env(), "process environment".to_string()));
    }
    // Default: prefer ./.env if it exists, else the live environment.
    if Path::new(".env").exists() {
        let contents = std::fs::read_to_string(".env").map_err(|e| format!("reading .env: {e}"))?;
        let env = env_from_dotenv(&contents).map_err(|e| format!(".env: {e}"))?;
        Ok((env, ".env".to_string()))
    } else {
        Ok((process_env(), "process environment".to_string()))
    }
}
