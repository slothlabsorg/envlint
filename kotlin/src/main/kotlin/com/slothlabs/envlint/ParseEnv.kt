package com.slothlabs.envlint

/**
 * A small, forgiving `.env` parser.
 *
 * Supports `KEY=VALUE`, `export KEY=VALUE`, `#` comments, blank lines, and
 * single- or double-quoted values (with `\n`, `\t`, `\\`, `\"` escapes inside
 * double quotes). Line numbers are preserved for diagnostics.
 */

/** A parsed assignment from a `.env` file. */
data class EnvEntry(
    val key: String,
    val value: String,
    val line: Int,
)

/**
 * Thrown when a `.env` file is malformed. Carries the 1-based [line] number so
 * callers can point at the offending assignment.
 */
class EnvParseException(
    val line: Int,
    val detail: String,
) : Exception("line $line: $detail")

/**
 * Parse the contents of a `.env` file into a list of entries.
 *
 * @throws EnvParseException if a line is malformed (with its line number).
 */
fun parseEnv(contents: String): List<EnvEntry> {
    val entries = ArrayList<EnvEntry>()
    // Match Rust's `str::lines`: split on \n, a trailing \r is stripped, and a
    // final newline does not yield an empty trailing line.
    val rawLines = contents.split('\n').let { if (it.isNotEmpty() && it.last().isEmpty()) it.dropLast(1) else it }
    for ((idx, rawWithCr) in rawLines.withIndex()) {
        val line = idx + 1
        val rawLine = rawWithCr.removeSuffix("\r")
        val trimmedStart = rawLine.trimStart()
        if (trimmedStart.isEmpty() || trimmedStart.startsWith("#")) continue
        val withoutExport = trimmedStart.removePrefix("export ")
        val eq = withoutExport.indexOf('=')
        if (eq < 0) {
            throw EnvParseException(line, "missing '=' in assignment: ${rawLine.debug()}")
        }
        val key = withoutExport.substring(0, eq).trim()
        if (key.isEmpty() || !isValidKey(key)) {
            throw EnvParseException(line, "invalid variable name: ${key.debug()}")
        }
        val rest = withoutExport.substring(eq + 1)
        val value = parseValue(rest.trim(), line)
        entries.add(EnvEntry(key, value, line))
    }
    return entries
}

/**
 * Parse a `.env` file's contents into a map, keeping the last assignment when a
 * key is repeated.
 *
 * @throws EnvParseException if the file is malformed.
 */
fun envFromDotenv(contents: String): Map<String, String> {
    val map = LinkedHashMap<String, String>()
    for (entry in parseEnv(contents)) {
        map[entry.key] = entry.value
    }
    return map
}

private fun isValidKey(key: String): Boolean {
    val first = key.first()
    if (!(first.isAsciiAlpha() || first == '_')) return false
    return key.all { it.isAsciiAlphanumeric() || it == '_' }
}

private fun parseValue(
    raw: String,
    line: Int,
): String {
    if (raw.isEmpty()) return ""
    val quote = raw.first()
    if (quote == '"' || quote == '\'') {
        val end = raw.lastIndexOf(quote)
        if (end == 0) {
            throw EnvParseException(line, "unterminated quoted value")
        }
        val inner = raw.substring(1, end)
        // Single quotes are literal.
        return if (quote == '\'') inner else unescape(inner)
    }
    // Unquoted: strip a trailing inline comment (preceded by whitespace).
    val hashIdx = raw.indexOf(" #")
    return if (hashIdx >= 0) raw.substring(0, hashIdx).trimEnd() else raw
}

private fun unescape(s: String): String =
    buildString(s.length) {
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '\\' && i + 1 < s.length) {
                when (val next = s[i + 1]) {
                    'n' -> append('\n')
                    't' -> append('\t')
                    'r' -> append('\r')
                    '\\' -> append('\\')
                    '"' -> append('"')
                    else -> {
                        append('\\')
                        append(next)
                    }
                }
                i += 2
            } else if (c == '\\') {
                append('\\')
                i += 1
            } else {
                append(c)
                i += 1
            }
        }
    }

private fun Char.isAsciiAlphanumeric(): Boolean = this in '0'..'9' || this in 'a'..'z' || this in 'A'..'Z'

private fun Char.isAsciiAlpha(): Boolean = this in 'a'..'z' || this in 'A'..'Z'
