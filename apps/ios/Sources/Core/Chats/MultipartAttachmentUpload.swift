import Foundation
import Observation

/// Многочастная загрузка открыта сервером: ключ объекта, id загрузки и нарезка.
/// Клиент режет файл ровно по `partSize`, который посчитал сервер.
struct MultipartUploadTarget: Decodable, Equatable {
    let key: String
    let uploadId: String
    let partSize: Int
    let partCount: Int
}

/// Подписанная ссылка на PUT одной части. Номера — с единицы, как в S3.
struct MultipartPartURL: Decodable, Equatable {
    let part: Int
    let url: URL
}

/// Залитая часть: номер и ETag — без них сервер не соберёт объект.
struct UploadedPart: Encodable, Equatable {
    let part: Int
    let etag: String
}

/// Многочастная загрузка вложения чата — тем же протоколом, что и в вебе (Ф19):
/// start → подписи на части → PUT каждой части → сборка сервером на отправке сообщения.
///
/// Отдельного шага `complete` нет намеренно: собранный заранее объект остался бы сиротой,
/// не дойди отправка сообщения. Поэтому наружу уходят ключ, id загрузки и список частей —
/// их несёт `POST /chats/:id/messages/uploaded`.
///
/// Файл читается с диска по частям: в памяти одновременно не больше трёх частей по
/// 10 МБ, а не полугигабайтный ролик целиком.
struct MultipartAttachmentUpload: Sendable {
    let api: AttachmentSending
    let chatID: String

    /// Сколько частей льём одновременно — как в вебе: больше не ускоряет, а на
    /// мобильной сети только мешает.
    static let concurrency = 3
    /// Попыток на часть: обрыв одной из пятидесяти не должен убивать всю загрузку.
    static let attempts = 3

    struct Result: Equatable {
        let key: String
        let uploadID: String
        let parts: [UploadedPart]
    }

    /// `progress` — номер части и сколько её байт уже ушло.
    func run(
        file: URL,
        size: Int,
        mime: String,
        progress: @escaping @Sendable (_ part: Int, _ sent: Int64) -> Void
    ) async throws -> Result {
        let target = try await api.startMultipart(chatID: chatID, mime: mime, size: size)
        do {
            return try await upload(file: file, size: size, target: target, progress: progress)
        } catch {
            // Крестик, обрыв, сбой части — загрузка брошена: повтор начнёт новую, а
            // залитые части этой серверу больше не нужны.
            abandon(key: target.key, uploadID: target.uploadId)
            throw error
        }
    }

    /// Бросить загрузку на сервере. Отдельной задачей и без ожидания: вызывающая задача
    /// часто уже отменена (крестик), и запрос из неё оборвался бы, не уйдя.
    func abandon(key: String, uploadID: String) {
        let api = api
        let chatID = chatID
        Task.detached {
            try? await api.abortMultipart(chatID: chatID, key: key, uploadID: uploadID)
        }
    }

    private func upload(
        file: URL,
        size: Int,
        target: MultipartUploadTarget,
        progress: @escaping @Sendable (_ part: Int, _ sent: Int64) -> Void
    ) async throws -> Result {
        let session = MultipartSession(api: api, chatID: chatID, target: target)
        try await session.signAll()

        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<min(Self.concurrency, target.partCount) {
                group.addTask {
                    while let part = await session.next() {
                        let offset = (part - 1) * target.partSize
                        let length = min(target.partSize, size - offset)
                        let body = try Self.read(file, offset: offset, length: length)
                        let etag = try await put(body, part: part, session: session) { sent in
                            progress(part, sent)
                        }
                        // Часть засчитываем целиком: последний отчёт делегата может не дойти до конца.
                        progress(part, Int64(length))
                        await session.finish(UploadedPart(part: part, etag: etag))
                    }
                }
            }
            try await group.waitForAll()
        }

        return Result(key: target.key, uploadID: target.uploadId, parts: await session.uploaded)
    }

    /// Одна часть с повторами. 403 хранилища на PUT части — почти всегда протухшая
    /// подпись: повтор той же ссылкой упал бы так же, поэтому следующая попытка — со свежей.
    private func put(
        _ body: Data,
        part: Int,
        session: MultipartSession,
        progress: @escaping @Sendable (Int64) -> Void
    ) async throws -> String {
        var fresh = false
        var lastError: Error = URLError(.unknown)
        for attempt in 1...Self.attempts {
            // Вне `do`: отказ API в подписи — его ошибка с кодом, а не сбой хранилища.
            let url = try await session.url(for: part, fresh: fresh)
            do {
                return try await api.uploadPart(body, to: url, progress: progress)
            } catch {
                // Отмену не повторяем: человек нажал крестик, а не сеть моргнула.
                try Task.checkCancellation()
                lastError = error
                if case APIError.malformedResponse(let status) = error, status == 403 {
                    fresh = true
                } else {
                    fresh = false
                }
                // Счётчик части — с нуля, иначе повтор досчитал бы её дважды.
                progress(0)
                if attempt < Self.attempts {
                    try await Task.sleep(for: .milliseconds(500 << (attempt - 1)))
                }
            }
        }
        throw lastError
    }

    private static func read(_ file: URL, offset: Int, length: Int) throws -> Data {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        try handle.seek(toOffset: UInt64(offset))
        guard let data = try handle.read(upToCount: length), data.count == length else {
            throw URLError(.cannotOpenFile)
        }
        return data
    }
}

