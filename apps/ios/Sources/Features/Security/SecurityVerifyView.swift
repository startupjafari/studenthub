import SwiftUI

/// Проверка студенческого (веб `/verify-id`): камера читает QR из приложения студента,
/// сервер подтверждает карту и решает о проходе. Без камеры — вставить ссылку из QR.
///
/// Проверка гасит одноразовый код, поэтому результат — снимок на момент скана и не
/// перезапрашивается: повтор показал бы «уже проверен» вместо выданного «Пропустить».
struct SecurityVerifyView: View {
    /// Токен из общего сканера: проверка начинается сразу.
    var initialToken: String?

    private enum Phase: Equatable {
        case scanning
        case checking
        case verified(SecurityVerifiedCardDTO)
        case failed(String)
    }

    @State private var phase: Phase = .scanning
    @State private var round = 0
    @State private var cameraUnavailable = false
    @State private var rejectNotice: String?
    @State private var manual = ""
    @State private var manualInvalid = false
    @State private var startedInitial = false

    private let api = SecurityAPI()

    var body: some View {
        Group {
            switch phase {
            case .scanning:
                scanner
            case .checking:
                LoadingStateView(title: String(localized: "security.verify.loading", defaultValue: "Проверяем студенческий…"))
            case .verified(let card):
                SecurityVerifiedCardView(card: card) { scanAnother() }
            case .failed(let message):
                failure(message)
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(SecurityScreen.verifyID.title))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard !startedInitial, let initialToken, !initialToken.isEmpty else { return }
            startedInitial = true
            await verify(initialToken)
        }
    }

