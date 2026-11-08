import AVFoundation
import SwiftUI
import UIKit

// Общее для экранов библиотекаря: подписи статусов, тексты отказов стойки, разбор QR,
// плашки и сканер наклеек.

enum LibrarianText {
    static let conditions = ["GOOD", "WORN", "DAMAGED"]

    static func condition(_ raw: String) -> String {
        switch raw {
        case "GOOD": return String(localized: "librarian.condition.good", defaultValue: "Хорошее")
        case "WORN": return String(localized: "librarian.condition.worn", defaultValue: "Потрёпанное")
        case "DAMAGED": return String(localized: "librarian.condition.damaged", defaultValue: "Повреждено")
        default: return raw
        }
    }

    static func copyStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "AVAILABLE": return (String(localized: "librarian.copyStatus.available", defaultValue: "На полке"), Palette.success)
        case "ON_LOAN": return (String(localized: "librarian.copyStatus.onLoan", defaultValue: "Выдан"), Palette.info)
        case "RESERVED": return (String(localized: "librarian.copyStatus.reserved", defaultValue: "Под бронью"), Palette.warning)
        case "LOST": return (String(localized: "librarian.copyStatus.lost", defaultValue: "Утерян"), Palette.destructive)
        case "WRITTEN_OFF": return (String(localized: "librarian.copyStatus.writtenOff", defaultValue: "Списан"), Palette.mutedForeground)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func blocker(_ raw: String) -> String {
        switch raw {
        case "status": return String(localized: "librarian.error.status", defaultValue: "Студент отчислен, выпущен или переведён — книги не выдаются")
        case "overdue": return String(localized: "librarian.error.overdue", defaultValue: "У читателя просрочена книга — сначала её возврат")
        case "lost": return String(localized: "librarian.error.lost", defaultValue: "У читателя не погашен долг за утерянную книгу")
        case "limit": return String(localized: "librarian.error.limit", defaultValue: "У читателя на руках предельное число книг")
        default: return raw
        }
    }

    static func leftStatus(_ raw: String) -> String {
        switch raw {
        case "EXPELLED": return String(localized: "librarian.reader.expelled", defaultValue: "Отчислен")
        case "GRADUATED": return String(localized: "librarian.reader.graduated", defaultValue: "Выпускник")
        case "TRANSFERRED": return String(localized: "librarian.reader.transferred", defaultValue: "Переведён")
        default: return raw
        }
    }

    static func inventoryWarning(_ raw: String) -> String {
        switch raw {
        case "onLoan": return String(localized: "librarian.inv.warnOnLoan", defaultValue: "числится выданным — оформите возврат")
        case "lost": return String(localized: "librarian.inv.warnLost", defaultValue: "числится утерянным")
        case "writtenOff": return String(localized: "librarian.inv.warnWrittenOff", defaultValue: "числится списанным")
        default: return raw
        }
    }

    static func inventoryShort(_ number: String) -> String {
        String(localized: "librarian.inventoryShort", defaultValue: "инв. \(number)")
    }

    /// Код наклейки для глаз: ABCD-EFGH, как у помещений.
    static func copyCode(_ code: String) -> String {
        code.count == 8 ? "\(code.prefix(4))-\(code.suffix(4))" : code
    }

    // MARK: Даты

    /// «ГГГГ-ММ-ДД» → дата полудня по календарю телефона: для показа и выбора дня.
    static func date(fromDay raw: String) -> Date? {
        let parts = raw.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.hour = 12
        return Calendar.current.date(from: components)
    }

