package kz.studenthub.app.features

import kotlinx.coroutines.test.runTest
import kz.studenthub.app.R
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.ApiErrorCode
import kz.studenthub.app.core.session.AuthSession
import kz.studenthub.app.core.session.LoginOutcome
import kz.studenthub.app.core.session.SessionIssuing
import kz.studenthub.app.core.ui.UiText
import kz.studenthub.app.features.auth.LoginModel
import kz.studenthub.app.support.LONG_LIVED_TOKEN
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LoginModelTest {
    /** Обычный вход без второго фактора: сессия открыта, пароль в форме не остался. */
    @Test
    fun successfulSignInOpensSession() = runTest {
        val adopted = mutableListOf<AuthSession>()
        val model = LoginModel(StubIssuer(), { adopted += it; true })
        model.identifier = "student@uni.kz"
        model.password = "secret"

        model.signIn()

        assertEquals(1, adopted.size)
        assertEquals("", model.password)
    }

    /** Пустую форму в сеть не отправляем: лимит входа общий, пять попыток за 15 минут. */
    @Test
    fun emptyFormDoesNotReachNetwork() = runTest {
        val issuer = StubIssuer()
        val model = LoginModel(issuer, { true })

        model.signIn()

        assertEquals(0, issuer.calls)
        assertEquals(UiText.Res(R.string.auth_error_identifierRequired), model.identifierError)
        assertEquals(UiText.Res(R.string.auth_error_passwordRequired), model.passwordError)
    }

    @Test
    fun twoFactorChallengeMovesToSecondStep() = runTest {
        val model = LoginModel(StubIssuer(challenge = "ch-1"), { true })
        model.identifier = "u"
        model.password = "p"

        model.signIn()

        assertEquals(LoginModel.Step.TWO_FACTOR, model.step)
    }

    /** Код проверяется challenge'ем первого шага, а не паролем заново. */
    @Test
    fun verifiedCodeOpensSession() = runTest {
        val issuer = StubIssuer(challenge = "ch-1")
        var adopted = false
        val model = LoginModel(issuer, { adopted = true; true })
        model.identifier = "u"
        model.password = "p"
        model.signIn()
        model.code = "123456"

        model.verifyTwoFactor()

        assertEquals("ch-1", issuer.verifiedChallenge)
        assertEquals(true, adopted)
        assertEquals(LoginModel.Step.CREDENTIALS, model.step)
    }

    /** Ошибка про код — под полем кода, а не над формой (§10.3). */
    @Test
    fun wrongCodeIsShownUnderTheField() = runTest {
        val issuer = StubIssuer(
            challenge = "ch-1",
            verifyFailure = ApiError.Server(ApiErrorCode.INVALID_2FA_CODE, "Неверный код", emptyList(), 401),
        )
        val model = LoginModel(issuer, { true })
        model.identifier = "u"
        model.password = "p"
        model.signIn()
        model.code = "000000"

        model.verifyTwoFactor()

        assertEquals(UiText.Res(R.string.error_invalid2fa), model.codeError)
        assertNull(model.formError)
    }

    /** Блокировка — про учётную запись, а не про поле: сообщению место над формой. */
    @Test
    fun lockedAccountIsShownAboveTheForm() = runTest {
        val issuer = StubIssuer(
            signInFailure = ApiError.Server(ApiErrorCode.LOGIN_LOCKED, "Вход заблокирован на 15 минут", emptyList(), 429),
        )
        val model = LoginModel(issuer, { true })
        model.identifier = "u"
        model.password = "p"

        model.signIn()

        assertEquals(UiText.Res(R.string.error_loginLocked), model.formError)
    }

    /** 401 на входе — неверная пара, а не «сессия истекла»; текст на языке приложения, а не сервера. */
    @Test
    fun wrongPasswordIsLocalised() = runTest {
        val issuer = StubIssuer(
            signInFailure = ApiError.Server(ApiErrorCode.UNAUTHORIZED, "Неверный email или пароль", emptyList(), 401),
        )
        val model = LoginModel(issuer, { true })
        model.identifier = "u"
        model.password = "p"

        model.signIn()

        assertEquals(UiText.Res(R.string.auth_error_invalidCredentials), model.formError)
    }

    /** Возврат с шага кода выбрасывает challenge: он одноразовый. */
    @Test
    fun startOverForgetsChallenge() = runTest {
        val issuer = StubIssuer(challenge = "ch-1")
        val model = LoginModel(issuer, { true })
        model.identifier = "u"
        model.password = "p"
        model.signIn()

        model.startOver()
        model.code = "123456"
        model.verifyTwoFactor()

        assertEquals(LoginModel.Step.CREDENTIALS, model.step)
        assertNull(issuer.verifiedChallenge)
    }

    private class StubIssuer(
        private val challenge: String? = null,
        private val signInFailure: ApiError? = null,
        private val verifyFailure: ApiError? = null,
    ) : SessionIssuing {
        var calls = 0
        var verifiedChallenge: String? = null

        override suspend fun signIn(identifier: String, password: String): LoginOutcome {
            calls++
            signInFailure?.let { throw it }
            return challenge?.let { LoginOutcome.TwoFactorRequired(it) } ?: LoginOutcome.Session(AuthSession(LONG_LIVED_TOKEN))
        }

        override suspend fun verifyTwoFactor(challengeToken: String, code: String): AuthSession {
            verifyFailure?.let { throw it }
            verifiedChallenge = challengeToken
            return AuthSession(LONG_LIVED_TOKEN)
        }
    }
}
