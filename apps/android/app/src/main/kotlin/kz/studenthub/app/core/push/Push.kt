package kz.studenthub.app.core.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.content.edit
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import kz.studenthub.app.BuildConfig
import kz.studenthub.app.R
import kz.studenthub.app.core.chats.ChatStore
import kz.studenthub.app.core.chats.ChatsApi
import kz.studenthub.app.core.chats.ChatsFetching
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.Endpoint
import kotlin.coroutines.resume

/**
 * Firebase поднимается вручную, из параметров сборки, а не плагином google-services:
 * конфигурация проекта не лежит в репозитории, а сборка без неё остаётся рабочей —
 * просто без пушей. Возвращает `false`, если пушей в этой сборке нет.
 */
object Firebase {
    fun start(context: Context): Boolean {
        if (BuildConfig.FIREBASE_APP_ID.isEmpty() || BuildConfig.FIREBASE_PROJECT_ID.isEmpty()) return false
        if (FirebaseApp.getApps(context).isEmpty()) {
            FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
            )
        }
        return true
    }
}

/**
 * Каналы уведомлений (Android 8+). Сообщения — отдельно от всего остального: человек
 * вправе заглушить объявления деканата, не теряя переписку.
 */
object NotificationChannels {
    const val MESSAGES = "messages"
    const val GENERAL = "general"

    fun register(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(MESSAGES, context.getString(R.string.push_channelMessages), NotificationManager.IMPORTANCE_HIGH),
                NotificationChannel(GENERAL, context.getString(R.string.push_channelGeneral), NotificationManager.IMPORTANCE_DEFAULT),
            ),
        )
    }

    /** В какой канал идёт пуш: сообщения узнаются по ссылке на чат. */
    fun forLink(url: String?): String = if (url?.contains("chats") == true) MESSAGES else GENERAL
}

/**
 * Регистрация устройства. Токен выдаёт Firebase и меняет при переустановке и очистке
 * данных, поэтому подтверждается на каждом запуске, а не однократно.
 */
class PushRegistrar(private val context: Context, private val client: ApiClient, private val clientVersion: String) {
    private val prefs = context.getSharedPreferences("push", Context.MODE_PRIVATE)

    /** Отдать серверу текущий токен. Отказ — не ошибка: приложение работает и без пушей. */
    suspend fun register() {
        if (!Firebase.start(context)) return
        val token = currentToken() ?: return
        register(token)
    }

    suspend fun register(token: String) {
        val sent = runCatching {
            client.send(Endpoint.post("push/devices", DeviceBody.serializer(), DeviceBody(token, "ANDROID", clientVersion)))
        }.isSuccess
        if (sent) prefs.edit { putString(KEY, token) }
    }

    /** Отвязать устройство при выходе: следующему человеку не должны прилетать чужие уведомления. */
    suspend fun unregister() {
        val token = prefs.getString(KEY, null) ?: return
        runCatching { client.send(Endpoint.post("push/devices/remove", RemoveBody.serializer(), RemoveBody(token))) }
        prefs.edit { remove(KEY) }
        // Новый токен у следующего человека — старый, привязанный к прежнему, умирает.
        // Ждём ответа Firebase: без сети гашение не пройдёт, и тогда его доделает
        // первый же пуш, пришедший без сессии (`forgetStaleToken`).
        forgetStaleToken()
    }

    /** Погасить токен устройства у Firebase: пуши по нему больше не доставляются. */
    suspend fun forgetStaleToken(): Boolean {
        if (!Firebase.start(context)) return false
        return suspendCancellableCoroutine { continuation ->
            runCatching {
                FirebaseMessaging.getInstance().deleteToken()
                    .addOnSuccessListener { continuation.resume(true) }
                    .addOnFailureListener { continuation.resume(false) }
            }.onFailure { continuation.resume(false) }
        }
    }

    private suspend fun currentToken(): String? = suspendCancellableCoroutine { continuation ->
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { continuation.resume(it) }
            .addOnFailureListener { continuation.resume(null) }
    }

    @Serializable
    private data class DeviceBody(val token: String, val platform: String, val appVersion: String)

    @Serializable
    private data class RemoveBody(val token: String)

    private companion object {
        const val KEY = "device-token"
    }
}

/**
 * Что делать по тихому пушу: догнать первую страницу списка чатов. Отдельный тип — у
 * фоновой доставки считаные секунды, и список действий должен быть виден целиком.
 */
class PushSync(private val api: ChatsFetching, private val store: ChatStore) {
    suspend fun catchUp(): Boolean = runCatching {
        store.saveChats(api.chats(cursor = null, limit = ChatsApi.PAGE_LIMIT).items)
    }.isSuccess
}
