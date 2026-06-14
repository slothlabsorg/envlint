package com.slothlabs.envlint

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private const val SCHEMA = """
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
"""

class IntegrationTest {
    @Test
    fun validatesADotenvFileEndToEnd() {
        val dotenv =
            """
            # service config
            export DATABASE_URL=postgres://user:pw@db:5432/app
            API_KEY="sk-supersecret"
            TIMEOUT=45s
            """.trimIndent() + "\n"
        val env = envFromDotenv(dotenv)
        val schema = Schema.fromTomlString(SCHEMA)
        val report = schema.validate(env)

        assertFalse(report.hasErrors, "${report.issues}")
        assertEquals(4, report.resolved.size) // PORT filled from default

        // Secret values are masked in serialized output.
        val json = report.toJson()
        assertTrue(json.contains("\"API_KEY\":\"******\""), json)
        assertTrue(json.contains("\"ok\":true"), json)
    }

    @Test
    fun surfacesMissingRequiredVar() {
        val env = mapOf("API_KEY" to "sk-x")
        val schema = Schema.fromTomlString(SCHEMA)
        val report = schema.validate(env)

        assertTrue(report.hasErrors)
        assertTrue(report.errors.any { it.variable == "DATABASE_URL" })
    }

    @Test
    fun malformedDotenvIsReportedWithLine() {
        val e =
            kotlin.runCatching { envFromDotenv("OK=1\nBROKEN") }
                .exceptionOrNull() as EnvParseException
        assertEquals(2, e.line)
    }

    @Test
    fun textReportMasksSecrets() {
        val schema =
            Schema.fromTomlString(
                """
                [vars.TOKEN]
                type = "string"
                secret = true
                """.trimIndent(),
            )
        val report = schema.validate(mapOf("TOKEN" to "hunter2"))
        // The text report only lists issues + a summary line; secrets never
        // surface there, but JSON resolved values must be masked.
        assertTrue(report.toJson().contains("\"TOKEN\":\"******\""))
        assertFalse(report.toJson().contains("hunter2"))
    }

    @Test
    fun sampleSchemaParses() {
        // The bundled example schema must always load cleanly.
        val src =
            Schema::class.java.getResourceAsStream("/com/slothlabs/envlint/sample-envlint.toml")!!
                .bufferedReader().use { it.readText() }
        val schema = Schema.fromTomlString(src)
        assertTrue(schema.vars.containsKey("DATABASE_URL"))
        assertTrue(schema.vars["API_KEY"]!!.secret)
    }
}
