package kz.studenthub.app

import android.app.Application
import kz.studenthub.app.shell.AppServices

/** Процесс приложения: здесь один раз собирается граф зависимостей. */
class StudentHubApplication : Application() {
    lateinit var services: AppServices
        private set

    override fun onCreate() {
        super.onCreate()
        services = AppServices(this)
    }
}
