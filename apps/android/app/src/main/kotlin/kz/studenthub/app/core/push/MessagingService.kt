package kz.studenthub.app.core.push

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kz.studenthub.app.MainActivity
import kz.studenthub.app.R
import kz.studenthub.app.StudentHubApplication
import kz.studenthub.app.core.navigation.DeepLink
import kotlin.random.Random

/**
 * Приём FCM. Сервер шлёт data-сообщения (план, Задача АБ1): плашку собирает приложение —
 * свой канал, переход по ссылке и ответ прямо из уведомления.
 */
class MessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val services get() = (application as StudentHubApplication).services

    override fun onNewToken(token: String) {
        // Токен сменился — сервер узнаёт сразу, а не на следующем запуске.
        if (services.session.hasStoredSession) scope.launch { services.push.register(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val silent = data["silent"] == "1"
        services.observability.pushDelivered(silent)
        // Тихий — повод сходить за данными, а не показать плашку.
        scope.launch { services.pushSync.catchUp() }
        if (silent) return
        show(
            this,
            title = data["title"].orEmpty(),
            body = data["body"].orEmpty(),
            url = data["url"],
            badge = data["badge"]?.toIntOrNull(),
            tag = data["tag"],
        )
    }

    companion object {
        const val REPLY_KEY = "reply"

        fun show(context: Context, title: String, body: String, url: String?, badge: Int?, tag: String?) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
                android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU
            ) {
                return
            }
            // Заменяют друг друга только уведомления одного источника — ключ группы `tag`
            // от сервера (чат, обсуждение поста): новое сообщение чата встаёт на место
            // прошлого. Без ключа каждое уведомление своё: две готовые справки по одной
            // ссылке на «Документы» — это две новости, а не одна.
            val id = tag?.hashCode() ?: Random.nextInt()
            val open = PendingIntent.getActivity(
                context,
                id,
                Intent(context, MainActivity::class.java)
                    .putExtra(MainActivity.EXTRA_LINK, url)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val builder = NotificationCompat.Builder(context, NotificationChannels.forLink(url))
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(open)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
            badge?.let(builder::setNumber)

            // Ответ из уведомления — только для чата: в объявлении отвечать некому.
            val chat = url?.let(DeepLink::parse) as? DeepLink.Chat
            if (chat != null) {
                val reply = PendingIntent.getBroadcast(
                    context,
                    id,
                    Intent(context, ReplyReceiver::class.java)
                        .putExtra(ReplyReceiver.EXTRA_CHAT, chat.id)
                        .putExtra(ReplyReceiver.EXTRA_NOTIFICATION, id),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                val input = RemoteInput.Builder(REPLY_KEY).setLabel(context.getString(R.string.chats_placeholder)).build()
                builder.addAction(
                    NotificationCompat.Action.Builder(R.drawable.ic_notification, context.getString(R.string.chats_reply), reply)
                        .addRemoteInput(input)
                        .setAllowGeneratedReplies(true)
                        .build(),
                )
            }
            runCatching { NotificationManagerCompat.from(context).notify(id, builder.build()) }
        }
    }
}

/**
 * Ответ из уведомления. Уходит через ту же очередь, что и из чата: сообщение ляжет в
 * базу сразу, а не дошедшее досылается, когда появится сеть.
 */
class ReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(MessagingService.REPLY_KEY)?.toString()?.trim()
        val chatId = intent.getStringExtra(EXTRA_CHAT)
        if (text.isNullOrEmpty() || chatId == null) return
        val services = (context.applicationContext as StudentHubApplication).services
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val viewer = services.session.restoredToken()
                if (viewer != null) services.outbox.send(text, chatId, viewer.subject, replyToId = null)
                NotificationManagerCompat.from(context).cancel(intent.getIntExtra(EXTRA_NOTIFICATION, 0))
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val EXTRA_CHAT = "chat"
        const val EXTRA_NOTIFICATION = "notification"
    }
}
