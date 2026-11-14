import Foundation
import GRDB
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

    /// Файл не открылся. Временная ошибка (занятость, I/O, нет места) — этот запуск
    /// работаем в памяти, файл не трогаем: следующий запуск откроет его как ни в чём не
    /// бывало. Повреждение или упавшая миграция — откладываем файл в резервную копию и
    /// заводим базу заново, но только после `damagedLaunchesBeforeReset` таких запусков
    /// подряд: единичный сбой не стоит черновиков и неотправленного.
    ///
    /// Приложение без базы бесполезно, но падение на старте бесполезно вдвойне: человек
    /// не увидит даже причины.
    private static func open(log: Logger, defaults: UserDefaults = .standard) -> AppDatabase {
        let failure: StoreOpenFailure
        do {
            let database = try AppDatabase.onDisk()
            defaults.removeObject(forKey: damagedStreakKey)
            return database
        } catch {
            failure = StoreOpenFailure(error)
            log.error("Не открылась база чатов (\(String(describing: failure), privacy: .public)): \(error.localizedDescription, privacy: .public)")
        }
        guard failure == .damaged else { return temporary() }

        let streak = defaults.integer(forKey: damagedStreakKey) + 1
        guard streak >= damagedLaunchesBeforeReset else {
            defaults.set(streak, forKey: damagedStreakKey)
            return temporary()
        }
        do {
            try AppDatabase.moveStoreAside()
            defaults.removeObject(forKey: damagedStreakKey)
            return try AppDatabase.onDisk()
        } catch {
            log.error("База чатов недоступна, работаем в памяти: \(error.localizedDescription, privacy: .public)")
        }
        return temporary()
    }

    /// Сколько запусков подряд база должна не открыться как повреждённая, прежде чем
    /// её отложить, — как у Telegram: третий подряд уже не случайность.
    static let damagedLaunchesBeforeReset = 3
    private static let damagedStreakKey = "storage.damagedOpenStreak"

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

/// Чем кончилось неудачное открытие базы — от этого зависит, можно ли трогать файл.
enum StoreOpenFailure: Equatable {
    /// Занятость, I/O, нехватка места, нет доступа: файл цел, откладывать его нельзя.
    case transient
    /// Файл не база или повреждён, либо схему не догнать миграцией — откладывание
    /// это исправит.
    case damaged

    init(_ error: any Error) {
        if let migration = error as? AppDatabase.MigrationFailure {
            // Миграция упала на нехватке места или занятости — дело не в схеме.
            if let database = migration.underlying as? DatabaseError, Self.isTransient(database.resultCode) {
                self = .transient
            } else {
                self = .damaged
            }
            return
        }
        // Не ошибка SQLite (каталог не создался и т. п.) — про файл базы она ничего не
        // говорит, значит, и вердикта «повреждена» нет.
        guard let database = error as? DatabaseError else {
            self = .transient
            return
        }
        switch database.resultCode {
        case .SQLITE_CORRUPT, .SQLITE_NOTADB: self = .damaged
        default: self = .transient
        }
    }

    private static func isTransient(_ code: ResultCode) -> Bool {
        switch code {
        case .SQLITE_FULL, .SQLITE_BUSY, .SQLITE_LOCKED, .SQLITE_IOERR, .SQLITE_CANTOPEN, .SQLITE_NOMEM, .SQLITE_PERM,
            .SQLITE_READONLY, .SQLITE_INTERRUPT:
            return true
        default:
            return false
        }
    }
}
