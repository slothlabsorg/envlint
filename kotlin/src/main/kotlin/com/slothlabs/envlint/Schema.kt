package com.slothlabs.envlint

import com.akuleshov7.ktoml.Toml
import com.akuleshov7.ktoml.TomlInputConfig
import com.akuleshov7.ktoml.exceptions.TomlDecodingException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString

/**
 * Thrown when a schema cannot be loaded (as opposed to a validation failure
 * against a well-formed schema).
 */
class SchemaException(message: String) : Exception(message)

/**
 * The declared constraints for a single variable.
 *
 * @property type the declared [VarType] (defaults to [VarType.STRING])
 * @property required whether the variable must be present and non-empty
 * @property default value used when the variable is absent from the environment
 * @property pattern a regex (matched against the raw textual value)
 * @property values the permitted values for an `enum`-typed variable
 * @property min lower bound for numeric / duration values (seconds for durations)
 * @property max upper bound for numeric / duration values (seconds for durations)
 * @property secret whether the value is masked in all rendered output
 * @property description human-readable documentation for the variable
 */
data class VarSpec(
    val type: VarType = VarType.STRING,
    val required: Boolean = false,
    val default: String? = null,
    val pattern: String? = null,
    val values: List<String> = emptyList(),
    val min: Double? = null,
    val max: Double? = null,
    val secret: Boolean = false,
    val description: String? = null,
)

/**
 * A parsed `envlint.toml` schema: a set of named variable specs plus the
 * [strict] flag.
 *
 * Build one with [fromTomlString]; validate an environment with [validate].
 */
