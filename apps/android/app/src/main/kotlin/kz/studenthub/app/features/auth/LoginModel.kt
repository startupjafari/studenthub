package kz.studenthub.app.features.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kz.studenthub.app.R
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.ApiErrorCode
import kz.studenthub.app.core.session.AuthSession
import kz.studenthub.app.core.session.LoginOutcome
import kz.studenthub.app.core.session.SessionIssuing
import kz.studenthub.app.core.ui.UiText

/**
 * Состояние экрана входа.
 *
 * Два шага в одной модели, а не в двух: между ними переносится challenge. Поля
 * очищаются сразу после успеха — пароль и код не должны пережить вход даже в памяти.
 * `ViewModel` — чтобы поворот экрана не стирал набранное и не обрывал запрос.
 */
class LoginModel(
    private val auth: SessionIssuing,
    /** Принять выданную сессию; `false` — токен не разобрался. */
    private val adopt: (AuthSession) -> Boolean,
) : ViewModel() {
    enum class Step { CREDENTIALS, TWO_FACTOR }

    var identifier by mutableStateOf("")
    var password by mutableStateOf("")
    var code by mutableStateOf("")

    var step by mutableStateOf(Step.CREDENTIALS)
        private set
    var isBusy by mutableStateOf(false)
        private set

    /** Ошибка всей формы: неверная пара логин-пароль, блокировка, нет связи. */
    var formError by mutableStateOf<UiText?>(null)
        private set
    var identifierError by mutableStateOf<UiText?>(null)
        private set
    var passwordError by mutableStateOf<UiText?>(null)
        private set
    var codeError by mutableStateOf<UiText?>(null)
        private set

    private var challengeToken: String? = null

    fun submitCredentials() {
        viewModelScope.launch { signIn() }
    }

    fun submitCode() {
        viewModelScope.launch { verifyTwoFactor() }
    }

    /**
     * Первый шаг. Пустые поля ловим на клиенте: лимит входов на сервере общий — пять
     * попыток за 15 минут, и тратить их на заведомо негодный запрос незачем.
     */
    suspend fun signIn() {
        if (isBusy) return
        clearErrors()

        val login = identifier.trim()
        if (login.isEmpty()) identifierError = UiText.Res(R.string.auth_error_identifierRequired)
        if (password.isEmpty()) passwordError = UiText.Res(R.string.auth_error_passwordRequired)
        if (identifierError != null || passwordError != null) return

        isBusy = true
        try {
            when (val outcome = auth.signIn(login, password)) {
                is LoginOutcome.Session -> accept(outcome.session)
                is LoginOutcome.TwoFactorRequired -> {
                    challengeToken = outcome.challengeToken
                    code = ""
                    step = Step.TWO_FACTOR
                }
            }
        } catch (error: ApiError) {
            handle(error)
        } finally {
            isBusy = false
        }
    }

    /** Второй шаг: шесть цифр или резервный код — какой именно, сервер разберёт сам. */
    suspend fun verifyTwoFactor() {
        val challenge = challengeToken
        if (isBusy || challenge == null) return
        codeError = null
        formError = null

        val entered = code.trim()
        if (entered.length < 6) {
            codeError = UiText.Res(R.string.auth_error_codeTooShort)
            return
        }

        isBusy = true
        try {
            accept(auth.verifyTwoFactor(challenge, entered))
        } catch (error: ApiError) {
            handle(error)
        } finally {
            isBusy = false
        }
    }

    /** Назад к логину и паролю. Challenge одноразовый — возвращаться к нему нельзя. */
    fun startOver() {
        step = Step.CREDENTIALS
        challengeToken = null
        code = ""
        password = ""
        clearErrors()
    }

    private fun accept(session: AuthSession) {
        if (!adopt(session)) {
            formError = UiText.Res(R.string.error_unexpected)
            return
        }
        password = ""
        code = ""
        challengeToken = null
        step = Step.CREDENTIALS
    }

    /**
     * Куда попадает текст ошибки, решает её код: сообщение про код 2FA — под полем кода,
     * остальное — над формой (§10.3).
     */
    private fun handle(error: ApiError) {
        if (error !is ApiError.Server) {
            formError = error.displayMessage
            return
        }
        for (detail in error.details) {
            val message = UiText.Raw(detail.message)
            when (detail.field) {
                "identifier" -> identifierError = message
                "password" -> passwordError = message
                "code" -> codeError = message
                else -> formError = message
            }
        }
        if (error.details.isNotEmpty()) return

        if (error.code == ApiErrorCode.INVALID_2FA_CODE) {
            codeError = UiText.Raw(error.serverMessage)
        } else {
            formError = UiText.Raw(error.serverMessage)
        }
    }

    private fun clearErrors() {
        formError = null
        identifierError = null
        passwordError = null
        codeError = null
    }
}