    static func dayString(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// «12 окт.» из «ГГГГ-ММ-ДД» — день срока по часам вуза, без сдвига поясом телефона.
    static func shortDay(_ raw: String) -> String {
        guard let date = date(fromDay: raw) else { return raw }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }

    static func shortDay(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated))
    }

    // MARK: Отказы стойки

    /// Отказы выдачи, возврата и брони: сервер отвечает 409 с `details.field` — по нему и
    /// выбирается текст, а не по сообщению сервера.
    static func deskMessage(_ error: Error) -> String {
        guard case .server(let code, _, let details, _)? = error as? APIError else { return error.userMessage }
        let field = details.first?.field
        switch code {
        case .conflict:
            if let field, let text = conflictText(field) { return text }
            return String(localized: "librarian.error.qrUsed", defaultValue: "Этот QR уже проверил другой сотрудник — попросите студента обновить карту")
        case .badRequest:
            return String(localized: "librarian.error.qrExpired", defaultValue: "Код студенческого истёк — попросите обновить карту")
        case .validationError where field == "dueDate":
            return String(localized: "librarian.error.dueDate", defaultValue: "Срок вне правил библиотеки")
        case .notFound:
            return String(localized: "librarian.error.notFound", defaultValue: "Не найдено — проверьте наклейку или номер")
        default:
            return error.userMessage
        }
    }

    /// Ошибка стойки с готовым текстом: `FormSheet` и `RemoteContent` показывают
    /// `userMessage`, и это должен быть понятный отказ («продлений больше нельзя»), а не
    /// общее «конфликт». Текст сервера в `APIError` без деталей показывается как есть.
    static func deskError(_ error: Error) -> Error {
        guard error is APIError else { return error }
        if let api = error as? APIError, case .transport = api { return error }
        return messageError(deskMessage(error))
    }

    static func messageError(_ text: String) -> Error {
        APIError.server(code: .unknown("LOCAL"), message: text, details: [], statusCode: 0)
    }

    /// Пропуск истёк или не наш — надо сканировать студенческий заново.
    static func isTicketError(_ error: Error) -> Bool {
        guard case .server(let code, _, let details, _)? = error as? APIError else { return false }
        return code == .conflict && details.first?.field == "ticket"
    }

    static func conflictField(_ error: Error) -> String? {
        guard case .server(let code, _, let details, _)? = error as? APIError, code == .conflict else { return nil }
        return details.first?.field
    }

    private static func conflictText(_ field: String) -> String? {
        switch field {
        case "status", "overdue", "lost", "limit": return blocker(field)
        case "onLoan": return String(localized: "librarian.error.onLoan", defaultValue: "Экземпляр уже выдан — сначала оформите возврат")
        case "reserved": return String(localized: "librarian.error.reserved", defaultValue: "Экземпляр отложен под бронь другого читателя")
        case "withdrawn": return String(localized: "librarian.error.withdrawn", defaultValue: "Экземпляр выведен из оборота (утерян или списан)")
        case "archived": return String(localized: "librarian.error.archived", defaultValue: "Книга в архиве")
        case "ticket": return String(localized: "librarian.error.ticket", defaultValue: "Пропуск на выдачу истёк — отсканируйте студенческий заново")
        case "module": return String(localized: "librarian.error.module", defaultValue: "Библиотека вуза выключена")
        case "reader": return String(localized: "librarian.error.reader", defaultValue: "Книги выдаются только студентам и старостам")
        case "notOnLoan": return String(localized: "librarian.error.notOnLoan", defaultValue: "Этот экземпляр сейчас никому не выдан")
        case "renewals": return String(localized: "librarian.error.renewals", defaultValue: "Продлений больше нельзя")
        case "queue": return String(localized: "librarian.error.queue", defaultValue: "На книгу есть очередь броней — продлить нельзя")
        case "closed": return String(localized: "librarian.error.closed", defaultValue: "Бронь уже закрыта")
        case "notReturned": return String(localized: "librarian.error.notReturned", defaultValue: "Эта выдача не закрыта возвратом")
        case "returnWindow": return String(localized: "librarian.error.returnWindow", defaultValue: "Возврат можно отменить только в течение суток")
        case "reissued": return String(localized: "librarian.error.reissued", defaultValue: "Экземпляр с тех пор выдали другому читателю")
        case "heldForReservation": return String(localized: "librarian.error.heldForReservation", defaultValue: "Экземпляр уже отложен под бронь другого читателя")
        case "notLost": return String(localized: "librarian.error.notLost", defaultValue: "Книга не отмечена утерянной")
        case "settled": return String(localized: "librarian.error.settled", defaultValue: "Долг уже погашен")
        case "alreadyRevoked": return String(localized: "librarian.error.alreadyRevoked", defaultValue: "Справка уже отозвана")
        case "noPhoneMark": return String(localized: "librarian.error.noPhoneMark", defaultValue: "Без скана QR книгу можно выдать только с отметкой «читатель без телефона»")
        case "cardAmbiguous": return String(localized: "librarian.error.cardAmbiguous", defaultValue: "Этот номер студенческого у нескольких читателей — выдайте книгу по скану QR")
        case "inventoryNumber": return String(localized: "librarian.error.inventoryTaken", defaultValue: "Такой инвентарный номер уже есть в фонде")
        default: return nil
        }
    }
}