    private var scanner: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                ZStack {
                    if cameraUnavailable {
                        VStack(spacing: Spacing.md) {
                            Image(systemName: "video.slash").font(.largeTitle)
                            Text(String(localized: "security.scan.cameraUnavailable", defaultValue: "Камера недоступна. Разрешите доступ к камере в настройках или вставьте ссылку из QR ниже."))
                                .font(Typography.meta)
                                .multilineTextAlignment(.center)
                        }
                        .foregroundStyle(Palette.mutedForeground)
                        .padding(Spacing.xl)
                    } else {
                        QRScannerView(onScan: handleScan, onUnavailable: { cameraUnavailable = true })
                            .id(round)
                        RoundedRectangle(cornerRadius: Radius.xxl)
                            .strokeBorder(.white.opacity(0.85), lineWidth: 3)
                            .frame(width: 220, height: 220)
                            .allowsHitTesting(false)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 340)
                .background(cameraUnavailable ? Palette.card : .black)
                .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))

                VStack(spacing: Spacing.xs) {
                    Text(String(localized: "security.verify.scanTitle", defaultValue: "Проверка студенческого"))
                        .font(Typography.sectionTitle)
                    Text(String(localized: "security.verify.scanHint", defaultValue: "Наведите камеру на QR-код студенческого билета"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .multilineTextAlignment(.center)
                    if let rejectNotice {
                        Label(rejectNotice, systemImage: "exclamationmark.triangle")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.warning)
                    }
                }

                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text(String(localized: "security.verify.manualTitle", defaultValue: "Без камеры"))
                        .font(Typography.cardTitle)
                    Text(String(localized: "security.verify.manualHint", defaultValue: "Вставьте ссылку из QR студенческого"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                    HStack {
                        TextField(String(localized: "security.verify.manualPlaceholder", defaultValue: "Ссылка или код из QR"), text: $manual)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .onSubmit(submitManual)
                            .padding(Spacing.md)
                            .background(Palette.background, in: RoundedRectangle(cornerRadius: Radius.md))
                        Button(String(localized: "security.verify.manualSubmit", defaultValue: "Проверить"), action: submitManual)
                            .buttonStyle(.borderedProminent)
                            .disabled(manual.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    if manualInvalid {
                        FieldError(message: String(localized: "security.verify.manualInvalid", defaultValue: "Это не код студенческого — отсканируйте QR из приложения студента"))
                    }
                }
                .padding(Spacing.xl)
                .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
            }
            .padding(Spacing.xl)
        }
    }

    private func failure(_ message: String) -> some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 44))
                .foregroundStyle(Palette.destructive)
            // Охране отказ проверки — это отказ в проходе: так и пишем, крупно.
            Text(String(localized: "security.verify.entryDenied", defaultValue: "Не пропускать"))
                .font(.title.weight(.bold))
                .foregroundStyle(Palette.destructive)
            Text(String(localized: "security.verify.failed", defaultValue: "Не удалось подтвердить"))
                .font(Typography.sectionTitle)
            Text(message)
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
            Button {
                scanAnother()
            } label: {
                Label(String(localized: "security.verify.scanAnother", defaultValue: "Проверить ещё"), systemImage: "qrcode.viewfinder")
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(Spacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func handleScan(_ raw: String) {
        if case .studentID(let token) = SecurityQRTarget.parse(raw) {
            rejectNotice = nil
            Task { await verify(token) }
        } else {
            // Здесь проверяют только билеты: вход и наклейки — в общем сканере.
            rejectNotice = String(localized: "security.verify.notStudentID", defaultValue: "Это не QR студенческого билета")
            round += 1
        }
    }

    private func submitManual() {
        let raw = manual.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return }
        if case .studentID(let token) = SecurityQRTarget.parse(raw) {
            manualInvalid = false
            manual = ""
            Task { await verify(token) }
        } else if !raw.contains("/"), !raw.contains(" "), raw.count >= 16, raw.count <= 2048 {
            // Ручной сканер на посту «печатает» содержимое QR — иногда только сам код.
            manualInvalid = false
            manual = ""
            Task { await verify(raw) }
        } else {
            manualInvalid = true
        }
    }

    private func scanAnother() {
        phase = .scanning
        rejectNotice = nil
        round += 1
    }

    @MainActor
    private func verify(_ token: String) async {
        phase = .checking
        do {
            phase = .verified(try await api.verify(token: token))
        } catch {
            phase = .failed(Self.message(for: error))
        }
    }

    /// QR — разовый пропуск: код, уже проверенный другим сотрудником, отвечает 409. Битый,
    /// чужой или истёкший код сервер отдаёт как UNAUTHORIZED или BAD_REQUEST — общие тексты
    /// этих кодов здесь врут, это «код недействителен или истёк».
    static func message(for error: Error) -> String {
        switch (error as? APIError)?.code {
        case .conflict?:
            return String(localized: "security.verify.alreadyUsed", defaultValue: "Этот код уже проверил другой сотрудник. Попросите студента обновить карту.")
        case .unauthorized?, .badRequest?, .tokenExpired?:
            return String(localized: "security.verify.failedHint", defaultValue: "Код недействителен или истёк.")
        default:
            return error.userMessage
        }
    }
}

/// Подтверждённая карта студента: решение о проходе крупно, затем поля карты.
private struct SecurityVerifiedCardView: View {
    let card: SecurityVerifiedCardDTO
    let scanAnother: () -> Void

