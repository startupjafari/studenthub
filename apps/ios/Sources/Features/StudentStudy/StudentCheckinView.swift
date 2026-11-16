import SwiftUI

/// Самоотметка на занятии по QR (веб `/checkin`). Камера читает код, который
/// преподаватель показывает на занятии, — ссылку `…/checkin?t=…`; если камера
/// недоступна, код вводится вручную. Отметку ставит `POST /attendance/check-in`.
struct StudentCheckinView: View {
    /// Код из ссылки, если экран открыт по ней, — отметка начинается сразу.
    var token: String?

    @State private var state: CheckinState = .scanning
    @State private var isCameraUnavailable = false
    @State private var isEnteringCode = false
    @State private var code = ""

    private enum CheckinState: Equatable {
        case scanning
        case loading
        case done(StudentCheckInResultDTO)
        case failed(String)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                switch state {
                case .scanning:
                    scanner
                case .loading:
                    resultCard(symbol: nil, tint: Palette.mutedForeground,
                               title: String(localized: "student.checkin.loading", defaultValue: "Отмечаем присутствие…"))
                case .done(let result):
                    doneCard(result)
                case .failed(let message):
                    resultCard(symbol: "exclamationmark.triangle", tint: Palette.destructive,
                               title: String(localized: "student.checkin.failed", defaultValue: "Не удалось отметиться"),
                               lines: [message])
                }

