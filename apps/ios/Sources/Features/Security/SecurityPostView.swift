import SwiftUI

/// «Пост охраны» — стартовый экран роли (веб `/security`): проверка студенческого первой и
/// самой крупной кнопкой, сводка за сегодня, свежие проходы и посетители в здании с
/// отметкой выхода. Полные журналы — отдельными экранами.
struct SecurityPostView: View {
    @State private var summary: SecuritySummaryDTO?
    @State private var passes: [SecurityPassDTO] = []
    @State private var visitors: [SecurityVisitorDTO] = []
    @State private var insideTotal: Int?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var loaded = false
    @State private var recording = false
    @State private var exiting: Set<String> = []
    @State private var actionFailure: String?
    @State private var notice: String?

    private let api = SecurityAPI()
    private static let passPreview = 8
    private static let visitorPreview = 30

    var body: some View {
        List {
            Section {
                NavigationLink(value: AppRoute.security(.verifyID)) {
                    SecurityVerifyHero()
                }
                .listRowBackground(Palette.primary)
                .accessibilityIdentifier("security.verify")
            }

            if let notice {
                Section {
                    Label(notice, systemImage: "checkmark.circle.fill")
                        .font(Typography.meta)
                        .foregroundStyle(Palette.success)
                }
                .listRowBackground(Palette.card)
            }

            if loaded || summary != nil {
                Section {
                    StatGrid {
                        StatTile(
                            title: String(localized: "security.metric.allowed", defaultValue: "Прошли"),
                            value: summary.map { $0.passes.allowed.formatted() } ?? "—",
                            symbol: "checkmark.shield",
                            tint: Palette.success,
                            caption: String(localized: "security.metric.today", defaultValue: "за сегодня")
                        )
                        StatTile(
                            title: String(localized: "security.metric.denied", defaultValue: "Отказано"),
                            value: summary.map { $0.passes.denied.formatted() } ?? "—",
                            symbol: "xmark.shield",
                            tint: Palette.destructive,
                            caption: String(localized: "security.metric.today", defaultValue: "за сегодня")
                        )
                        StatTile(
                            title: String(localized: "security.metric.inside", defaultValue: "Посетителей в здании"),
                            value: summary.map { $0.visitors.inside.formatted() } ?? "—",
                            symbol: "person.2",
                            caption: summary.map {
                                String(
                                    localized: "security.metric.visitorsToday",
                                    defaultValue: "за сегодня: \($0.visitors.today.formatted())"
                                )
                            }
                        )
                        StatTile(
                            title: String(localized: "security.metric.passes", defaultValue: "Проверок"),
                            value: summary.map { $0.passes.total.formatted() } ?? "—",
                            symbol: "qrcode.viewfinder",
                            tint: Palette.info,
                            caption: String(localized: "security.metric.today", defaultValue: "за сегодня")
                        )
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                if let failure {
                    StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }

                passesSection
                visitorsSection
                shortcutsSection
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(SecurityScreen.post.title))
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    recording = true
                } label: {
                    Image(systemName: "person.badge.plus")
                }
                .accessibilityLabel(Text(String(localized: "security.recordVisitor", defaultValue: "Записать посетителя")))
            }
        }
        .sheet(isPresented: $recording) {
            SecurityRecordVisitorSheet { visitor in
                notice = String(localized: "security.visitorRecorded", defaultValue: "\(visitor.fullName) — записан на входе")
                await load()
            }
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task { await load() }
    }

    private var passesSection: some View {
        Section {
            if passes.isEmpty {
                Text(String(localized: "security.passes.empty", defaultValue: "Проходов пока нет. Проверенные студенческие появятся здесь — и пропущенные, и отказы"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            ForEach(passes) { pass in
                SecurityPassRow(pass: pass)
            }
            NavigationLink(value: AppRoute.security(.passes)) {
                Text(String(localized: "security.passes.all", defaultValue: "Весь журнал проходов"))
                    .foregroundStyle(Palette.primary)
            }
        } header: {
            Text(String(localized: "security.passes.title", defaultValue: "Проходы студентов"))
        } footer: {
            Text(String(localized: "security.passes.hint", defaultValue: "Каждая проверка студенческого на входе, новые сверху"))
        }
        .listRowBackground(Palette.card)
    }

    private var visitorsSection: some View {
        Section {
            if visitors.isEmpty {
                Button {
                    recording = true
                } label: {
                    Label(
                        String(localized: "security.visitors.emptyRecord", defaultValue: "В здании посетителей нет — записать посетителя"),
                        systemImage: "person.badge.plus"
                    )
                }
            }
            ForEach(visitors) { visitor in
                HStack(alignment: .center, spacing: Spacing.md) {
                    SecurityVisitorRow(visitor: visitor)
                    if exiting.contains(visitor.id) {
                        ProgressView()
                    } else {
                        Button {
                            Task { await markExit(visitor) }
                        } label: {
                            Label(String(localized: "security.markExit", defaultValue: "Вышел"), systemImage: "door.left.hand.open")
                                .labelStyle(.titleAndIcon)
                                .font(Typography.meta.weight(.semibold))
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .swipeActions {
                    Button {
                        Task { await markExit(visitor) }
                    } label: {
                        Label(String(localized: "security.markExit", defaultValue: "Вышел"), systemImage: "door.left.hand.open")
                    }
                    .tint(Palette.success)
                }
            }
            NavigationLink(value: AppRoute.security(.visitors)) {
                Text(String(localized: "security.visitors.all", defaultValue: "Журнал посетителей"))
                    .foregroundStyle(Palette.primary)
            }
        } header: {
            Text(String(localized: "security.visitors.title", defaultValue: "Посетители в здании"))
        } footer: {
            if let insideTotal, insideTotal > visitors.count {
                Text(String(
                    localized: "security.visitors.more",
                    defaultValue: "Показаны \(visitors.count.formatted()) из \(insideTotal.formatted()) — остальные в журнале"
                ))
            } else {
                Text(String(localized: "security.visitors.hint", defaultValue: "Вошли и ещё не отмечены на выходе"))
            }
        }
        .listRowBackground(Palette.card)
    }

    private var shortcutsSection: some View {
        Section {
            ForEach([SecurityScreen.scan, .cameras, .rooms], id: \.self) { screen in
                NavigationLink(value: AppRoute.security(screen)) {
                    IconRow(title: screen.title, symbol: screen.symbol, tint: TileTint.gray)
                }
            }
        }
        .listRowBackground(Palette.card)
    }

    @MainActor
    private func load() async {
        do {
            async let summaryTask = api.summary()
            async let passesTask = api.passes(PageRequest(cursor: nil, page: 1, limit: Self.passPreview))
            async let visitorsTask = api.visitors(PageRequest(cursor: nil, page: 1, limit: Self.visitorPreview), status: "inside")
            let (s, p, v) = try await (summaryTask, passesTask, visitorsTask)
            summary = s
            passes = p.items
            visitors = v.items
            insideTotal = v.meta?.total
            failure = nil
            isOffline = false
            loaded = true
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func markExit(_ visitor: SecurityVisitorDTO) async {
        guard !exiting.contains(visitor.id) else { return }
        exiting.insert(visitor.id)
        defer { exiting.remove(visitor.id) }
        do {
            let saved = try await api.markExit(visitorID: visitor.id)
            notice = String(localized: "security.visitorExited", defaultValue: "\(saved.fullName) — выход отмечен")
            await load()
        } catch {
            // Выход уже отметил сменщик — журнал устарел, просто обновить его.
            if let api = error as? APIError, api.code == .conflict {
                actionFailure = String(localized: "security.visitorAlreadyExited", defaultValue: "Выход уже отметили — журнал обновлён")
                await load()
            } else {
                actionFailure = error.userMessage
            }
        }
    }
}

/// Крупная кнопка проверки студенческого — главное действие на входе.
private struct SecurityVerifyHero: View {
    var body: some View {
        HStack(spacing: Spacing.lg) {
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 34, weight: .semibold))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(String(localized: "security.verifyTitle", defaultValue: "Проверка студенческого"))
                    .font(.title3.weight(.semibold))
                Text(String(localized: "security.verifyHint", defaultValue: "Наведите камеру на QR в приложении студента"))
                    .font(Typography.meta)
                    .opacity(0.85)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(Palette.primaryForeground)
        .padding(.vertical, Spacing.lg)
    }
}

/// Запись посетителя на входе. Документ — только тип и четыре последние цифры: полный
/// номер и ИИН не записываются, поле их и не примет.
struct SecurityRecordVisitorSheet: View {
    let recorded: (SecurityVisitorDTO) async -> Void

    @State private var fullName = ""
    @State private var purpose = ""
    @State private var documentType: String?
    @State private var last4 = ""
    @State private var phoneDigits = ""

    private let api = SecurityAPI()

    var body: some View {
        FormSheet(
            title: String(localized: "security.recordVisitor", defaultValue: "Записать посетителя"),
            saveTitle: String(localized: "security.recordVisitorSubmit", defaultValue: "Записать"),
            canSave: isValid,
            save: save
        ) {
            Section {
                TextField(String(localized: "security.visitor.name", defaultValue: "ФИО"), text: $fullName)
                    .textContentType(.name)
                    .autocorrectionDisabled()
                TextField(
                    String(localized: "security.visitor.purpose", defaultValue: "К кому и зачем"),
                    text: $purpose,
                    prompt: Text(String(localized: "security.visitor.purposePlaceholder", defaultValue: "Например: в деканат ФИТ, к Ахметову")),
                    axis: .vertical
                )
                .lineLimit(1...4)
            } footer: {
                if !fullName.isEmpty, !nameValid {
                    Text(String(localized: "security.visitor.nameInvalid", defaultValue: "Укажите ФИО: от 2 до 150 символов"))
                        .foregroundStyle(Palette.destructive)
                } else if !purpose.isEmpty, !purposeValid {
                    Text(String(localized: "security.visitor.purposeInvalid", defaultValue: "Укажите, к кому и зачем: от 2 до 300 символов"))
                        .foregroundStyle(Palette.destructive)
                }
            }
            .listRowBackground(Palette.card)

            Section {
                Picker(String(localized: "security.visitor.document", defaultValue: "Документ"), selection: $documentType) {
                    Text(String(localized: "security.visitor.docNone", defaultValue: "Не предъявлен")).tag(String?.none)
                    ForEach(SecurityText.documentTypes, id: \.self) { type in
                        Text(SecurityText.documentType(type)).tag(String?.some(type))
                    }
                }
                if documentType != nil {
                    TextField(String(localized: "security.visitor.last4", defaultValue: "4 последние цифры"), text: $last4)
                        .keyboardType(.numberPad)
                        .onChange(of: last4) { _, value in
                            let digits = String(value.filter(\.isNumber).prefix(4))
                            if digits != value { last4 = digits }
                        }
                }
            } footer: {
                if !last4.isEmpty, last4.count != 4 {
                    Text(String(localized: "security.visitor.last4Invalid", defaultValue: "Ровно 4 цифры"))
                        .foregroundStyle(Palette.destructive)
                } else {
                    Text(String(localized: "security.visitor.docHint", defaultValue: "Полный номер документа и ИИН не записываются — только тип и 4 последние цифры"))
                }
            }
            .listRowBackground(Palette.card)

            Section {
                HStack(spacing: Spacing.sm) {
                    Text(verbatim: "+7")
                        .foregroundStyle(Palette.mutedForeground)
                    TextField(String(localized: "security.visitor.phone", defaultValue: "Телефон (необязательно)"), text: $phoneDigits)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .onChange(of: phoneDigits) { _, value in
                            var digits = value.filter(\.isNumber)
                            // Вставили номер целиком с «+7» или «8» впереди — код страны уже стоит.
                            if digits.count == 11, digits.first == "7" || digits.first == "8" { digits.removeFirst() }
                            digits = String(digits.prefix(10))
                            if digits != value { phoneDigits = digits }
                        }
                }
            } footer: {
                if !phoneDigits.isEmpty, phoneDigits.count != 10 {
                    Text(String(localized: "security.visitor.phoneInvalid", defaultValue: "Номер целиком: +7 (777) 777-77-77"))
                        .foregroundStyle(Palette.destructive)
                }
            }
            .listRowBackground(Palette.card)
        }
    }

    private var trimmedName: String { fullName.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedPurpose: String { purpose.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var nameValid: Bool { (2...150).contains(trimmedName.count) }
    private var purposeValid: Bool { (2...300).contains(trimmedPurpose.count) }

    private var isValid: Bool {
        nameValid && purposeValid
            && (last4.isEmpty || last4.count == 4)
            && (phoneDigits.isEmpty || phoneDigits.count == 10)
    }

    /// Маска поля телефона в вебе: +7 (777) 777-77-77 — схема сервера ждёт ровно её.
    private var formattedPhone: String? {
        guard phoneDigits.count == 10 else { return nil }
        let d = Array(phoneDigits)
        return "+7 (\(String(d[0..<3]))) \(String(d[3..<6]))-\(String(d[6..<8]))-\(String(d[8..<10]))"
    }

    @MainActor
    private func save() async throws {
        let visitor = SecurityNewVisitor(
            fullName: trimmedName,
            purpose: trimmedPurpose,
            documentType: documentType,
            documentLast4: documentType == nil || last4.isEmpty ? nil : last4,
            phone: formattedPhone
        )
        let saved = try await api.recordVisitor(visitor)
        await recorded(saved)
    }
}
