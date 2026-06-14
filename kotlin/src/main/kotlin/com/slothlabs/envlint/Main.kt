package com.slothlabs.envlint

import java.io.File
import kotlin.system.exitProcess

/** Read the current process environment into the map [Schema.validate] expects. */
fun processEnv(): Map<String, String> = System.getenv()

private const val USAGE = """envlint — schema-driven validation for environment variables

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
"""

private const val VERSION = "0.1.0"

/** A usage / I/O error that maps to exit code 2. */
private class CliError(message: String) : Exception(message)

/** Output format for `check`. */
private enum class Format { TEXT, JSON }

private class CheckOpts {
    var schema: String? = null
    var envFile: String? = null
    var useProcessEnv: Boolean = false
    var format: Format = Format.TEXT
    var strict: Boolean = false
}

fun main(args: Array<String>) {
    val code =
        try {
            run(args.toList())
        } catch (e: CliError) {
            System.err.println("envlint: ${e.message}")
            2
        }
    exitProcess(code)
}

private fun run(args: List<String>): Int {
    val first = args.firstOrNull()
    if (first == null) {
        print(USAGE)
        return 2
    }
    return when (first) {
        "--help", "-h" -> {
            print(USAGE)
            0
        }
        "--version", "-V" -> {
            println("envlint $VERSION")
            0
        }
        "init" -> cmdInit(args.drop(1))
        "check" -> cmdCheck(args.drop(1))
        else -> throw CliError("unknown command ${first.debug()}; try `envlint --help`")
    }
}

private fun cmdInit(args: List<String>): Int {
    val force = args.any { it == "--force" }
    val path = File("envlint.toml")
    if (path.exists() && !force) {
        throw CliError("envlint.toml already exists (use --force to overwrite)")
    }
    path.writeText(sampleSchema())
    println("wrote envlint.toml")
    return 0
}

private fun cmdCheck(args: List<String>): Int {
    val opts = parseCheckOpts(args)

    val schemaPath = opts.schema ?: "envlint.toml"
    val schemaSrc =
        try {
            File(schemaPath).readText()
        } catch (e: Exception) {
            throw CliError("reading schema $schemaPath: ${ioMessage(e)}")
        }
    val schema =
        try {
            Schema.fromTomlString(schemaSrc)
        } catch (e: SchemaException) {
            throw CliError(e.message ?: "invalid schema")
        }
    if (opts.strict) schema.strict = true

    val (env, source) = loadEnv(opts)
    val report = schema.validate(env)

    when (opts.format) {
        Format.TEXT -> {
            System.err.println("envlint: validating $source")
            print(report.toText())
        }
        Format.JSON -> println(report.toJson())
    }

    return if (report.hasErrors) 1 else 0
}

private fun parseCheckOpts(args: List<String>): CheckOpts {
    val opts = CheckOpts()
    val it = args.iterator()
    while (it.hasNext()) {
        val arg = it.next()
        when (arg) {
            "-s", "--schema" -> opts.schema = expectValue(it, arg)
            "-f", "--env-file" -> opts.envFile = expectValue(it, arg)
            "--env" -> opts.useProcessEnv = true
            "--strict" -> opts.strict = true
            "--format" ->
                opts.format =
                    when (val v = expectValue(it, arg)) {
                        "text" -> Format.TEXT
                        "json" -> Format.JSON
                        else -> throw CliError("unknown --format ${v.debug()}")
                    }
            else -> throw CliError("unexpected argument ${arg.debug()}")
        }
    }
    if (opts.envFile != null && opts.useProcessEnv) {
        throw CliError("--env-file and --env are mutually exclusive")
    }
    return opts
}

private fun expectValue(
    it: Iterator<String>,
    flag: String,
): String {
    if (!it.hasNext()) throw CliError("$flag requires a value")
    return it.next()
}

private fun loadEnv(opts: CheckOpts): Pair<Map<String, String>, String> {
    opts.envFile?.let { file ->
        val contents =
            try {
                File(file).readText()
            } catch (e: Exception) {
                throw CliError("reading $file: ${ioMessage(e)}")
            }
        val env =
            try {
                envFromDotenv(contents)
            } catch (e: EnvParseException) {
                throw CliError("$file: ${e.message}")
            }
        return env to file
    }
    if (opts.useProcessEnv) {
        return processEnv() to "process environment"
    }
    // Default: prefer ./.env if it exists, else the live environment.
    val dotenv = File(".env")
    return if (dotenv.exists()) {
        val contents =
            try {
                dotenv.readText()
            } catch (e: Exception) {
                throw CliError("reading .env: ${ioMessage(e)}")
            }
        val env =
            try {
                envFromDotenv(contents)
            } catch (e: EnvParseException) {
                throw CliError(".env: ${e.message}")
            }
        env to ".env"
    } else {
        processEnv() to "process environment"
    }
}

private fun ioMessage(e: Exception): String = e.message ?: e.javaClass.simpleName

/** Load the bundled sample schema scaffolded by `envlint init`. */
private fun sampleSchema(): String {
    val stream =
        Schema::class.java.getResourceAsStream("/com/slothlabs/envlint/sample-envlint.toml")
            ?: error("bundled sample-envlint.toml is missing from the jar")
    return stream.bufferedReader().use { it.readText() }
}