                if state != .scanning && state != .loading {
                    VStack(spacing: Spacing.md) {
                        Button {
                            state = .scanning
                        } label: {
                            Label(String(localized: "student.checkin.again", defaultValue: "Сканировать ещё раз"), systemImage: "qrcode.viewfinder")
                                .frame(maxWidth: .infinity)
                        }
                        .controlSize(.large)
                        .glassProminentButton()
                        NavigationLink(value: AppRoute.student(.attendance)) {
                            Text(String(localized: "student.checkin.toAttendance", defaultValue: "К посещаемости"))
                                .frame(maxWidth: .infinity)
                        }
                        .controlSize(.large)
                        .glassButton()
                    }
                }
            }
            .padding(Spacing.xl)
        }
        .background(Palette.background)
        // Отметка принята или отклонена — ощутимо, не только видно (п. 50 аудита).
        .sensoryFeedback(trigger: state) { _, new in
            switch new {
            case .done: .success
            case .failed: .error
            case .scanning, .loading: nil
            }
        }
        .navigationTitle(Text(StudentScreen.checkin.title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    code = ""
                    isEnteringCode = true
                } label: {
                    Image(systemName: "keyboard")
                        .accessibilityLabel(Text(String(localized: "student.checkin.enterCode", defaultValue: "Ввести код")))
                }
            }
        }
        .alert(String(localized: "student.checkin.enterCode", defaultValue: "Ввести код"), isPresented: $isEnteringCode) {
            TextField(String(localized: "student.checkin.codePlaceholder", defaultValue: "Код или ссылка из QR"), text: $code)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            Button(String(localized: "student.checkin.submit", defaultValue: "Отметиться")) {
                let value = code
                Task { await checkIn(value) }
            }
        } message: {
            Text(String(localized: "student.checkin.codeHint", defaultValue: "Вставьте код, который показал преподаватель, или ссылку из QR."))
        }
        .task {
            if let token, !token.isEmpty, state == .scanning {
                await checkIn(token)
            }
        }
    }

    private var scanner: some View {
        VStack(spacing: Spacing.lg) {
            if isCameraUnavailable {
                EmptyStateView(
                    title: String(localized: "student.checkin.noCamera", defaultValue: "Камера недоступна"),
                    symbol: "camera.metering.unknown",
                    hint: String(localized: "student.checkin.noCameraHint", defaultValue: "Разрешите доступ к камере в настройках или введите код вручную."),
                    actionTitle: String(localized: "student.checkin.enterCode", defaultValue: "Ввести код"),
                    action: {
                        code = ""
                        isEnteringCode = true
                    }
                )
            } else {
                QRScannerView(
                    onScan: { payload in Task { await checkIn(payload) } },
                    onUnavailable: { isCameraUnavailable = true }
                )
                .frame(maxWidth: .infinity)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                .overlay { StudentViewfinderFrame().padding(Spacing.xxl * 1.5) }
                .accessibilityLabel(Text(String(localized: "student.checkin.viewfinder", defaultValue: "Видоискатель камеры")))

                Text(String(localized: "student.checkin.hint", defaultValue: "Наведите камеру на QR-код, который преподаватель показывает на занятии"))
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)

                Button {
                    code = ""
                    isEnteringCode = true
                } label: {
                    Label(String(localized: "student.checkin.enterCode", defaultValue: "Ввести код"), systemImage: "keyboard")
                }
                .controlSize(.large)
                .glassButton()
            }
        }
    }

    @ViewBuilder
    private func doneCard(_ result: StudentCheckInResultDTO) -> some View {
        let subject = result.subject.map { [$0] } ?? []
        if result.status == "PRESENT" {
            resultCard(
                symbol: "checkmark.circle.fill",
                tint: Palette.success,
                title: result.already == true
                    ? String(localized: "student.checkin.already", defaultValue: "Вы уже отмечены")
                    : String(localized: "student.checkin.success", defaultValue: "Вы отмечены на занятии"),
                lines: subject
            )
        } else {
            // Самоотметка не перетирает отметку преподавателя: зелёное «Вы отмечены»
            // при опоздании или пропуске было бы неправдой.
            resultCard(
                symbol: "info.circle",
                tint: Palette.mutedForeground,
                title: String(localized: "student.checkin.alreadyOther", defaultValue: "Отметка уже стоит: \(AttendanceStatus.title(result.status))"),
                lines: subject + [String(localized: "student.checkin.alreadyOtherHint", defaultValue: "Самоотметка её не меняет. Если это ошибка — скажите преподавателю.")]
            )
        }
    }

    private func resultCard(symbol: String?, tint: Color, title: String, lines: [String] = []) -> some View {
        VStack(spacing: Spacing.md) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 56, weight: .semibold))
                    .foregroundStyle(tint)
                    .symbolEffect(.bounce, value: title)
                    .accessibilityHidden(true)
            } else {
                ProgressView().controlSize(.large)
            }
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.center)
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(Spacing.xxl)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    @MainActor
    private func checkIn(_ raw: String) async {
        guard state != .loading else { return }
        let token = Self.token(from: raw)
        guard !token.isEmpty else {
            state = .failed(String(localized: "student.checkin.noToken", defaultValue: "Отсканируйте QR-код, показанный преподавателем на занятии."))
            return
        }
        state = .loading
        do {
            state = .done(try await StudentStudyAPI().checkIn(token: token))
        } catch {
            state = .failed(Self.message(for: error))
        }
    }

    /// Код из содержимого QR: ссылка `…/checkin?t=…` или сам код.
    static func token(from raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let components = URLComponents(string: trimmed),
           components.scheme != nil,
           let value = components.queryItems?.first(where: { $0.name == "t" })?.value {
            return value
        }
        return trimmed
    }

    /// Отказы самоотметки — своими словами: общие тексты кодов написаны для других экранов.
    private static func message(for error: Error) -> String {
        switch (error as? APIError)?.code {
        case .badRequest?, .validationError?, .notFound?:
            return String(localized: "student.checkin.error.invalid", defaultValue: "Код недействителен или устарел. Попросите преподавателя обновить QR и отсканируйте снова.")
        case .conflict?:
            return String(localized: "student.checkin.error.closed", defaultValue: "Отметка по этому коду закрыта: занятие отменено или окно отметки уже прошло.")
        case .wrongScope?:
            return String(localized: "student.checkin.error.wrongGroup", defaultValue: "Это занятие другой группы — отметиться на нём нельзя.")
        case .forbidden?:
            return String(localized: "student.checkin.error.forbidden", defaultValue: "Самоотметка доступна только студентам.")
        default:
            return error.userMessage
        }
    }
}

/// Уголки видоискателя поверх камеры — как у сканера кодов в системной «Камере».
private struct StudentViewfinderFrame: View {
    var body: some View {
        GeometryReader { proxy in
            Self.corners(in: proxy.size)
                .stroke(.white, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                .shadow(color: .black.opacity(0.3), radius: 2)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private static func corners(in size: CGSize) -> Path {
        let side: CGFloat = min(size.width, size.height)
        let arm: CGFloat = side * 0.16
        let rect = CGRect(x: (size.width - side) / 2, y: (size.height - side) / 2, width: side, height: side)
        return Path { path in
            // Четыре угла: от края по горизонтали — к вершине — вниз по вертикали.
            path.move(to: CGPoint(x: rect.minX, y: rect.minY + arm))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.minX + arm, y: rect.minY))
            path.move(to: CGPoint(x: rect.maxX - arm, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + arm))
            path.move(to: CGPoint(x: rect.maxX, y: rect.maxY - arm))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.maxX - arm, y: rect.maxY))
            path.move(to: CGPoint(x: rect.minX + arm, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - arm))
        }
    }
}
