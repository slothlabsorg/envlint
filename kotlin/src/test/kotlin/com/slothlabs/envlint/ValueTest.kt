package com.slothlabs.envlint

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

private fun ok(r: CoercionResult): Value = (r as CoercionResult.Ok).value

private fun isErr(r: CoercionResult): Boolean = r is CoercionResult.Err

class ValueTest {
    @Test
    fun coercesScalars() {
        assertEquals(Value.Int(42), ok(coerce("42", VarType.INT)))
        assertEquals(Value.Float(3.5), ok(coerce("3.5", VarType.FLOAT)))
        assertEquals(Value.Bool(true), ok(coerce("YES", VarType.BOOL)))
        assertEquals(Value.Bool(false), ok(coerce("off", VarType.BOOL)))
        assertEquals(Value.Port(8080), ok(coerce("8080", VarType.PORT)))
    }

    @Test
    fun rejectsBadScalars() {
        assertTrue(isErr(coerce("not-int", VarType.INT)))
        assertTrue(isErr(coerce("0", VarType.PORT)))
        assertTrue(isErr(coerce("70000", VarType.PORT)))
        assertTrue(isErr(coerce("maybe", VarType.BOOL)))
    }

    @Test
    fun urlShape() {
        assertTrue(isUrl("https://example.com"))
        assertTrue(isUrl("postgres://user:pass@db:5432/app"))
        assertTrue(!isUrl("example.com"))
        assertTrue(!isUrl("://nohost"))
        assertTrue(!isUrl("1http://x"))
        assertTrue(!isUrl("http:///path"))
    }

    @Test
    fun durations() {
        assertEquals(500.milliseconds, parseDuration("500ms"))
        assertEquals(30.seconds, parseDuration("30s"))
        assertEquals(300.seconds, parseDuration("5m"))
        assertEquals(7200.seconds, parseDuration("2h"))
        assertEquals(86_400.seconds, parseDuration("1d"))
        assertEquals(10.seconds, parseDuration("10"))
        assertEquals(null, parseDuration("-1s"))
        assertEquals(null, parseDuration("abc"))
    }

    @Test
    fun durationValueDisplaysAsMillis() {
        assertEquals("30000ms", Value.Dur(30.seconds).toString())
    }
}
