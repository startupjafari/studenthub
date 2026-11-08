import SwiftUI

/// Справки «задолженностей нет» (веб `/library/clearances`): какие справки выпустили
/// студенты вуза, с кодом проверки и статусом. Справку можно отозвать с причиной — бумага
/// у человека останется, но проверка по коду покажет «отозвана». Проверка по коду с бланка —
/// тут же.
struct LibrarianClearancesView: View {
    @State private var loader: PagedLoader<LibrarianClearanceDTO>
    @State private var status: String? = "active"
    @State private var revoking: LibrarianClearanceDTO?
    @State private var reason = ""
    @State private var failure: String?
    @State private var notice: String?
    @State private var checking = false

    private static let api = LibrarianAPI()

    init() {
        _loader = State(initialValue: PagedLoader(limit: 30) { request in
            try await Self.api.clearances(request, status: "active")
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "librarian.clear.empty", defaultValue: "Справок ещё не выдавали"),
                symbol: "checkmark.seal"
            ),
            header: {
                FilterChipsRow(
                    options: [
                        ("active", String(localized: "librarian.clear.filterActive", defaultValue: "Действующие")),
                        ("revoked", String(localized: "librarian.clear.filterRevoked", defaultValue: "Отозванные")),
                        ("all", String(localized: "librarian.filter.all", defaultValue: "Все")),
                    ],
                    selection: $status
                )
            },
            row: { item in
                LibrarianClearanceRow(item: item)
                    .swipeActions {
                        if item.revokedAt == nil {
                            Button(role: .destructive) { revoking = item } label: {
                                Label(String(localized: "librarian.clear.revoke", defaultValue: "Отозвать"), systemImage: "xmark.seal")
                            }
                        }
                    }
                    .contextMenu {
                        Button {
                            UIPasteboard.general.string = item.code
                        } label: {
                            Label(String(localized: "librarian.clear.copyCode", defaultValue: "Скопировать код"), systemImage: "doc.on.doc")
                        }
                        if item.revokedAt == nil {
                            Button(role: .destructive) { revoking = item } label: {
                                Label(String(localized: "librarian.clear.revoke", defaultValue: "Отозвать"), systemImage: "xmark.seal")
                            }
                        }
                    }
            }
        )
        .navigationTitle(Text(LibrarianScreen.clearances.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    checking = true
                } label: {
                    Label(String(localized: "librarian.clear.check", defaultValue: "Проверить по коду"), systemImage: "magnifyingglass")
                }
            }
        }
        .sheet(isPresented: $checking) { LibrarianClearanceCheckSheet() }
        .alert(
            revoking.map { String(localized: "librarian.clear.revokeTitle", defaultValue: "Отозвать справку \($0.code) (\($0.reader.name.orDash))?") } ?? "",
            isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } })
        ) {
            TextField(String(localized: "librarian.clear.revokeReason", defaultValue: "Причина: например, книга оказалась не возвращена"), text: $reason)
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) { reason = "" }
            Button(String(localized: "librarian.clear.revoke", defaultValue: "Отозвать"), role: .destructive) {
                guard let item = revoking else { return }
                let text = reason.trimmingCharacters(in: .whitespacesAndNewlines)
                reason = ""
                Task { await revoke(item, reason: text) }
            }
        } message: {
            Text(String(localized: "librarian.reasonHint", defaultValue: "Причина — от 3 до 300 символов, она попадёт в журнал"))
        }
        .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .actionFailureAlert($failure)
        .onChange(of: status) { _, value in
            let status = value ?? "all"
            Task { await loader.replace { request in try await Self.api.clearances(request, status: status) } }
        }
    }

    @MainActor
    private func revoke(_ item: LibrarianClearanceDTO, reason: String) async {
        guard reason.count >= 3 else {
            failure = String(localized: "librarian.reasonTooShort", defaultValue: "Укажите причину — от 3 до 300 символов")
            return
        }
        do {
            _ = try await Self.api.revokeClearance(code: item.code, reason: String(reason.prefix(300)))
            notice = String(localized: "librarian.clear.revokedToast", defaultValue: "Справка отозвана — проверка по коду покажет это")
            await loader.reload()
        } catch {
            failure = LibrarianText.deskMessage(error)
        }
    }
}