/// Общее состояние воркеров одной загрузки: очередь частей, подписи, готовые части.
private actor MultipartSession {
    /// Подпись старше этого перевыпускаем перед PUT. Живут подписи 15 минут
    /// (`TTL.PRESIGNED_URL_MINUTES`), а берутся разом на все части: 500 МБ на медленной
    /// сети льются дольше. Три минуты запаса — на заливку самой части.
    private static let resignAfter: TimeInterval = 12 * 60

    private let api: AttachmentSending
    private let chatID: String
    private let target: MultipartUploadTarget
    private var queue: [Int]
    private var signed: [Int: (url: URL, at: Date)] = [:]
    private var resigning: Task<Void, Error>?
    private(set) var uploaded: [UploadedPart] = []

    init(api: AttachmentSending, chatID: String, target: MultipartUploadTarget) {
        self.api = api
        self.chatID = chatID
        self.target = target
        self.queue = Array(1...max(1, target.partCount))
    }

    func next() -> Int? {
        queue.isEmpty ? nil : queue.removeFirst()
    }

    func finish(_ part: UploadedPart) {
        uploaded.append(part)
        uploaded.sort { $0.part < $1.part }
    }

    func signAll() async throws {
        try await sign(queue)
    }

    /// Ссылка на часть; `fresh` — перевыпустить, даже если по возрасту ещё жива.
    ///
    /// Перевыпуск один на всех воркеров: наткнувшись на старые подписи разом, три воркера
    /// не шлют три одинаковых запроса. Вместе с частью перевыпускается вся очередь — её
    /// подписывали тем же запросом, и она так же стара.
    func url(for part: Int, fresh: Bool) async throws -> URL {
        let asked = Date()
        while true {
            if let entry = signed[part] {
                let usable = fresh ? entry.at >= asked : Date().timeIntervalSince(entry.at) <= Self.resignAfter
                if usable { return entry.url }
            }
            if let resigning {
                try await resigning.value
                continue
            }
            let parts = [part] + queue
            let task = Task { try await self.sign(parts) }
            resigning = task
            defer { resigning = nil }
            try await task.value
        }
    }

    /// Подписи берутся диапазонами: полсотни частей по запросу на каждую упёрлись бы
    /// в ограничитель выдачи подписей.
    private func sign(_ parts: [Int]) async throws {
        for range in Self.ranges(parts) {
            let batch = try await api.partURLs(
                chatID: chatID,
                key: target.key,
                uploadID: target.uploadId,
                from: range.lowerBound,
                to: range.upperBound
            )
            let now = Date()
            for item in batch {
                signed[item.part] = (item.url, now)
            }
        }
    }

    private static func ranges(_ parts: [Int]) -> [ClosedRange<Int>] {
        var result: [ClosedRange<Int>] = []
        for part in Set(parts).sorted() {
            if let last = result.last, last.upperBound + 1 == part {
                result[result.count - 1] = last.lowerBound...part
            } else {
                result.append(part...part)
            }
        }
        return result
    }
}

/// Счётчик отправленного по всем файлам сообщения. Доля — по байтам, а не по числу
/// готовых файлов: иначе стомегабайтный ролик и снимок двигали бы полосу одинаково.
final class UploadTally: @unchecked Sendable {
    private let lock = NSLock()
    private var total: Int64
    private let onChange: @Sendable (Double) -> Void
    private var sent: [String: Int64] = [:]
    private var reported: Double = -1

    init(total: Int64, onChange: @escaping @Sendable (Double) -> Void) {
        self.total = total
        self.onChange = onChange
    }

    /// Сколько байт ушло по куску `key` (файл или часть файла).
    func set(_ key: String, _ bytes: Int64) {
        let fraction: Double? = lock.withLock {
            sent[key] = bytes
            return fractionIfChanged()
        }
        if let fraction { onChange(fraction) }
    }

    /// Файл убран из отправки (крестик на плитке альбома): его байты больше не ждём, иначе
    /// общая доля так и не дошла бы до конца.
    func drop(_ key: String, bytes: Int64) {
        let fraction: Double? = lock.withLock {
            total = max(0, total - bytes)
            sent = sent.filter { $0.key != key && !$0.key.hasPrefix(key + ".") }
            return fractionIfChanged()
        }
        if let fraction { onChange(fraction) }
    }

