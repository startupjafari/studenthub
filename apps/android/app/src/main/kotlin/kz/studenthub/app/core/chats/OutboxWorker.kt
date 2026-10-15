package kz.studenthub.app.core.chats

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kz.studenthub.app.StudentHubApplication

/**
 * Досылка неотправленного, когда появится сеть. Человек нажал «отправить» в метро и
 * убрал телефон — сообщение уйдёт само, даже если приложение к тому моменту выгружено.
 */
class OutboxWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val services = (applicationContext as StudentHubApplication).services
        // Без сессии слать не от чьего имени: человек вышел — очередь стёрта вместе с базой.
        if (!services.session.hasStoredSession) return Result.success()
        return if (services.outbox.flush()) Result.success() else Result.retry()
    }

    companion object {
        private const val NAME = "outbox"

        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork(
                NAME,
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<OutboxWorker>()
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .build(),
            )
        }
    }
}
