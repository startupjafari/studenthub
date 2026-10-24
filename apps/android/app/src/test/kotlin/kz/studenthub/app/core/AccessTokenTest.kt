package kz.studenthub.app.core

import kz.studenthub.app.core.model.Role
import kz.studenthub.app.core.session.AccessToken
import kz.studenthub.app.support.tokenWith
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Подпись не проверяется намеренно: ключ у сервера. Клиент читает payload только чтобы
 * знать срок жизни и не рисовать разделы, которых у роли нет. Тот же набор, что в iOS.
 */
class AccessTokenTest {
    /** Выдан на 15 минут, истёк 1790000900 (epoch). */
    private val studentToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0yMjIyLTMzMzMtNDQ0NC01NTU1NTU1NTU1NTUiLCJyb2xlIjoiU1RVREVOVCIsInVuaXZlcnNpdHlJZCI6InUtMSIsImZhY3VsdHlJZCI6ImYtMSIsImdyb3VwSWQiOiJnLTEiLCJ0ZmEiOmZhbHNlLCJpYXQiOjE3OTAwMDAwMDAsImV4cCI6MTc5MDAwMDkwMH0.signature-not-verified-on-client"

    @Test
    fun readsSubjectRoleAndScope() {
        val token = AccessToken.parse(studentToken)!!
        assertEquals("11111111-2222-3333-4444-555555555555", token.subject)
        assertEquals(Role.STUDENT, token.role)
        assertEquals("u-1", token.universityId)
        assertEquals("g-1", token.groupId)
        assertFalse(token.twoFactorEnabled)
        assertEquals(1_790_000_900L, token.expiresAt.epochSecond)
    }

    /** Обновляемся заранее: токен, которому осталась секунда, доедет уже просроченным. */
    @Test
    fun tokenIsNotUsableInsideRefreshMargin() {
        val token = AccessToken.parse(studentToken, receivedAt = Instant.ofEpochSecond(1_790_000_000))!!
        val expiry = token.expiresAt
        assertTrue(token.isUsable(expiry.minusSeconds(120)))
        assertFalse(token.isUsable(expiry.minusSeconds(10)))
        assertFalse(token.isUsable(expiry.plusSeconds(1)))
    }

    /**
     * Часы телефона ушли вперёд на час: срок считается по часам сервера (через `iat`),
     * и свежий токен не выглядит просроченным перед каждым запросом.
     */
    @Test
    fun phoneClockAheadDoesNotExpireFreshToken() {
        val phoneNow = Instant.ofEpochSecond(1_790_000_000 + 3_600)
        val token = AccessToken.parse(studentToken, receivedAt = phoneNow)!!
        assertEquals(-3_600L, token.clockSkewSeconds)
        assertTrue(token.isUsable(phoneNow.plusSeconds(60)))
        assertFalse(token.isUsable(phoneNow.plusSeconds(900)))
    }

    /** Роль, которой приложение ещё не знает, не должна ронять разбор токена. */
    @Test
    fun unknownRoleDoesNotBreakParsing() {
        val token = AccessToken.parse(
            tokenWith("""{"sub":"u","role":"CHANCELLOR","universityId":null,"facultyId":null,"groupId":null,"exp":4102444800}"""),
        )
        assertNotNull(token)
        assertEquals(Role.UNKNOWN, token!!.role)
        assertFalse(token.role.isSupportedOnPhone)
    }

    @Test
    fun malformedTokensAreRejected() {
        assertNull(AccessToken.parse("не-токен"))
        assertNull(AccessToken.parse("header.payload"))
        assertNull(AccessToken.parse("header.!!!не-base64!!!.signature"))
    }
}
