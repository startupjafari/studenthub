package kz.studenthub.app.shell

import android.content.Context
import kz.studenthub.app.BuildConfig
import kz.studenthub.app.core.navigation.AppRouter
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.session.AuthApi
import kz.studenthub.app.core.session.KeystoreSecretStore
import kz.studenthub.app.core.session.QrLoginApi
import kz.studenthub.app.core.session.RefreshCookieJar
import kz.studenthub.app.core.session.SessionStore
import kz.studenthub.app.core.version.ClientVersionApi
import kz.studenthub.app.core.version.PrefsClientVersionCache
import kz.studenthub.app.features.update.UpdateGateModel
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kz.studenthub.app.core.observability.Observability
import kz.studenthub.app.core.session.AccessToken
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Сборка зависимостей приложения в одном месте — как `AppServices` в iOS.
 *
 * Без фреймворка внедрения: граф небольшой и строится один раз на процесс, а Hilt
 * принёс бы кодогенерацию ради десятка конструкторов. Порядок здесь не случайный:
 * клиент API спрашивает токен у хранилища сессии, а хранилище обновляет сессию через
 * собственный клиент без авторизации. Дай ему общий — обновление уйдёт в рекурсию.
 */
class AppServices(context: Context) {
    private val appContext = context.applicationContext

    /** Значение `X-Client-Version`: по нему сервер отличает сборки в логах. */
    val clientVersion = "android/${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"

    val cookies = RefreshCookieJar(BuildConfig.API_BASE_URL)

    /** Один клиент на процесс: общий пул соединений и одна банка cookie. */
    val http: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookies)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /** Клиент без авторизации: вход, обновление сессии, версия. */
    val publicApi = ApiClient(BuildConfig.API_BASE_URL, http, clientVersion)

    val auth = AuthApi(publicApi)
    val session = SessionStore(auth, KeystoreSecretStore(appContext), cookies)
    val api: ApiClient = publicApi.withAuthorization(session)

    /** Подтверждение входа по QR — наоборот, только с авторизацией. */
    val qrLogin = QrLoginApi(api)

    /** Навигация общая: по нажатию на уведомление переход делает не экран. */
    val router = AppRouter()

    val updateGate = UpdateGateModel(
        api = ClientVersionApi(publicApi),
        cache = PrefsClientVersionCache(appContext),
        currentVersion = BuildConfig.VERSION_NAME,
    )

    val sessionModel = AppSessionModel(this)

    val observability = Observability()

    /**
     * Ссылка, которую ещё не открыли: пришла до входа или до того, как оболочка
     * появилась на экране. Оболочка забирает её, как только может.
     */
    var pendingLink: String? by mutableStateOf(null)

    /** Человек вошёл и оболочка на экране: поднять то, что живёт вместе с сессией. */
    suspend fun onSignedIn(viewer: AccessToken) {
        observability.identify(viewer.subject)
    }

    /**
     * Что сделать перед выходом из аккаунта, пока токен ещё жив: следующему человеку на
     * этом телефоне не должны прилетать чужие сообщения и уведомления.
     */
    suspend fun beforeSignOut() {}
}
