package kz.studenthub.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import kz.studenthub.app.designsystem.StudentHubTheme
import kz.studenthub.app.shell.LocalServices
import kz.studenthub.app.shell.RootScreen

/**
 * Единственная активность. Ссылки (`studenthub://…`, нажатие на уведомление) приходят
 * сюда и уходят в общую очередь: открыть их можно, только когда человек вошёл, а вход
 * может быть ещё впереди.
 */
class MainActivity : ComponentActivity() {
    private val services get() = (application as StudentHubApplication).services

    override fun onCreate(savedInstanceState: Bundle?) {
        // До super: окно сразу рисуется под системными панелями, без вспышки отступов.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Повторное создание после поворота несёт тот же intent — ссылку уже открыли.
        if (savedInstanceState == null) deliver(intent)
        setContent {
            CompositionLocalProvider(LocalServices provides services) {
                StudentHubTheme {
                    RootScreen()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        deliver(intent)
    }

    private fun deliver(intent: Intent?) {
        val link = intent?.getStringExtra(EXTRA_LINK) ?: intent?.dataString ?: return
        services.pendingLink = link
    }

    companion object {
        /** Ссылка из уведомления: пуш кладёт путь веба, а не адрес со схемой. */
        const val EXTRA_LINK = "kz.studenthub.app.LINK"
    }
}