    var body: some View {
        List {
            if let entry = card.entry {
                Section {
                    VStack(spacing: Spacing.xs) {
                        Label(
                            entry.allowed
                                ? String(localized: "security.verify.entryAllowed", defaultValue: "Пропустить")
                                : String(localized: "security.verify.entryDenied", defaultValue: "Не пропускать"),
                            systemImage: entry.allowed ? "checkmark.shield.fill" : "xmark.shield.fill"
                        )
                        .font(.title2.weight(.bold))
                        if !entry.allowed {
                            Text(entry.denyReason.map { SecurityText.denyReason($0) }
                                ?? String(localized: "security.verify.entryDeniedStatus", defaultValue: "Учебный статус: не учится в вузе"))
                                .font(Typography.meta)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .foregroundStyle(entry.allowed ? Palette.success : Palette.destructive)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.md)
                }
                .listRowBackground((entry.allowed ? Palette.success : Palette.destructive).opacity(0.14))
            }

            Section {
                Label(String(localized: "security.verify.verifiedBadge", defaultValue: "Подтверждено StudentHub"), systemImage: "checkmark.seal.fill")
                    .font(Typography.meta.weight(.semibold))
                    .foregroundStyle(Palette.success)
                    .frame(maxWidth: .infinity)
            }
            .listRowBackground(Palette.success.opacity(0.1))

            Section {
                HStack(spacing: Spacing.lg) {
                    AvatarView(url: card.avatarUrl, name: card.fullName, size: 72)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(card.fullName)
                            .font(Typography.sectionTitle)
                            .foregroundStyle(Palette.foreground)
                        Text(card.universityShort ?? card.university ?? "")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                        Text(status)
                            .font(Typography.meta.weight(.semibold))
                            .foregroundStyle(card.academicStatus == nil ? Palette.success : Palette.warning)
                    }
                }
                .padding(.vertical, Spacing.xs)
                ForEach(rows, id: \.0) { row in
                    DetailRow(title: row.0, value: row.1)
                }
            }
            .listRowBackground(Palette.card)

            Section {
                if let at = card.verifiedAt {
                    Label(
                        String(localized: "security.verify.verifiedAt", defaultValue: "Проверено: \(DisplayFormat.dateTime(at))"),
                        systemImage: "clock"
                    )
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                }
                Button(action: scanAnother) {
                    Label(String(localized: "security.verify.scanAnother", defaultValue: "Проверить ещё"), systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
    }

    private var status: String {
        switch card.academicStatus {
        case nil: return String(localized: "security.card.statusActive", defaultValue: "Активен · Обучается")
        case "ACADEMIC_LEAVE": return String(localized: "security.card.statusLeave", defaultValue: "Академический отпуск")
        case "EXPELLED": return String(localized: "security.card.statusExpelled", defaultValue: "Отчислен")
        case "GRADUATED": return String(localized: "security.card.statusGraduated", defaultValue: "Выпускник")
        case "TRANSFERRED": return String(localized: "security.card.statusTransferred", defaultValue: "Переведён")
        case .some(let raw): return raw
        }
    }

    private var rows: [(String, String)] {
        var rows: [(String, String)] = []
        func add(_ title: String, _ value: String?) {
            if let value, !value.isEmpty { rows.append((title, value)) }
        }
        add(String(localized: "security.card.number", defaultValue: "№ студенческого"), card.studentCardNumber)
        add(String(localized: "security.card.faculty", defaultValue: "Факультет"), card.faculty)
        add(String(localized: "security.card.group", defaultValue: "Группа"), card.group)
        add(String(localized: "security.card.course", defaultValue: "Курс"), card.course.map { String($0) })
        add(String(localized: "security.card.specialty", defaultValue: "Специальность"), card.specialty)
        add(String(localized: "security.card.level", defaultValue: "Уровень"), card.educationLevel.map(Self.level))
        add(String(localized: "security.card.form", defaultValue: "Форма обучения"), card.studyForm.map(Self.form))
        add(String(localized: "security.card.funding", defaultValue: "Финансирование"), card.fundingType.map(Self.funding))
        add(String(localized: "security.card.dormitory", defaultValue: "Общежитие"), card.dormitory)
        if let start = card.enrollmentYear {
            let years = card.graduationYear.map { "\(String(start))–\(String($0))" } ?? String(start)
            add(String(localized: "security.card.years", defaultValue: "Годы обучения"), years)
        }
        if let birth = card.birthDate {
            let shown = Self.birthDate(birth)
            let declared = card.selfDeclared?.contains("birthDate") == true
                ? "\(shown) (\(String(localized: "security.card.selfDeclared", defaultValue: "со слов студента")))"
                : shown
            add(String(localized: "security.card.birthDate", defaultValue: "Дата рождения"), declared)
        }
        return rows
    }

    private static func birthDate(_ raw: String) -> String {
        let day = String(raw.prefix(10))
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return raw }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        guard let date = Calendar.current.date(from: components) else { return raw }
        return date.formatted(.dateTime.day().month(.wide).year())
    }

    private static func level(_ raw: String) -> String {
        switch raw {
        case "BACHELOR": return String(localized: "security.card.levelBachelor", defaultValue: "Бакалавриат")
        case "MASTER": return String(localized: "security.card.levelMaster", defaultValue: "Магистратура")
        case "PHD": return String(localized: "security.card.levelPhd", defaultValue: "Докторантура (PhD)")
        default: return raw
        }
    }

    private static func form(_ raw: String) -> String {
        switch raw {
        case "FULL_TIME": return String(localized: "security.card.formFull", defaultValue: "Очная")
        case "PART_TIME": return String(localized: "security.card.formPart", defaultValue: "Заочная")
        case "DISTANCE": return String(localized: "security.card.formDistance", defaultValue: "Дистанционная")
        default: return raw
        }
    }

    private static func funding(_ raw: String) -> String {
        switch raw {
        case "GRANT": return String(localized: "security.card.fundingGrant", defaultValue: "Грант")
        case "PAID": return String(localized: "security.card.fundingPaid", defaultValue: "Платное")
        case "QUOTA": return String(localized: "security.card.fundingQuota", defaultValue: "Квота")
        default: return raw
        }
    }
}

// MARK: - Общий сканер

/// Сканер StudentHub для охраны (веб `/scan`): студенческий — на проверку, наклейка
/// помещения — к «что сейчас идёт», вход на компьютере — к подтверждению входа.
struct SecurityScanView: View {
    @State private var round = 0
    @State private var unavailable = false
    @State private var notice: String?
    @State private var verifyToken: String?
    @State private var roomCode: String?
    @State private var approvingLogin = false

    var body: some View {
        VStack(spacing: Spacing.xl) {
            ZStack {
                if unavailable {
                    ContentUnavailableView(
                        String(localized: "security.scan.noCamera", defaultValue: "Нет доступа к камере"),
                        systemImage: "video.slash",
                        description: Text(String(localized: "security.scan.noCameraHint", defaultValue: "Разрешите доступ к камере в настройках iPhone."))
                    )
                } else {
                    QRScannerView(onScan: handle, onUnavailable: { unavailable = true })
                        .id(round)
                    RoundedRectangle(cornerRadius: Radius.xxl)
                        .strokeBorder(.white.opacity(0.85), lineWidth: 3)
                        .frame(width: 230, height: 230)
                        .allowsHitTesting(false)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(unavailable ? Palette.card : .black)
            .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))

            VStack(spacing: Spacing.xs) {
                Text(String(localized: "security.scan.hint", defaultValue: "Наведите камеру на QR StudentHub: студенческий, наклейка помещения или вход на компьютере"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                if let notice {
                    Label(notice, systemImage: "exclamationmark.triangle")
                        .font(Typography.meta)
                        .foregroundStyle(Palette.warning)
                }
            }
        }
        .padding(Spacing.xl)
        .background(Palette.background)
        .navigationTitle(Text(SecurityScreen.scan.title))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $verifyToken) { token in
            SecurityVerifyView(initialToken: token)
        }
        .navigationDestination(item: $roomCode) { code in
            SecurityRoomStatusView(code: code)
        }
        .sheet(isPresented: $approvingLogin, onDismiss: { round += 1 }) {
            QRApproveView()
        }
        .onChange(of: verifyToken) { _, value in if value == nil { round += 1 } }
        .onChange(of: roomCode) { _, value in if value == nil { round += 1 } }
    }

    private func handle(_ raw: String) {
        switch SecurityQRTarget.parse(raw) {
        case .studentID(let token):
            notice = nil
            verifyToken = token
        case .room(let code):
            notice = nil
            roomCode = code
        case .login:
            // Подтверждение входа живёт своим экраном со своим сканером: там же
            // предупреждение, чьё устройство просит вход.
            notice = String(localized: "security.scan.loginHint", defaultValue: "Это вход на компьютере — отсканируйте код ещё раз в окне подтверждения")
            approvingLogin = true
        case .other:
            notice = String(localized: "security.scan.notStudentHub", defaultValue: "Это не QR StudentHub")
            round += 1
        }
    }
}
