// swift-tools-version: 6.0

// Сборка без Mac — через xtool из Linux/WSL (`scripts/build.sh` сам выбирает путь).
// Основная сборка — project.yml + Xcode (XcodeGen), этот манифест её не трогает.
// Внешних зависимостей нет намеренно: всё на UIKit, AVFoundation и Core Animation.
import PackageDescription

let package = Package(
    name: "ChatLab",
    platforms: [.iOS("26.0"), .macOS(.v15)],
    products: [
        // xtool собирает приложение из единственного library-продукта.
        .library(name: "ChatLab", targets: ["ChatLab"]),
    ],
    targets: [
        .target(
            name: "ChatLab",
            path: "Sources",
            linkerSettings: [
                // Версия SDK в заголовке бинарника: без неё iOS 26 запускает приложение
                // в режиме совместимости, без Liquid Glass (как в apps/ios).
                .unsafeFlags(["-Xlinker", "-platform_version", "-Xlinker", "ios", "-Xlinker", "26.0", "-Xlinker", "26.0"]),
            ]
        ),
        // Тесты здесь не объявлены: их запускает Xcode (project.yml, scripts/test.sh), а
        // компиляцию из Linux проверяет `scripts/build.sh --tests`.
    ],
    swiftLanguageModes: [.v5]
)
