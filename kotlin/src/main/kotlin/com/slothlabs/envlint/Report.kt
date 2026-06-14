package com.slothlabs.envlint

/** Severity of an [Issue]. */
enum class Severity(val label: String) {
    ERROR("error"),
    WARNING("warning"),
    ;

    override fun toString(): String = label
}

/** A single problem found while validating the environment. */
data class Issue(
    val variable: String,
    val severity: Severity,
    val message: String,
) {
    companion object {
        fun error(
            variable: String,
            message: String,
        ): Issue = Issue(variable, Severity.ERROR, message)

        fun warning(
            variable: String,
            message: String,
        ): Issue = Issue(variable, Severity.WARNING, message)
    }
}

/**
 * The outcome of validating a set of variables against a [Schema].
 *
 * @property issues every problem found, in the order produced
 * @property resolved successfully resolved values, keyed by variable name and
 *   sorted by name (includes values filled from defaults)
 * @property secrets names of variables whose schema marked them `secret = true`
 */
class Report internal constructor(
    val issues: List<Issue>,
    val resolved: Map<String, Value>,
    internal val secrets: Set<String>,
) {
    /** True if any [Issue] has [Severity.ERROR]. */
    val hasErrors: Boolean get() = issues.any { it.severity == Severity.ERROR }

    /** The error-severity issues, in order. */
    val errors: List<Issue> get() = issues.filter { it.severity == Severity.ERROR }

    /** The warning-severity issues, in order. */
    val warnings: List<Issue> get() = issues.filter { it.severity == Severity.WARNING }

    internal fun isSecret(variable: String): Boolean = variable in secrets

    private fun displayValue(
        variable: String,
        value: Value,
    ): String = if (isSecret(variable)) MASK else value.toString()

    /** Render a human-readable report. Secret values are masked. */
    fun toText(): String =
        buildString {
            for (issue in issues) {
                append("${issue.severity}: ${issue.variable}: ${issue.message}\n")
            }
            val err = errors.size
            val warn = warnings.size
            if (err == 0 && warn == 0) {
                append("ok: ${resolved.size} variable(s) validated\n")
            } else {
                append("$err error(s), $warn warning(s)\n")
            }
        }

    /** Render the report as a JSON document. Secret values are masked. */
    fun toJson(): String {
        val doc =
            linkedMapOf<String, Any?>(
                "ok" to !hasErrors,
                "errors" to errors.size,
                "warnings" to warnings.size,
                "issues" to
                    issues.map { i ->
                        linkedMapOf(
                            "var" to i.variable,
                            "severity" to i.severity.label,
                            "message" to i.message,
                        )
                    },
                "resolved" to resolved.mapValues { (k, v) -> displayValue(k, v) },
            )
        return renderJson(doc)
    }

    companion object {
        /** The mask shown in place of any value declared `secret = true`. */
        const val MASK: String = "******"
    }
}

private fun renderJson(value: Any?): String =
    when (value) {
        null -> "null"
        is String -> "\"${escapeJson(value)}\""
        is Boolean, is Int, is Long, is Double -> value.toString()
        is Map<*, *> ->
            value.entries.joinToString(prefix = "{", postfix = "}") { (k, v) ->
                "\"${escapeJson(k.toString())}\":${renderJson(v)}"
            }
        is Iterable<*> -> value.joinToString(prefix = "[", postfix = "]") { renderJson(it) }
        else -> "\"${escapeJson(value.toString())}\""
    }

private fun escapeJson(s: String): String =
    buildString(s.length + 2) {
        for (c in s) {
            when (c) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (c < ' ') append("\\u%04x".format(c.code)) else append(c)
            }
        }
    }
