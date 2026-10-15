// AGP 9 тянет Kotlin Gradle plugin 2.2.10 сам. Версия из каталога его поднимает —
// так компилятор Kotlin и плагин Compose остаются одной версии.
buildscript {
    repositories {
        mavenCentral()
    }
    dependencies {
        classpath(libs.kotlin.gradle.plugin)
    }
}

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
