package kz.studenthub.app.core.session

import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.Endpoint
import kotlinx.serialization.Serializable

/**
 * Ответ входа и обновления сессии. Только access-токен: refresh сервер в теле не отдаёт
 * никогда (`BACKEND_RULES §18.6`), его транспорт — httpOnly-cookie.
 */
@Serializable
data class AuthSession(val accessToken: String)

/**
 * Чем кончился первый шаг входа. Два исхода одного эндпоинта разведены типом, чтобы
 * экран был обязан обработать оба.
 */
sealed interface LoginOutcome {
    data class Session(val session: AuthSession) : LoginOutcome

    data class TwoFactorRequired(val challengeToken: String) : LoginOutcome
}

/** Продление и конец сессии — то, что нужно хранилищу. */
interface SessionRefreshing {
    suspend fun refresh(): AuthSession

    suspend fun endSession()
}

/** Выдача сессии: оба шага входа — то, что нужно экрану. */
interface SessionIssuing {
    suspend fun signIn(identifier: String, password: String): LoginOutcome

    suspend fun verifyTwoFactor(challengeToken: String, code: String): AuthSession
}

/**
 * Маршруты сессии. Все публичные: токена на руках как раз нет. Клиент — без провайдера
 * авторизации, иначе обновление сессии попыталось бы получить токен у того, кто его
 * и обновляет.
 */
class AuthApi(private val client: ApiClient) : SessionRefreshing, SessionIssuing {

    /**
     * Первый шаг. Идентификатор — почта ИЛИ имя пользователя: сервер принимает оба в
     * одном поле (`LoginSchema`).
     */
    override suspend fun signIn(identifier: String, password: String): LoginOutcome {
        val response = client.send(
            Endpoint.post("auth/login", LoginRequest.serializer(), LoginRequest(identifier, password)).publicRoute(),
            LoginResponse.serializer(),
        )
        val challenge = response.challengeToken
        if (response.twoFactorRequired == true && challenge != null) {
            return LoginOutcome.TwoFactorRequired(challenge)
        }
        // Ни токена, ни challenge'а — продолжать не с чем, и молчать нельзя: экран застынет.
        val token = response.accessToken ?: throw ApiError.Malformed(200)
        return LoginOutcome.Session(AuthSession(token))
    }

    /** Второй шаг: шесть цифр из приложения-аутентификатора или резервный код. */
    override suspend fun verifyTwoFactor(challengeToken: String, code: String): AuthSession =
        client.send(
            Endpoint.post("auth/login/2fa", TwoFactorRequest.serializer(), TwoFactorRequest(challengeToken, code))
                .publicRoute(),
            AuthSession.serializer(),
        )

    /** Запрос уходит пустым: сессию опознаёт refresh-cookie, которую подставляет OkHttp. */
    override suspend fun refresh(): AuthSession =
        client.send(Endpoint.post("auth/refresh").publicRoute(), AuthSession.serializer())

    override suspend fun endSession() {
        client.send(Endpoint.post("auth/logout").publicRoute())
    }

    @Serializable
    private data class LoginRequest(val identifier: String, val password: String)

    @Serializable
    private data class TwoFactorRequest(val challengeToken: String, val code: String)

    /** Оба исхода первого шага в одной записи: какие поля придут, решает сервер. */
    @Serializable
    private data class LoginResponse(
        val accessToken: String? = null,
        val twoFactorRequired: Boolean? = null,
        val challengeToken: String? = null,
    )
}
