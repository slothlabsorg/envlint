package com.slothlabs.envlint

import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds

/**
 * The declared type of a variable in the schema.
 *
 * The wire name (as written in `envlint.toml`'s `type = "..."`) is the
 * lowercased enum name, kept portable across the Rust/TS/Kotlin ports.
 */
enum class VarType(val wire: String) {
    /** Any UTF-8 string (the default when `type` is omitted). */
    STRING("string"),

    /** A signed 64-bit integer. */
    INT("int"),

    /** A 64-bit float. */
    FLOAT("float"),

    /** A boolean: `true/false`, `1/0`, `yes/no`, `on/off` (case-insensitive). */
    BOOL("bool"),

    /** A URL with a scheme and authority, e.g. `https://host[:port]/path`. */
    URL("url"),

    /** A TCP/UDP port in the range `1..65535`. */
    PORT("port"),

    /** One of an explicit set of allowed string values (`values = [...]`). */
    ENUM("enum"),

    /** A human duration such as `500ms`, `30s`, `5m`, `2h`, `1d`. */
    DURATION("duration"),
    ;

    override fun toString(): String = wire

    companion object {
        /** Parse a `type` string from the schema; null if unknown. */
        fun fromWire(s: String): VarType? = entries.firstOrNull { it.wire == s }
    }
}

/**
 * A successfully coerced, typed value.
 *
 * Each variant overrides [toString] to render the human display form used in
 * reports (before any secret masking); structural equality is provided by the
 * `data class` declarations.
 */
sealed class Value {
    data class Str(val value: String) : Value() {
        override fun toString(): String = value
    }

    data class Int(val value: Long) : Value() {
        override fun toString(): String = value.toString()
    }

    data class Float(val value: Double) : Value() {
        override fun toString(): String = formatFloat(value)
    }

    data class Bool(val value: Boolean) : Value() {
        override fun toString(): String = value.toString()
    }

    data class Url(val value: String) : Value() {
        override fun toString(): String = value
    }

    data class Port(val value: kotlin.Int) : Value() {
        override fun toString(): String = value.toString()
    }

    data class Dur(val value: Duration) : Value() {
        override fun toString(): String = "${value.inWholeMilliseconds}ms"
    }

    /** Numeric magnitude for `min`/`max` checks, if the value is comparable. */
    internal fun asNumber(): Double? =
        when (this) {
            is Int -> value.toDouble()
            is Float -> value
            is Port -> value.toDouble()
            is Dur -> value.inWholeMilliseconds.toDouble() / 1_000.0
            else -> null
        }
}

/**
 * Render a float the way Rust's `{}` does: integral values keep no decimal
 * point (`3.0` -> `3`), everything else uses the shortest round-trippable form.
 */
private fun formatFloat(x: Double): String {
    if (x == x.toLong().toDouble() && !x.isInfinite()) return x.toLong().toString()
    return x.toString()
}

/**
 * Coerce a raw string into the requested [VarType].
 *
 * Returns [CoercionResult.Ok] on success or [CoercionResult.Err] with a
 * human-readable description of the expectation on failure.
 */
sealed class CoercionResult {
    data class Ok(val value: Value) : CoercionResult()

    data class Err(val message: String) : CoercionResult()
}

