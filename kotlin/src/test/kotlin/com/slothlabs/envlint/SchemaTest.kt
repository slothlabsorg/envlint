package com.slothlabs.envlint

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private const val SCHEMA = """
    [vars.PORT]
    type = "port"
    default = "8080"

    [vars.LOG_LEVEL]
    type = "enum"
    values = ["debug", "info", "warn", "error"]
    default = "info"

    [vars.DATABASE_URL]
    type = "url"
    required = true

    [vars.API_KEY]
    type = "string"
    required = true
    secret = true
    pattern = "^sk-[A-Za-z0-9]{8,}${'$'}"

    [vars.WORKERS]
    type = "int"
    min = 1
    max = 64
    default = "4"
"""

class SchemaTest {
    @Test
    fun happyPathUsesDefaults() {
        val schema = Schema.fromTomlString(SCHEMA)
        val report =
            schema.validate(
                mapOf(
                    "DATABASE_URL" to "postgres://db:5432/app",
                    "API_KEY" to "sk-abcdef12",
                ),
            )
        assertFalse(report.hasErrors, "${report.issues}")
        assertEquals(5, report.resolved.size) // includes 3 defaults
    }

    @Test
    fun flagsMissingRequiredAndBadValues() {
        val schema = Schema.fromTomlString(SCHEMA)
        val report =
            schema.validate(
                mapOf(
                    "LOG_LEVEL" to "verbose",
                    "API_KEY" to "nope",
                    "WORKERS" to "999",
                ),
            )
        assertTrue(report.hasErrors)
        val vars = report.errors.map { it.variable }
        assertTrue("DATABASE_URL" in vars) // required, missing
        assertTrue("LOG_LEVEL" in vars) // not in enum
        assertTrue("API_KEY" in vars) // pattern mismatch
        assertTrue("WORKERS" in vars) // above max
    }

    @Test
    fun undeclaredVarIsWarningThenErrorInStrict() {
        val schema = Schema.fromTomlString(SCHEMA)
        val env =
            mapOf(
                "DATABASE_URL" to "https://x.y",
                "API_KEY" to "sk-abcdef12",
                "MYSTERY" to "1",
            )
        val report = schema.validate(env)
        assertFalse(report.hasErrors)
        assertEquals(1, report.warnings.size)

        schema.strict = true
        val strictReport = schema.validate(env)
        assertTrue(strictReport.hasErrors)
    }

    @Test
    fun rejectsBadSchema() {
        assertFailsWith<SchemaException> {
            Schema.fromTomlString("[vars.X]\ntype=\"string\"\npattern=\"(\"")
        }
        assertFailsWith<SchemaException> {
            Schema.fromTomlString("[vars.X]\ntype=\"enum\"")
        }
    }

    @Test
    fun requiredButEmptyIsError() {
        val schema = Schema.fromTomlString(SCHEMA)
        val report =
            schema.validate(
                mapOf(
                    "DATABASE_URL" to "",
                    "API_KEY" to "sk-abcdef12",
                ),
            )
        assertTrue(report.hasErrors)
        assertTrue(report.errors.any { it.variable == "DATABASE_URL" && it.message.contains("empty") })
    }

    @Test
    fun minBoundIsEnforced() {
        val schema = Schema.fromTomlString(SCHEMA)
        val report =
            schema.validate(
                mapOf(
                    "DATABASE_URL" to "https://x.y",
                    "API_KEY" to "sk-abcdef12",
                    "WORKERS" to "0",
                ),
            )
        assertTrue(report.errors.any { it.variable == "WORKERS" && it.message.contains("below min") })
    }

    @Test
    fun acceptsFloatMinMaxLiteral() {
        val schema =
            Schema.fromTomlString(
                """
                [vars.RATE]
                type = "float"
                min = 0.5
                max = 1.5
                """.trimIndent(),
            )
        assertFalse(schema.validate(mapOf("RATE" to "1.0")).hasErrors)
        assertTrue(schema.validate(mapOf("RATE" to "0.1")).hasErrors)
    }

    @Test
    fun durationMinMaxComparesInSeconds() {
        val schema =
            Schema.fromTomlString(
                """
                [vars.TIMEOUT]
                type = "duration"
                min = 1
                max = 60
                """.trimIndent(),
            )
        assertFalse(schema.validate(mapOf("TIMEOUT" to "30s")).hasErrors)
        assertTrue(schema.validate(mapOf("TIMEOUT" to "500ms")).hasErrors) // 0.5s < 1
        assertTrue(schema.validate(mapOf("TIMEOUT" to "2m")).hasErrors) // 120s > 60
    }
}
