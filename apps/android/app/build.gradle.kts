plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Адрес API для отладки. По умолчанию — `pnpm dev` на машине разработчика, каким его
// видит эмулятор (10.0.2.2 — это localhost хоста). Для телефона по USB или Wi-Fi
// адрес переопределяется в ~/.gradle/gradle.properties: studenthub.apiBaseUrl=...
val debugApiBaseUrl = providers.gradleProperty("studenthub.apiBaseUrl")
    .orElse("http://10.0.2.2:3001/api/v1")

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
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
}
