package kz.studenthub.app.core.observability

import android.os.SystemClock
import android.util.Log

/**
 * Наблюдаемость приложения: падает ли сборка, за сколько человек видит первый экран и
 * доходят ли пуши — те же три вопроса, что в iOS (`Observability.swift`).
 *
 * Здесь — точки замера; трекер (Sentry) подключается в Ф5, и до этого события только
 * пишутся в системный журнал отладочной сборки.
 */
open class Observability {
    private var launchStartedAt: Long? = SystemClock.elapsedRealtime()

    /** Первый экран показан. Меряем от старта процесса: важно время до содержимого. */
    fun launchFinished(userId: String?) {
        identify(userId)
        val started = launchStartedAt ?: return
        launchStartedAt = null
        breadcrumb("launch", mapOf("seconds" to "%.2f".format((SystemClock.elapsedRealtime() - started) / 1000.0)))
    }

    /** Кто сейчас в приложении — только id, как и на сервере. */
    open fun identify(userId: String?) {}

    /** Пуш дошёл до устройства. Доставку FCM не гарантирует — считаем на обоих концах. */
    fun pushDelivered(silent: Boolean) = breadcrumb("push", mapOf("silent" to if (silent) "1" else "0"))

    fun pushOpened() = breadcrumb("push", mapOf("action" to "opened"))

    protected open fun breadcrumb(category: String, data: Map<String, String>) {
        Log.d("StudentHub", "$category $data")
    }
}
