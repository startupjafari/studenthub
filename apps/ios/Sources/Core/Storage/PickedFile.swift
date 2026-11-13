import Foundation

/// Чтение файла, выбранного в «Файлах» (P2-4 аудита).
///
/// Чужой каталог читается только внутри доступа к защищённому ресурсу; свой (песочница
/// приложения) — и без него, тогда `startAccessing…` вернёт `false`, и это не ошибка. Этот
/// приём был скопирован в восемь экранов, и чтение шло на главном потоке — большой файл
/// замораживал экран. `read` читает вне главного потока; `readNow` — для синхронных мест.
enum PickedFile {
    /// Байты файла, прочитанные вне главного потока.
    static func read(_ url: URL) async throws -> Data {
        try await Task.detached(priority: .userInitiated) {
            try readNow(url)
        }.value
    }

    /// Байты файла здесь и сейчас — там, где вызывающий не асинхронный.
    static func readNow(_ url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        return try Data(contentsOf: url)
    }
}