    /// Новая доля, если она заметно сдвинулась. Вызывается под замком.
    private func fractionIfChanged() -> Double? {
        guard total > 0 else { return nil }
        let value = min(1, Double(sent.values.reduce(0, +)) / Double(total))
        // Перерисовка на каждый отправленный килобайт — лишняя работа главному потоку:
        // шаг в процент глазу не отличить от плавного.
        guard abs(value - reported) >= 0.01 || (value == 1 && reported != 1) else { return nil }
        reported = value
        return value
    }
}

/// Идущие загрузки вложений: доля отправленного для пузыря и задача — для крестика.
///
/// Живёт в памяти и только пока приложение открыто: после перезапуска загрузку довести
/// некому, и такие сообщения становятся неудачными (`AttachmentUploader.failAbandoned`).
@MainActor
@Observable
final class AttachmentUploads {
    static let shared = AttachmentUploads()

    /// Доля отправленного по локальному id сообщения.
    private(set) var progress: [String: Double] = [:]
    /// Доля отправленного по каждому файлу (локальный id вложения) — кольцо на своей
    /// плитке альбома, как в Telegram.
    private(set) var fileProgress: [String: Double] = [:]
    /// Файлы, убранные из отправки крестиком на плитке, — по id сообщения.
    @ObservationIgnored private var removedFiles: [String: Set<String>] = [:]
    /// Файл, который уходит сейчас, и как остановить только его.
    @ObservationIgnored private var currentFile: [String: (id: String, stop: @Sendable () -> Void)] = [:]
    /// Файлы сообщения, о которых приходили доли, — чтобы убрать их вместе с ним.
    @ObservationIgnored private var reportedFiles: [String: Set<String>] = [:]
    /// Файлы уже в хранилище, сообщение отправляется: состав больше не меняется.
    @ObservationIgnored private var sealed: Set<String> = []
    @ObservationIgnored private var tasks: [String: Task<Bool, Never>] = [:]
    /// Поставлены в ленту и ждут своей очереди: альбомы одной отправки уезжают по одному.
    @ObservationIgnored private var queued: Set<String> = []

    /// Идущие и ждущие очереди — их нельзя считать оборванными.
    var runningIDs: Set<String> { queued.union(tasks.keys) }

    func enqueue(_ messageID: String) {
        queued.insert(messageID)
    }

    func begin(_ messageID: String, task: Task<Bool, Never>) {
        queued.remove(messageID)
        tasks[messageID] = task
        progress[messageID] = 0
    }

    func report(_ messageID: String, fraction: Double) {
        // Отчёт может прийти уже после конца загрузки — тогда он лишний.
        guard tasks[messageID] != nil else { return }
        progress[messageID] = fraction
    }

    func end(_ messageID: String) {
        queued.remove(messageID)
        tasks[messageID] = nil
        progress[messageID] = nil
        for file in reportedFiles.removeValue(forKey: messageID) ?? [] {
            fileProgress[file] = nil
        }
        removedFiles[messageID] = nil
        currentFile[messageID] = nil
        sealed.remove(messageID)
    }

    // MARK: Файлы альбома

    func reportFile(_ fileID: String, of messageID: String, fraction: Double) {
        guard tasks[messageID] != nil, removedFiles[messageID]?.contains(fileID) != true else { return }
        reportedFiles[messageID, default: []].insert(fileID)
        fileProgress[fileID] = fraction
    }

    func beginFile(_ fileID: String, of messageID: String, stop: @escaping @Sendable () -> Void) {
        currentFile[messageID] = (fileID, stop)
    }

    func endFile(of messageID: String) {
        currentFile[messageID] = nil
    }

    func isRemoved(_ fileID: String, from messageID: String) -> Bool {
        removedFiles[messageID]?.contains(fileID) == true
    }

    /// Закрыть состав сообщения перед отправкой. Ответ — что успели убрать.
    func seal(_ messageID: String) -> Set<String> {
        sealed.insert(messageID)
        return removedFiles[messageID] ?? []
    }

    /// Крестик на плитке альбома: убрать файл из отправки. Идёт его загрузка — она
    /// останавливается, альбом едет дальше без него. `false` — поздно: файлы уже в
    /// хранилище и сообщение отправляется (его состав сервер вот-вот запишет).
    @discardableResult
    func removeFile(_ fileID: String, from messageID: String) -> Bool {
        guard !sealed.contains(messageID) else { return false }
        removedFiles[messageID, default: []].insert(fileID)
        fileProgress[fileID] = nil
        if let current = currentFile[messageID], current.id == fileID {
            current.stop()
        }
        return true
    }

    /// Отменить загрузку. `false` — она не идёт (ждёт очереди, оборвана перезапуском или
    /// уже закончилась): тогда сообщение убирает сам вызывающий.
    @discardableResult
    func cancel(_ messageID: String) -> Bool {
        queued.remove(messageID)
        guard let task = tasks[messageID] else { return false }
        task.cancel()
        return true
    }
}
