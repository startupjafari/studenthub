// swift-tools-version: 6.0

// Сборка на iPhone без Mac — через xtool из Linux или WSL (README, «Сборка на iPhone
// без Mac»). Основная сборка по-прежнему project.yml + Xcode, этот манифест её не трогает.
//
// Зависимости — те же, что в project.yml, кроме Sentry: в отладке DSN пуст и трекер
// не включается, а его готовый бинарный фреймворк здесь — лишний риск сборки.
import PackageDescription

let package = Package(
    name: "StudentHub",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        // xtool собирает приложение из единственного library-продукта.
        .library(name: "StudentHub", targets: ["StudentHub"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift", from: "7.0.0"),
        .package(url: "https://github.com/socketio/socket.io-client-swift", from: "16.1.0"),
    ],
    targets: [
        .target(
            name: "StudentHub",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "SocketIO", package: "socket.io-client-swift"),
            ],
            path: "Sources",
            linkerSettings: [
                // Версия SDK в заголовке бинарника (LC_BUILD_VERSION). SwiftPM ставит туда
                // минимальную iOS (17.0), и iOS 26+ запускает такое приложение в режиме
                // совместимости — без Liquid Glass: панель вкладок, кнопки и края экранов
                // остаются в стиле iOS 18. Сборка Xcode пишет версию SDK сама.
                .unsafeFlags(["-Xlinker", "-platform_version", "-Xlinker", "ios", "-Xlinker", "17.0", "-Xlinker", "26.0"]),
            ]
        ),
    ],
    // Как SWIFT_VERSION в project.yml: код написан под режим Swift 5.
    swiftLanguageModes: [.v5]
)
