plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.room)
}

// Адрес API для отладки. По умолчанию — `pnpm dev` на машине разработчика, каким его
// видит эмулятор (10.0.2.2 — это localhost хоста). Для телефона по USB или Wi-Fi
// адрес переопределяется в ~/.gradle/gradle.properties: studenthub.apiBaseUrl=...
val debugApiBaseUrl = providers.gradleProperty("studenthub.apiBaseUrl")
    .orElse("http://10.0.2.2:3001/api/v1")

// Firebase — только для доставки пушей (FCM). Без плагина google-services: параметры
// проекта приходят из ~/.gradle/gradle.properties или переменных CI, а не из файла в
// репозитории. Не заданы — приложение собирается и работает, просто без пушей.
fun firebase(name: String) = providers.gradleProperty("studenthub.firebase.$name").orElse("").get()

// Ключ загрузки для Google Play. Приходит только из окружения — секретов CI или
// терминала человека; без него релизная сборка собирается неподписанной.
val releaseKeystore = providers.environmentVariable("ANDROID_KEYSTORE_PATH")

android {
    namespace = "kz.studenthub.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "kz.studenthub.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${firebase("projectId")}\"")
        buildConfigField("String", "FIREBASE_APP_ID", "\"${firebase("appId")}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${firebase("apiKey")}\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"${firebase("senderId")}\"")
    }

    signingConfigs {
        create("release") {
            if (releaseKeystore.isPresent) {
                storeFile = file(releaseKeystore.get())
                storePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
                keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
                keyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            buildConfigField("String", "API_BASE_URL", "\"${debugApiBaseUrl.get()}\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // TODO(человек): подставить домен API из Railway (docs/RAILWAY.md) до первой
            // сборки для Google Play. Заглушка намеренная, как в iOS: релиз с ней ходит в
            // никуда, и адрес нельзя забыть.
            buildConfigField("String", "API_BASE_URL", "\"https://api.example.invalid/api/v1\"")
            if (releaseKeystore.isPresent) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        // Казахский переведён не целиком (как и в iOS): недостающие строки показываются
        // по-русски. Видно в отчёте, но сборку не валит.
        warning += "MissingTranslation"
    }

    testOptions {
        // android.* в unit-тестах отдаёт значения по умолчанию, а не падает: модели
        // экранов трогают Log и Uri мимоходом, и ради этого не нужен Robolectric.
        unitTests.isReturnDefaultValues = true
    }
}

// Схема базы каждой версии лежит в git: по ней пишутся и проверяются миграции. Старая
// сборка живёт на устройстве месяцами, и база, которой код не понимает, — это падение.
room {
    schemaDirectory("$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    // Сканер QR из Google Play services: камера, разрешение и интерфейс — их, а не
    // наши. Без сервисов Google (Huawei) вход по QR недоступен, остальное работает.
    implementation(libs.play.services.code.scanner)

    implementation(libs.androidx.room.runtime)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.work.runtime)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    // org.json уже есть в Android — копия из Maven Central конфликтует с системной.
    implementation(libs.socket.io.client) {
        exclude(group = "org.json", module = "json")
    }
    // Только доставка пушей: ни Analytics, ни Crashlytics — минимум данных в Google.
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    // Настоящий SQLite в unit-тестах: запросы базы проверяются на JVM, без эмулятора.
    testImplementation(libs.androidx.sqlite.bundled.jvm)
}