private struct LibrarianClearanceRow: View {
    let item: LibrarianClearanceDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: item.code)
                    .font(Typography.cardTitle.monospaced())
                    .foregroundStyle(Palette.foreground)
                    .textSelection(.enabled)
                Spacer(minLength: Spacing.md)
                if let revoked = item.revokedAt {
                    LibrarianBadge(
                        text: String(localized: "librarian.clear.revokedAt", defaultValue: "Отозвана \(DisplayFormat.date(revoked))"),
                        tint: Palette.destructive
                    )
                } else {
                    LibrarianBadge(text: String(localized: "librarian.clear.valid", defaultValue: "Действует"), tint: Palette.success)
                }
            }
            Text(item.reader.name ?? "—")
                .font(Typography.meta)
                .foregroundStyle(Palette.foreground)
            let meta = [
                item.number.map { "№ \($0)" },
                String(localized: "librarian.clear.issued", defaultValue: "Выдана \(DisplayFormat.date(item.issuedAt))"),
            ]
            .compactMap { $0 }
            .joined(separator: " · ")
            Text(meta)
                .font(.caption)
                .foregroundStyle(Palette.mutedForeground)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Проверка справки по коду из бланка: действует или отозвана.
private struct LibrarianClearanceCheckSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var result: LibrarianDocumentCheckDTO?
    @State private var failure: String?
    @State private var isChecking = false

    private let api = LibrarianAPI()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(String(localized: "librarian.clear.codePlaceholder", defaultValue: "Код с бланка"), text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .onSubmit { Task { await check() } }
                    Button {
                        Task { await check() }
                    } label: {
                        if isChecking { ProgressView() } else { Text(String(localized: "librarian.clear.checkSubmit", defaultValue: "Проверить")) }
                    }
                    .disabled(normalized.isEmpty || isChecking)
                } footer: {
                    if let failure { Text(failure).foregroundStyle(Palette.destructive) }
                }

                if let result {
                    Section {
                        Label(
                            result.status == "VALID"
                                ? String(localized: "librarian.clear.valid", defaultValue: "Действует")
                                : String(localized: "librarian.clear.revoked", defaultValue: "Отозвана"),
                            systemImage: result.status == "VALID" ? "checkmark.seal.fill" : "xmark.seal.fill"
                        )
                        .font(Typography.sectionTitle)
                        .foregroundStyle(result.status == "VALID" ? Palette.success : Palette.destructive)
                        if let subject = result.subject {
                            DetailRow(title: String(localized: "librarian.clear.subject", defaultValue: "Кому выдана"), value: subject)
                        }
                        if let number = result.number {
                            DetailRow(title: String(localized: "librarian.clear.number", defaultValue: "Номер"), value: number)
                        }
                        if let issuer = result.issuer {
                            DetailRow(title: String(localized: "librarian.clear.issuer", defaultValue: "Кем выдана"), value: issuer)
                        }
                        if let issued = result.issuedAt {
                            DetailRow(title: String(localized: "librarian.clear.issuedAt", defaultValue: "Дата выдачи"), value: DisplayFormat.date(issued))
                        }
                        if let revoked = result.revokedAt {
                            DetailRow(title: String(localized: "librarian.clear.revokedOn", defaultValue: "Дата отзыва"), value: DisplayFormat.date(revoked))
                        }
                    }
                }
            }
            .navigationTitle(Text(String(localized: "librarian.clear.check", defaultValue: "Проверить по коду")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "librarian.close", defaultValue: "Закрыть")) { dismiss() }
                }
            }
        }
    }

    /// Код переписывают с бумаги с пробелами и дефисами — сервер их не убирает.
    private var normalized: String {
        code.uppercased().filter { !$0.isWhitespace && $0 != "-" }
    }

    @MainActor
    private func check() async {
        let value = normalized
        guard !value.isEmpty else { return }
        isChecking = true
        defer { isChecking = false }
        do {
            result = try await api.checkDocument(code: value)
            failure = nil
        } catch {
            result = nil
            failure = (error as? APIError)?.code == .notFound
                ? String(localized: "librarian.clear.notFound", defaultValue: "Документ с таким кодом не найден")
                : error.userMessage
        }
    }
}
