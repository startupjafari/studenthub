import Foundation
import os

/// Держатель базы приложения вместо ленивой `static let`.
///
/// Файл базы защищён «до первой разблокировки» (`AppDatabase.onDisk`): после перезагрузки
/// и до того, как человек разблокирует телефон, он не читается. Тихий пуш может
/// разбудить приложение именно тогда, и прежняя `static let` открывала базу в этот
/// момент: открытие падало, база принималась за повреждённую и стиралась, а потом жила
/// в памяти до конца процесса. Держатель базу в это время не открывает вовсе и
/// открывает по разблокировке (`AppDelegate.applicationProtectedDataDidBecomeAvailable`).
///
/// Синхронный доступ (`database`) — для экранов и хранилищ: интерфейс бывает только
/// после разблокировки. Фоновые пути (тихий пуш) сначала спрашивают `isAvailable`.
final class DatabaseHolder: @unchecked Sendable {
    private let lock = NSLock()
    private var opened: AppDatabase?
    private let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "kz.studenthub.app", category: "storage")

    /// Данные устройства заперты до первой разблокировки: файл базы есть, но не
    /// читается, или связка ключей (тот же класс доступности) отвечает «недоступно».
    ///
    /// Не `UIApplication.isProtectedDataAvailable`: тот про класс `complete` и ложен
    /// при каждой блокировке экрана, а база «до первой разблокировки» доступна и на
    /// запертом экране — по нему фоновый догон перестал бы работать вовсе.
    var isLocked: Bool {
        AppDatabase.isStoreLocked() || Keychain().isLocked
    }

    /// База открыта или может быть открыта прямо сейчас.
    var isAvailable: Bool {
        if lock.withLock({ opened != nil }) { return true }
        return !isLocked
    }

    /// База для экранов и хранилищ.
    ///
    /// Если её всё же спросили до разблокировки — это ошибка вызывающего (фоновые пути
    /// проверяют `isAvailable`). Отдаём пустую временную базу в памяти, но не
    /// запоминаем: следующий запрос после разблокировки получит настоящую, а файл на
    /// диске никто не тронет.
    var database: AppDatabase {
        lock.lock()
        defer { lock.unlock() }
        if let opened { return opened }
        if isLocked {
            log.fault("База запрошена до первой разблокировки — временная пустая база в памяти")
            return Self.temporary()
        }
        let made = Self.open(log: log)
        opened = made
        return made
    }

    /// Открыть фоном, если данные доступны и база ещё не открыта: открытие и миграции
    /// не ложатся на первый кадр интерфейса.
    func prewarm() {
        guard !lock.withLock({ opened != nil }), !isLocked else { return }
        DispatchQueue.global(qos: .userInitiated).async { _ = self.database }
    }

    /// Файл не открылся (повреждение, ошибка миграции) — откладываем его в резервную
    /// копию и заводим базу заново; если и это не вышло, работаем в памяти. Приложение
    /// без базы бесполезно, но падение на старте бесполезно вдвойне: человек не увидит
    /// даже причины.
    private static func open(log: Logger) -> AppDatabase {
        do {
            return try AppDatabase.onDisk()
        } catch {
            log.error("Не открылась база чатов, откладываем в резервную копию: \(error.localizedDescription, privacy: .public)")
        }
        do {
            try AppDatabase.moveStoreAside()
            return try AppDatabase.onDisk()
        } catch {
            log.error("База чатов недоступна, работаем в памяти: \(error.localizedDescription, privacy: .public)")
        }
        return temporary()
    }

    private static func temporary() -> AppDatabase {
        do {
            return try AppDatabase.inMemory()
        } catch {
            // Память не открылась — это уже не про хранилище, а про нехватку ресурсов
            // процесса, и работать дальше всё равно нечем.
            preconditionFailure("Не удалось создать базу даже в памяти: \(error)")
        }
    }
}
