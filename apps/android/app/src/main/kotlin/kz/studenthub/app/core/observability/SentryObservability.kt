package kz.studenthub.app.core.observability

import android.content.Context
import io.sentry.Breadcrumb
import io.sentry.Sentry
import io.sentry.SentryLevel
import io.sentry.android.core.SentryAndroid
import io.sentry.protocol.User
import kz.studenthub.app.BuildConfig

/**
 * Наблюдаемость через Sentry: падения, ANR, время до первого экрана и доставка пушей.
 *
 * Без DSN молчит, как и сервер: отладочные сборки не засоряют ленту issue. Персональных
 * данных в трекер не отправляем — наружу уходит только идентификатор (BACKEND_RULES §11.3).
 */
class SentryObservability private constructor() : Observability() {
    override fun identify(userId: String?) {
        Sentry.setUser(userId?.let { User().apply { id = it } })
    }

    override fun breadcrumb(category: String, data: Map<String, String>) {
        Sentry.addBreadcrumb(
            Breadcrumb().apply {
                this.category = category
                level = SentryLevel.INFO
                data.forEach { (key, value) -> setData(key, value) }
            },
        )
    }

    companion object {
        /** Поднять трекер, если для сборки задан DSN; иначе — журнал отладки. */
        fun start(context: Context): Observability {
            if (BuildConfig.SENTRY_DSN.isBlank()) return Observability()
            SentryAndroid.init(context) { options ->
                options.dsn = BuildConfig.SENTRY_DSN
                options.release = "android@${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"
                options.environment = if (BuildConfig.DEBUG) "development" else "production"
                options.isSendDefaultPii = false
                options.isAttachScreenshot = false
                options.isAttachViewHierarchy = false
                // ANR — зависание интерфейса дольше пяти секунд — главный провал Android.
                options.isAnrEnabled = true
                options.setBeforeSend { event, _ ->
                    event.user?.let {
                        it.email = null
                        it.username = null
                        it.ipAddress = null
                    }
                    event
                }
            }
            return SentryObservability()
        }
    }
}
