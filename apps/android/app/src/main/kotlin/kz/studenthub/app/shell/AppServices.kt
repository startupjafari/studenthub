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
import kz.studenthub.app.core.observability.SentryObservability
import kz.studenthub.app.core.session.AccessToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kz.studenthub.app.core.chats.AttachmentUploader
import kz.studenthub.app.core.chats.AttachmentUrls
import kz.studenthub.app.core.chats.ChatStore
import kz.studenthub.app.core.chats.ChatsApi
import kz.studenthub.app.core.chats.MessageOutbox
import kz.studenthub.app.core.chats.MessageStore
import kz.studenthub.app.core.chats.OutboxWorker
import kz.studenthub.app.core.push.NotificationChannels
import kz.studenthub.app.core.push.PushRegistrar
import kz.studenthub.app.core.push.PushSync
import kz.studenthub.app.core.realtime.RealtimeCoordinator
import kz.studenthub.app.core.realtime.SocketIoTransport
import kz.studenthub.app.core.storage.AppDatabase
import kz.studenthub.app.core.applications.ApplicationsApi
import kz.studenthub.app.core.feed.FeedApi
import kz.studenthub.app.core.library.LibraryApi
import kz.studenthub.app.core.study.StudyApi
import kz.studenthub.app.features.chats.outgoingDir
import androidx.core.app.NotificationManagerCompat
import coil3.SingletonImageLoader
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

    /**
     * Область жизни процесса: работа, которая не должна обрываться с уходом с экрана
     * (отправка, реальное время), живёт здесь, а не в экранах.
     */
    val appScope = MainScope()

    /** Локальная база — источник правды для экранов; миграции проходят до первого чтения. */
    val database: AppDatabase = AppDatabase.onDisk(appContext)

    /** Хранилище файлов отвечает по подписанной ссылке и не терпит заголовков API. */
    private val storageHttp: OkHttpClient = http.newBuilder().cookieJar(okhttp3.CookieJar.NO_COOKIES).build()

    val chatsApi = ChatsApi(api, storageHttp)
    val chatStore = ChatStore(database)
    val messageStore = MessageStore(database)
    val uploader = AttachmentUploader(database, chatsApi)
    val outbox = MessageOutbox(database, chatsApi, uploader, onStuck = { OutboxWorker.schedule(appContext) })

    /** Ссылки на вложения: кэш по id файла, а не по адресу. */
    val attachmentUrls = AttachmentUrls(chatsApi::attachmentUrl)

    /** Реальное время. Транспорт — единственное место, знающее про socket.io. */
    val realtime = RealtimeCoordinator(SocketIoTransport(BuildConfig.API_BASE_URL), session, database, appScope)

    val studyApi = StudyApi(api)
    val feedApi = FeedApi(api)
    val applicationsApi = ApplicationsApi(api)
    val libraryApi = LibraryApi(api)

    /** Картинки постов: ключ — «пост/файл», ссылка подписанная и короткоживущая. */
    val postMediaUrls = AttachmentUrls { key ->
        val (postId, fileId) = key.split('/', limit = 2)
        ChatsApi.AttachmentLink(feedApi.postMediaUrl(postId, fileId))
    }

    val push = PushRegistrar(appContext, api, clientVersion)
    val pushSync = PushSync(chatsApi, chatStore)

    /** Навигация общая: по нажатию на уведомление переход делает не экран. */
    val router = AppRouter()

    val updateGate = UpdateGateModel(
        api = ClientVersionApi(publicApi),
        cache = PrefsClientVersionCache(appContext),
        currentVersion = BuildConfig.VERSION_NAME,
    )

    val sessionModel = AppSessionModel(this)

    val observability: Observability = SentryObservability.start(appContext)

    /**
     * Ссылка, которую ещё не открыли: пришла до входа или до того, как оболочка
     * появилась на экране. Оболочка забирает её, как только может.
     */
    var pendingLink: String? by mutableStateOf(null)

    /** Человек вошёл и оболочка на экране: поднять то, что живёт вместе с сессией. */
    suspend fun onSignedIn(viewer: AccessToken) {
        observability.identify(viewer.subject)
        // Соединение живёт, пока человек внутри приложения: вход — его начало, выход — конец.
        realtime.start()
        push.register()
        // Неотправленное с прошлого раза уходит само, как только есть связь.
        OutboxWorker.schedule(appContext)
    }

    /**
     * Что сделать перед выходом из аккаунта, пока токен ещё жив: следующему человеку на
     * этом телефоне не должны прилетать чужие сообщения и уведомления.
     */
    suspend fun beforeSignOut() {
        // Сокет с погашенным токеном сервер всё равно отключит — рвём сами, без ошибки в логе.
        realtime.stop()
        push.unregister()
    }

    /**
     * После выхода: переписка, черновики и очередь отправки не достаются следующему
     * человеку. Как и плашки уведомлений, файлы, которые он отправлял, кэш картинок
     * переписки и подписанные ссылки на них.
     */
    suspend fun afterSignOut() {
        withContext(Dispatchers.IO) {
            database.clearAllTables()
            outgoingDir(appContext).deleteRecursively()
            SingletonImageLoader.get(appContext).let { loader ->
                loader.memoryCache?.clear()
                loader.diskCache?.clear()
            }
        }
        attachmentUrls.clear()
        postMediaUrls.clear()
        NotificationManagerCompat.from(appContext).cancelAll()
        router.reset()
    }

    init {
        NotificationChannels.register(appContext)
        // Отказ в продлении сессии ведёт на вход, откуда бы ни пришёл запрос: с экрана,
        // из сокета или из фоновой досылки сообщений.
        appScope.launch { session.expired.collect { sessionModel.sessionExpired() } }
    }
}