/// Что за QR StudentHub перед камерой библиотекаря: наклейка экземпляра, студенческий
/// читателя или вход на компьютере. Сверяется путь, не домен — как `parseQrTarget` в вебе.
enum LibrarianQRTarget: Equatable {
    case copy(code: String)
    case studentID(token: String)
    case login
    case other

    private static let codeAlphabet = Set("23456789ABCDEFGHJKMNPQRSTUVWXYZ")

    static func parse(_ raw: String) -> LibrarianQRTarget {
        guard
            let components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
            let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http"
        else { return .other }
        var path = components.path
        while path.count > 1, path.hasSuffix("/") { path.removeLast() }
        let token = components.queryItems?.first(where: { $0.name == "t" })?.value
        if path == "/verify-id" {
            if let token, !token.isEmpty, token.count <= 2048 { return .studentID(token: token) }
            return .other
        }
        if path == "/qr" { return token?.isEmpty == false ? .login : .other }
        let segments = path.split(separator: "/").map(String.init)
        if segments.count == 2, segments[0] == "c", isCode(segments[1]) {
            return .copy(code: segments[1])
        }
        return .other
    }

    /// Ручной ввод в поле экземпляра: ссылка с наклейки — это код, остальное — инвентарный номер.
    static func copyRef(fromInput raw: String) -> LibrarianCopyRef? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if case .copy(let code) = parse(trimmed) { return .code(code) }
        return .inventory(trimmed)
    }

    static func isCode(_ value: String) -> Bool {
        value.count == 8 && value.allSatisfy { codeAlphabet.contains($0) }
    }
}

/// Плашка статуса: цвет — смысл, текст — всегда рядом.
struct LibrarianBadge: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, 2)
            .foregroundStyle(tint)
            .background(tint.opacity(0.12), in: Capsule())
    }
}

/// Срок выдачи: «до 12 окт.», «просрочено с …», закрытые — их итог.
struct LibrarianLoanDueBadge: View {
    let loan: LibrarianLoanDTO

    var body: some View {
        switch loan.status {
        case "OPEN":
            if loan.overdue {
                LibrarianBadge(
                    text: String(localized: "librarian.overdueSince", defaultValue: "просрочено с \(LibrarianText.shortDay(loan.dueDate))"),
                    tint: Palette.destructive
                )
            } else {
                LibrarianBadge(
                    text: String(localized: "librarian.dueUntil", defaultValue: "до \(LibrarianText.shortDay(loan.dueDate))"),
                    tint: Palette.info
                )
            }
        case "RETURNED":
            LibrarianBadge(text: String(localized: "librarian.statusReturned", defaultValue: "Возвращена"), tint: Palette.success)
        case "LOST":
            if loan.isLostDebt {
                LibrarianBadge(text: String(localized: "librarian.statusLostDebt", defaultValue: "Утеряна — долг"), tint: Palette.destructive)
            } else {
                LibrarianBadge(text: String(localized: "librarian.statusLostSettled", defaultValue: "Утеряна, долг погашен"), tint: Palette.mutedForeground)
            }
        case "CANCELLED":
            LibrarianBadge(text: String(localized: "librarian.statusCancelled", defaultValue: "Отменена"), tint: Palette.mutedForeground)
        default:
            LibrarianBadge(text: loan.status, tint: Palette.mutedForeground)
        }
    }
}

/// Плашка брони: готова до дня, место в очереди, закрытые — итог.
struct LibrarianReservationBadge: View {
    let reservation: LibrarianReservationDTO

    var body: some View {
        switch reservation.status {
        case "READY":
            LibrarianBadge(
                text: reservation.holdDate.map { String(localized: "librarian.res.readyUntil", defaultValue: "Готова до \(LibrarianText.shortDay($0))") }
                    ?? String(localized: "librarian.res.ready", defaultValue: "Готова"),
                tint: Palette.success
            )
        case "QUEUED":
            LibrarianBadge(
                text: reservation.position.map { String(localized: "librarian.res.position", defaultValue: "В очереди: \(String($0))-я") }
                    ?? String(localized: "librarian.res.queued", defaultValue: "В очереди"),
                tint: Palette.warning
            )
        case "FULFILLED":
            LibrarianBadge(text: String(localized: "librarian.res.fulfilled", defaultValue: "Выдана"), tint: Palette.info)
        case "EXPIRED":
            LibrarianBadge(text: String(localized: "librarian.res.expired", defaultValue: "Истекла"), tint: Palette.mutedForeground)
        case "CANCELLED":
            LibrarianBadge(text: String(localized: "librarian.res.cancelled", defaultValue: "Отменена"), tint: Palette.mutedForeground)
        default:
            LibrarianBadge(text: reservation.status, tint: Palette.mutedForeground)
        }
    }
}