class Schema(
    val vars: Map<String, VarSpec>,
    var strict: Boolean = false,
) {
    /** Pre-compiled patterns, keyed by variable name (only for vars with a `pattern`). */
    private val compiledPatterns: Map<String, Regex> =
        vars.mapNotNull { (name, spec) -> spec.pattern?.let { name to Regex(it) } }.toMap()

    /**
     * Validate a set of variables (e.g. parsed from a `.env` file or read from
     * the process environment) against this schema.
     *
     * Iteration order over [vars] determines issue order; results in [Report]
     * are sorted by variable name for stable output.
     */
    fun validate(env: Map<String, String>): Report {
        val issues = ArrayList<Issue>()
        val resolved = sortedMapOf<String, Value>()
        val secrets = sortedSetOf<String>()

        for ((name, spec) in vars) {
            if (spec.secret) secrets.add(name)
            // Resolve the raw value: explicit value wins over default.
            val raw = env[name] ?: spec.default

            if (raw == null) {
                if (spec.required) {
                    issues.add(Issue.error(name, "required variable is not set"))
                }
                continue
            }

            // An explicitly-set-but-empty value for a required var is an error.
            if (spec.required && raw.isEmpty()) {
                issues.add(Issue.error(name, "required variable is empty"))
                continue
            }

            checkVar(name, spec, raw, issues, resolved)
        }

        // Report variables present in the environment but not in the schema.
        for (name in env.keys) {
            if (name !in vars) {
                issues.add(
                    if (strict) {
                        Issue.error(name, "variable is not declared in the schema")
                    } else {
                        Issue.warning(name, "variable is not declared in the schema")
                    },
                )
            }
        }

        return Report(issues, resolved, secrets)
    }

    private fun checkVar(
        name: String,
        spec: VarSpec,
        raw: String,
        issues: MutableList<Issue>,
        resolved: MutableMap<String, Value>,
    ) {
        // Enum membership is checked on the raw string.
        if (spec.type == VarType.ENUM && spec.values.none { it == raw }) {
            issues.add(Issue.error(name, "must be one of ${listDebug(spec.values)}, got ${raw.debug()}"))
            return
        }

        val value =
            when (val r = coerce(raw, spec.type)) {
                is CoercionResult.Ok -> r.value
                is CoercionResult.Err -> {
                    issues.add(Issue.error(name, r.message))
                    return
                }
            }

        // `pattern` applies to the raw textual form.
        val re = compiledPatterns[name]
        if (re != null && !re.containsMatchIn(raw)) {
            issues.add(Issue.error(name, "does not match pattern /${spec.pattern}/"))
            return
        }

        // `min`/`max` apply to numeric/duration values.
        val n = value.asNumber()
        if (n != null) {
            spec.min?.let { min ->
                if (n < min) {
                    issues.add(Issue.error(name, "${fmtNum(n)} is below min ${fmtNum(min)}"))
                    return
                }
            }
            spec.max?.let { max ->
                if (n > max) {
                    issues.add(Issue.error(name, "${fmtNum(n)} is above max ${fmtNum(max)}"))
                    return
                }
            }
        }

        resolved[name] = value
    }

    companion object {
        /**
         * Parse a schema from TOML source, validating it for internal
         * consistency (patterns compile, enums declare values).
         *
         * @throws SchemaException on a malformed or inconsistent schema.
         */
        fun fromTomlString(src: String): Schema {
            val raw =
                try {
                    Toml(inputConfig = TomlInputConfig(ignoreUnknownNames = true))
                        .decodeFromString<RawSchema>(src)
                } catch (e: TomlDecodingException) {
                    throw SchemaException("invalid schema: ${e.message}")
                } catch (e: IllegalArgumentException) {
                    throw SchemaException("invalid schema: ${e.message}")
                }

            val vars = LinkedHashMap<String, VarSpec>()
            for ((name, rawSpec) in raw.vars) {
                val type =
                    rawSpec.type?.let {
                        VarType.fromWire(it) ?: throw SchemaException("$name: unknown type \"$it\"")
                    } ?: VarType.STRING
                val spec =
                    VarSpec(
                        type = type,
                        required = rawSpec.required,
                        default = rawSpec.default,
                        pattern = rawSpec.pattern,
                        values = rawSpec.values,
                        min = rawSpec.min?.toDoubleOrNull(),
                        max = rawSpec.max?.toDoubleOrNull(),
                        secret = rawSpec.secret,
                        description = rawSpec.description,
                    )
                // Fail fast on schema-authoring mistakes so the error points at the
                // schema, not the user's environment.
                spec.pattern?.let { pat ->
                    try {
                        Regex(pat)
                    } catch (e: Exception) {
                        throw SchemaException("$name: invalid pattern: ${e.message}")
                    }
                }
                if (spec.type == VarType.ENUM && spec.values.isEmpty()) {
                    throw SchemaException("$name: enum type requires a non-empty `values` list")
                }
                vars[name] = spec
            }
            return Schema(vars, raw.strict)
        }
    }
}

/** Format a number the way the Rust report does (integral -> no decimal point). */
private fun fmtNum(x: Double): String {
    if (x == x.toLong().toDouble() && x.isFinite()) return x.toLong().toString()
    return x.toString()
}

/** Render a list of strings like Rust's `{:?}` on a `Vec<String>`. */
private fun listDebug(items: List<String>): String = items.joinToString(prefix = "[", postfix = "]") { it.debug() }

/**
 * The raw, deserialized shape of the schema. `min`/`max` arrive as a
 * [TomlNumber] wrapper so we accept either an integer (`min = 1`) or a float
 * (`min = 1.5`) literal, mirroring serde's `f64`.
 */
@Serializable
private data class RawSchema(
    val vars: Map<String, RawVarSpec> = emptyMap(),
    val strict: Boolean = false,
)

@Serializable
private data class RawVarSpec(
    @SerialName("type") val type: String? = null,
    val required: Boolean = false,
    val default: String? = null,
    val pattern: String? = null,
    val values: List<String> = emptyList(),
    val min: TomlNumber? = null,
    val max: TomlNumber? = null,
    val secret: Boolean = false,
    val description: String? = null,
)