/** Coerce [raw] into [ty]. */
fun coerce(
    raw: String,
    ty: VarType,
): CoercionResult =
    when (ty) {
        VarType.STRING -> CoercionResult.Ok(Value.Str(raw))
        VarType.INT ->
            raw.trim().toLongOrNull()
                ?.let { CoercionResult.Ok(Value.Int(it)) }
                ?: CoercionResult.Err("expected an integer, got ${raw.debug()}")
        VarType.FLOAT ->
            raw.trim().toDoubleOrNull()
                ?.takeIf { it.isFinite() || raw.trim().lowercase() in setOf("inf", "-inf", "infinity", "-infinity", "nan") }
                ?.let { CoercionResult.Ok(Value.Float(it)) }
                ?: CoercionResult.Err("expected a float, got ${raw.debug()}")
        VarType.BOOL ->
            parseBool(raw)
                ?.let { CoercionResult.Ok(Value.Bool(it)) }
                ?: CoercionResult.Err(
                    "expected a boolean (true/false/1/0/yes/no/on/off), got ${raw.debug()}",
                )
        VarType.PORT ->
            parsePort(raw)
                ?.let { CoercionResult.Ok(Value.Port(it)) }
                ?: CoercionResult.Err("expected a port in 1..=65535, got ${raw.debug()}")
        VarType.URL ->
            if (isUrl(raw)) {
                CoercionResult.Ok(Value.Url(raw))
            } else {
                CoercionResult.Err("expected a URL with scheme://authority, got ${raw.debug()}")
            }
        // Enum values are validated against `values` by the schema layer; here we
        // simply carry the string through.
        VarType.ENUM -> CoercionResult.Ok(Value.Str(raw))
        VarType.DURATION ->
            parseDuration(raw)
                ?.let { CoercionResult.Ok(Value.Dur(it)) }
                ?: CoercionResult.Err("expected a duration like 30s/5m/2h, got ${raw.debug()}")
    }

internal fun parseBool(raw: String): Boolean? =
    when (raw.trim().lowercase()) {
        "true", "1", "yes", "on" -> true
        "false", "0", "no", "off" -> false
        else -> null
    }

internal fun parsePort(raw: String): kotlin.Int? {
    val n = raw.trim().toLongOrNull() ?: return null
    return if (n in 1..65535) n.toInt() else null
}

/** Minimal, dependency-free URL shape check: `scheme://authority[...]`. */
internal fun isUrl(raw: String): Boolean {
    val s = raw.trim()
    val idx = s.indexOf("://")
    if (idx < 0) return false
    val scheme = s.substring(0, idx)
    val rest = s.substring(idx + 3)
    if (scheme.isEmpty()) return false
    if (!scheme.all { it.isAsciiAlphanumeric() || it == '+' || it == '-' || it == '.' }) return false
    if (!scheme.first().isAsciiAlphabetic()) return false
    // Authority must be non-empty and not start with a path/query separator.
    val authority = rest.takeWhile { it != '/' && it != '?' && it != '#' }
    return authority.isNotEmpty()
}

/**
 * Parse a human duration. Supported suffixes: `ms`, `s`, `m`, `h`, `d`.
 * A bare number is interpreted as seconds.
 */
internal fun parseDuration(raw: String): Duration? {
    val s = raw.trim()
    if (s.isEmpty()) return null
    val (num, multMs: Double) =
        when {
            s.endsWith("ms") -> s.dropLast(2) to 1.0
            s.endsWith("s") -> s.dropLast(1) to 1_000.0
            s.endsWith("m") -> s.dropLast(1) to 60_000.0
            s.endsWith("h") -> s.dropLast(1) to 3_600_000.0
            s.endsWith("d") -> s.dropLast(1) to 86_400_000.0
            else -> s to 1_000.0
        }
    val value = num.trim().toDoubleOrNull() ?: return null
    if (value < 0.0 || !value.isFinite()) return null
    return (value * multMs).milliseconds
}

private fun Char.isAsciiAlphanumeric(): Boolean = this in '0'..'9' || this in 'a'..'z' || this in 'A'..'Z'

private fun Char.isAsciiAlphabetic(): Boolean = this in 'a'..'z' || this in 'A'..'Z'

/** Mirror Rust's `{:?}` quoting for strings used in error messages. */
internal fun String.debug(): String =
    buildString {
        append('"')
        for (c in this@debug) {
            when (c) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\t' -> append("\\t")
                '\r' -> append("\\r")
                else -> append(c)
            }
        }
        append('"')
    }