/// Строка выдачи: книга, экземпляр, читатель, срок и пометки.
struct LibrarianLoanRow: View {
    let loan: LibrarianLoanDTO
    var showReader = true

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            BookCoverView(url: loan.book.coverUrl, width: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(loan.book.title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                Text(LibrarianText.inventoryShort(loan.copy.inventoryNumber))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                if showReader {
                    let reader = [loan.reader.name, loan.reader.group, loan.reader.card.map { "№ \($0)" }]
                        .compactMap { $0 }
                        .joined(separator: " · ")
                    Text(reader)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(2)
                }
                let issued = String(
                    localized: "librarian.issuedOn",
                    defaultValue: "Выдана \(LibrarianText.shortDay(loan.issuedAt)) · \(loan.issuedBy ?? "—")"
                )
                Text(issued)
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
                if loan.renewals > 0 {
                    Text(String(localized: "librarian.renewed", defaultValue: "продлена: \(String(loan.renewals))"))
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                }
                if let reason = loan.cancelReason, loan.status == "CANCELLED" {
                    Text(String(localized: "librarian.cancelReasonShort", defaultValue: "отменена: \(reason)"))
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                }
                HStack(spacing: Spacing.xs) {
                    LibrarianLoanDueBadge(loan: loan)
                    if loan.disputedAt != nil, loan.status == "OPEN" {
                        LibrarianBadge(text: String(localized: "librarian.disputed", defaultValue: "Оспорена читателем"), tint: Palette.warning)
                    }
                }
                HStack(spacing: Spacing.xs) {
                    if loan.withoutPhone == true {
                        LibrarianBadge(text: String(localized: "librarian.noPhoneBadge", defaultValue: "Без телефона"), tint: Palette.mutedForeground)
                    }
                    if let left = loan.reader.leftStatus {
                        LibrarianBadge(text: LibrarianText.leftStatus(left), tint: Palette.destructive)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Поле экземпляра: скан наклейки (основной путь) или инвентарный номер, когда наклейка
/// стёрлась. Ссылка с наклейки, вставленная в поле, становится кодом.
struct LibrarianCopyField: View {
    @Binding var value: LibrarianCopyRef?
    @State private var text = ""
    @State private var scanning = false

    var body: some View {
        Group {
            if case .code(let code)? = value {
                HStack {
                    Label(LibrarianText.copyCode(code), systemImage: "qrcode")
                        .font(Typography.body.monospaced())
                    Text(String(localized: "librarian.copyScanned", defaultValue: "наклейка отсканирована"))
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                    Spacer()
                    Button {
                        value = nil
                        text = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(Text(String(localized: "librarian.clearCopy", defaultValue: "Убрать наклейку")))
                }
            } else {
                TextField(String(localized: "librarian.inventoryPlaceholder", defaultValue: "Инвентарный номер"), text: $text)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onChange(of: text) { _, newValue in
                        value = LibrarianQRTarget.copyRef(fromInput: newValue)
                    }
            }
            Button {
                scanning = true
            } label: {
                Label(String(localized: "librarian.scanCopy", defaultValue: "Сканировать наклейку"), systemImage: "qrcode.viewfinder")
            }
        }
        .onChange(of: value) { _, newValue in
            if newValue == nil { text = "" }
        }
        .sheet(isPresented: $scanning) {
            LibrarianScannerSheet(
                title: String(localized: "librarian.scanCopyTitle", defaultValue: "Наклейка книги"),
                hint: String(localized: "librarian.scanCopyHint", defaultValue: "Наведите камеру на QR-код на книге")
            ) { raw in
                if case .copy(let code) = LibrarianQRTarget.parse(raw) {
                    value = .code(code)
                    return true
                }
                return false
            }
        }
    }
}

// MARK: - Сканер

/// Лист со сканером: принимает код через `accept` — `true` закрывает лист, `false`
/// показывает «это не тот код» и сканирует дальше.
struct LibrarianScannerSheet: View {
    let title: String
    let hint: String
    var keepOpen = false
    let accept: (String) -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var notice: String?
    @State private var unavailable = false

    var body: some View {
        NavigationStack {
            VStack(spacing: Spacing.lg) {
                LibrarianScannerView(
                    onCode: { raw in
                        if accept(raw) {
                            notice = nil
                            if !keepOpen { dismiss() }
                            return true
                        }
                        notice = String(localized: "librarian.scan.notCopy", defaultValue: "Это не наклейка книги")
                        return false
                    },
                    onUnavailable: { unavailable = true }
                )
                .overlay {
                    if unavailable {
                        ContentUnavailableView(
                            String(localized: "librarian.scan.noCamera", defaultValue: "Нет доступа к камере"),
                            systemImage: "video.slash",
                            description: Text(String(localized: "librarian.scan.noCameraHint", defaultValue: "Разрешите доступ к камере в настройках iPhone или введите номер вручную."))
                        )
                        .background(Palette.card)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
                Text(hint)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                if let notice {
                    Label(notice, systemImage: "exclamationmark.triangle")
                        .font(Typography.meta)
                        .foregroundStyle(Palette.warning)
                }
            }
            .padding(Spacing.xl)
            .background(Palette.background)
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "librarian.close", defaultValue: "Закрыть")) { dismiss() }
                }
            }
        }
    }
}

/// Камера, читающая QR-наклейки и штрихкоды подряд, без перезапуска: для инвентаризации
/// вдоль полки сканер не гаснет после первого кода. Один и тот же код повторно не
/// отдаётся, пока камера не увидит другой или не пройдёт пара секунд.
struct LibrarianScannerView: UIViewControllerRepresentable {
    /// `true` — код принят (короткая вибрация успеха), `false` — не тот код.
    let onCode: (String) -> Bool
    let onUnavailable: () -> Void

    func makeUIViewController(context: Context) -> LibrarianScannerController {
        let controller = LibrarianScannerController()
        controller.onCode = onCode
        controller.onUnavailable = onUnavailable
        return controller
    }

    func updateUIViewController(_ controller: LibrarianScannerController, context: Context) {
        controller.onCode = onCode
        controller.onUnavailable = onUnavailable
    }
}

final class LibrarianScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Bool)?
    var onUnavailable: (() -> Void)?

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "kz.studenthub.librarian-scanner")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var lastCode: String?
    private var lastAt = Date.distantPast

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configure()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                Task { @MainActor [weak self] in
                    if granted { self?.configure() } else { self?.onUnavailable?() }
                }
            }
        default:
            onUnavailable?()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        let session = self.session
        sessionQueue.async { if session.isRunning { session.stopRunning() } }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        guard previewLayer != nil else { return }
        let session = self.session
        sessionQueue.async { if !session.isRunning { session.startRunning() } }
    }

    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard
            let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
            let payload = object.stringValue
        else { return }
        Task { @MainActor [weak self] in
            self?.deliver(payload)
        }
    }

    private func configure() {
        guard
            let device = AVCaptureDevice.default(for: .video),
            let input = try? AVCaptureDeviceInput(device: device),
            session.canAddInput(input)
        else {
            onUnavailable?()
            return
        }
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            onUnavailable?()
            return
        }
        session.beginConfiguration()
        session.addInput(input)
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        // QR — наклейки экземпляров и студенческий; штрихкоды — на случай ISBN и старых
        // инвентарных наклеек фонда.
        let wanted: [AVMetadataObject.ObjectType] = [.qr, .ean13, .ean8, .code128, .code39, .code93, .upce, .itf14, .dataMatrix]
        output.metadataObjectTypes = wanted.filter { output.availableMetadataObjectTypes.contains($0) }
        session.commitConfiguration()

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)
        previewLayer = preview

        let session = self.session
        sessionQueue.async { if !session.isRunning { session.startRunning() } }
    }

    private func deliver(_ payload: String) {
        let now = Date()
        // Камера видит наклейку десятки раз в секунду — повтор того же кода гасим.
        if payload == lastCode, now.timeIntervalSince(lastAt) < 2.5 { return }
        lastCode = payload
        lastAt = now
        let accepted = onCode?(payload) ?? false
        let feedback = UINotificationFeedbackGenerator()
        feedback.notificationOccurred(accepted ? .success : .warning)
    }
}
