package kz.studenthub.app.core.realtime

import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

/**
 * Соединение с сервером реального времени. Интерфейс нужен не ради абстракции: без него
 * логику догона и записи событий в базу пришлось бы проверять живым сокетом.
 */
interface RealtimeTransport {
    val events: SharedFlow<RealtimeEvent>

    fun connect(token: String)

    fun disconnect()

    /**
     * Свежий токен. Уходит и в живое соединение (`auth:refresh`), и в рукопожатие
     * следующих переподключений — иначе через 15 минут они пойдут с протухшим.
     */
    fun refresh(token: String)

    fun join(chatId: String)

    fun leave(chatId: String)

    /** «Прочитано до этого сообщения». */
    fun markRead(chatId: String, messageId: String)

    /** Что человек делает сейчас; `null` — закончил. */
    fun send(action: String?, chatId: String)
}

/**
 * Реализация на socket.io-client-java — единственное место, которое знает про библиотеку.
 * Сокет живёт на корне домена, а не под префиксом API: путь `/socket.io` задаёт сервер.
 */
class SocketIoTransport(apiBaseUrl: String) : RealtimeTransport {
    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 256, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    override val events: SharedFlow<RealtimeEvent> = _events

    /** Одна и та же карта уходит в каждое рукопожатие — её и обновляем. */
    private val auth = ConcurrentHashMap<String, String>()
    private val origin: URI = apiBaseUrl.toHttpUrl().let { URI("${it.scheme}://${it.host}:${it.port}") }
    private var socket: Socket? = null

    @Synchronized
    override fun connect(token: String) {
        auth["token"] = token
        val existing = socket
        if (existing != null) {
            if (!existing.connected()) existing.connect()
            return
        }
        val options = IO.Options.builder()
            .setTransports(arrayOf(WebSocket.NAME))
            .setReconnection(true)
            .setAuth(auth)
            .build()
        val created = IO.socket(origin, options)
        created.on(Socket.EVENT_CONNECT) { _events.tryEmit(RealtimeEvent.Connected) }
        created.on(Socket.EVENT_DISCONNECT) { _events.tryEmit(RealtimeEvent.Disconnected) }
        created.on(Socket.EVENT_CONNECT_ERROR) { _events.tryEmit(RealtimeEvent.ConnectFailed) }
        for (name in RealtimeEvent.Names.incoming) {
            created.on(name) { args ->
                val raw = args.firstOrNull()?.toString() ?: return@on
                RealtimeEvent.parse(name, raw)?.let(_events::tryEmit)
            }
        }
        socket = created
        created.connect()
    }

    @Synchronized
    override fun disconnect() {
        socket?.off()
        socket?.disconnect()
        socket = null
    }

    override fun refresh(token: String) {
        auth["token"] = token
        emit(RealtimeEvent.Names.AUTH_REFRESH, "token" to token)
    }

    override fun join(chatId: String) = emit(RealtimeEvent.Names.JOIN, "chatId" to chatId)

    override fun leave(chatId: String) = emit(RealtimeEvent.Names.LEAVE, "chatId" to chatId)

    override fun markRead(chatId: String, messageId: String) =
        emit(RealtimeEvent.Names.READ, "chatId" to chatId, "messageId" to messageId)

    override fun send(action: String?, chatId: String) =
        emit(RealtimeEvent.Names.ACTION, "chatId" to chatId, "action" to (action ?: JSONObject.NULL))

    private fun emit(name: String, vararg fields: Pair<String, Any>) {
        val current = socket ?: return
        if (!current.connected()) return
        current.emit(name, JSONObject().apply { fields.forEach { (key, value) -> put(key, value) } })
    }
}
