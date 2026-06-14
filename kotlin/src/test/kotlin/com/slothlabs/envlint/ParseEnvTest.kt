package com.slothlabs.envlint

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ParseEnvTest {
    @Test
    fun parsesBasicAssignments() {
        val entries = parseEnv("FOO=bar\nexport BAZ=qux\n# comment\n\nN=1")
        assertEquals(3, entries.size)
        assertEquals(EnvEntry("FOO", "bar", 1), entries[0])
        assertEquals("BAZ", entries[1].key)
        assertEquals(5, entries[2].line) // comment + blank lines skipped
    }

    @Test
    fun handlesQuotesAndComments() {
        val entries =
            parseEnv(
                """
                A="hello world"
                B='raw ${'$'}VALUE'
                C=plain # trailing
                D="line\nbreak"
                """.trimIndent(),
            )
        assertEquals("hello world", entries[0].value)
        assertEquals("raw \$VALUE", entries[1].value)
        assertEquals("plain", entries[2].value)
        assertEquals("line\nbreak", entries[3].value)
    }

    @Test
    fun rejectsMalformed() {
        assertFailsWith<EnvParseException> { parseEnv("NOEQUALS") }
        assertFailsWith<EnvParseException> { parseEnv("1BAD=x") }
        assertFailsWith<EnvParseException> { parseEnv("A=\"unterminated") }
    }

    @Test
    fun malformedReportsLineNumber() {
        val e = assertFailsWith<EnvParseException> { envFromDotenv("OK=1\nBROKEN") }
        assertEquals(2, e.line)
    }

    @Test
    fun lastAssignmentWins() {
        val env = envFromDotenv("X=1\nX=2")
        assertEquals("2", env["X"])
    }
}
