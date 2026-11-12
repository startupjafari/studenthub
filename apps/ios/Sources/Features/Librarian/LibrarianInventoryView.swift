import SwiftUI

/// Инвентаризация сканом (веб `/library/inventory`): библиотекарь идёт вдоль полок и
/// сканирует наклейки — экземпляр отмечен «на месте». Ход с даты начала: сколько отмечено и
/// что из «должно стоять на полке» не нашли. Статус экземпляра сканом не меняется:
/// выданный, утерянный или списанный экземпляр в руках — предупреждение, решает человек.
struct LibrarianInventoryView: View {
    @AppStorage("librarian.inventorySince") private var sinceRaw = ""
    @State private var report: LibrarianInventoryReportDTO?
    @State private var missing: [LibrarianInventoryMissingDTO] = []
    @State private var page = 1
    @State private var failure: String?
    @State private var isOffline = false
    @State private var loadingMore = false
    @State private var manual = ""
    @State private var manualFailure: String?
    @State private var isMarking = false
    @State private var recent: [LibrarianInventoryScanDTO] = []
    @State private var scanning = false

    private let api = LibrarianAPI()
    private static let pageLimit = 50
    /// Сколько последних сканов держим на экране.
    private static let recentLimit = 20

    var body: some View {
        List {
            Section {
                DatePicker(
                    String(localized: "librarian.inv.since", defaultValue: "Начало инвентаризации"),
                    selection: sinceBinding,
                    in: ...Date(),
                    displayedComponents: .date
                )
                Button {
                    scanning = true
                } label: {
                    Label(String(localized: "librarian.inv.scan", defaultValue: "Сканировать"), systemImage: "qrcode.viewfinder")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.xs)
                }
                .glassProminentButton()
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            Section {
                if let report {
                    let fraction = report.expected > 0 ? Double(report.checked) / Double(report.expected) : 0
                    ShareBar(
                        title: String(localized: "librarian.inv.checked", defaultValue: "Отмечено \(report.checked.formatted()) из \(report.expected.formatted())"),
                        fraction: fraction,
                        valueText: report.expected > 0 ? fraction.formatted(.percent.precision(.fractionLength(0))) : "—"
                    )
                    if report.onLoan > 0 {
                        Text(String(localized: "librarian.inv.onLoan", defaultValue: "На руках: \(report.onLoan.formatted()) — их на полке не ищут"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                } else if let failure {
                    ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            } header: {
                Text(String(localized: "librarian.inv.progressSince", defaultValue: "Ход с \(since.formatted(.dateTime.day().month(.wide)))"))
            } footer: {
                Text(String(localized: "librarian.inv.progressHint", defaultValue: "Экземпляры, которые должны быть в библиотеке: на полке и под бронью"))
            }

            Section {
                TextField(String(localized: "librarian.inv.numberPlaceholder", defaultValue: "Например, 1024"), text: $manual)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onSubmit { Task { await markManual() } }
                Button {
                    Task { await markManual() }
                } label: {
                    if isMarking { ProgressView() } else { Text(String(localized: "librarian.inv.mark", defaultValue: "Отметить")) }
                }
                .disabled(manual.trimmingCharacters(in: .whitespaces).isEmpty || isMarking)
            } header: {
                Text(String(localized: "librarian.inv.manual", defaultValue: "Отметить по инвентарному номеру"))
            } footer: {
                if let manualFailure {
                    Text(manualFailure).foregroundStyle(Palette.destructive)
                } else {
                    Text(String(localized: "librarian.inv.manualHint", defaultValue: "Наклейка стёрлась — введите инвентарный номер"))
                }
            }

            Section {
                if recent.isEmpty {
                    Text(String(localized: "librarian.inv.recentEmpty", defaultValue: "Отсканируйте первую наклейку — отмеченные появятся здесь"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                ForEach(recent) { LibrarianInventoryScanRow(item: $0) }
            } header: {
                Text(String(localized: "librarian.inv.recent", defaultValue: "Только что отмечены"))
            } footer: {
                Text(String(localized: "librarian.inv.recentHint", defaultValue: "Предупреждение — повод разобраться: статус сканом не меняется"))
            }

            Section {
                if report != nil, missing.isEmpty {
                    IconRow(title: String(localized: "librarian.inv.allFound", defaultValue: "Всё на месте"), symbol: "checkmark", tint: TileTint.green)
                }
                ForEach(missing) { item in
                    NavigationLink(value: AppRoute.librarian(.book(id: item.book.id))) {
                        TelegramStyleRow(
                            title: item.book.title,
                            subtitle: [
                                item.book.authors.isEmpty ? nil : item.book.authors,
                                item.inventoriedAt.map {
                                    String(localized: "librarian.inv.lastSeen", defaultValue: "Последняя отметка: \(DisplayFormat.date($0))")
                                } ?? String(localized: "librarian.inv.neverSeen", defaultValue: "ещё не инвентаризировался"),
                            ]
                            .compactMap { $0 }
                            .joined(separator: "\n"),
                            meta: LibrarianText.inventoryShort(item.inventoryNumber)
                        ) {
                            RowSymbol(symbol: "questionmark", tint: TileTint.orange)
                        } accessory: {
                            if item.status == "RESERVED" {
                                LibrarianBadge(text: String(localized: "librarian.inv.onHoldShelf", defaultValue: "На полке броней"), tint: Palette.info)
                            }
                        }
                    }
                }
                if let report, missing.count < report.total {
                    Button {
                        Task { await loadMore() }
                    } label: {
                        if loadingMore {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text(String(localized: "librarian.inv.more", defaultValue: "Показать ещё (\((report.total - missing.count).formatted()))"))
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
            } header: {
                Text(String(localized: "librarian.inv.missing", defaultValue: "Не найдено"))
            } footer: {
                Text(String(localized: "librarian.inv.missingHint", defaultValue: "Должны стоять в библиотеке, но с начала инвентаризации не отмечены"))
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(LibrarianScreen.inventory.title))
        .sheet(isPresented: $scanning, onDismiss: { Task { await load() } }) {
            LibrarianInventoryScanSheet(since: sinceString) { result in
                remember(result)
            }
        }
        .pullToRefresh { await load() }
        .task(id: sinceRaw) { await load() }
    }

    // MARK: Дата начала

    private var since: Date {
        LibrarianText.date(fromDay: sinceRaw) ?? Date()
    }

    private var sinceString: String {
        LibrarianText.date(fromDay: sinceRaw) == nil ? LibrarianText.dayString(Date()) : sinceRaw
    }

    private var sinceBinding: Binding<Date> {
        Binding(get: { since }, set: { sinceRaw = LibrarianText.dayString($0) })
    }

    // MARK: Загрузка и отметки

    @MainActor
    private func load() async {
        do {
            let fresh = try await api.inventory(since: sinceString, page: 1, limit: Self.pageLimit)
            report = fresh
            missing = fresh.items
            page = 1
            failure = nil
            isOffline = false
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func loadMore() async {
        guard !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let next = try await api.inventory(since: sinceString, page: page + 1, limit: Self.pageLimit)
            let known = Set(missing.map(\.id))
            missing += next.items.filter { !known.contains($0.id) }
            page += 1
            report = next
        } catch {
            manualFailure = error.userMessage
        }
    }

    @MainActor
    private func markManual() async {
        guard let ref = LibrarianQRTarget.copyRef(fromInput: manual) else { return }
        isMarking = true
        defer { isMarking = false }
        do {
            let result = try await api.inventoryScan(ref, since: sinceString)
            remember(result)
            manual = ""
            manualFailure = nil
            await load()
        } catch {
            manualFailure = LibrarianText.deskMessage(error)
        }
    }

    private func remember(_ result: LibrarianInventoryScanDTO) {
        recent.removeAll { $0.copy.id == result.copy.id }
        recent.insert(result, at: 0)
        if recent.count > Self.recentLimit { recent.removeLast(recent.count - Self.recentLimit) }
    }
}

/// Отмеченный экземпляр: зелёный круг — на месте, оранжевый — повод разобраться.
private struct LibrarianInventoryScanRow: View {
    let item: LibrarianInventoryScanDTO

    var body: some View {
        let status = LibrarianText.copyStatus(item.copy.status)
        TelegramStyleRow(
            title: item.book.title,
            subtitle: [
                item.warning.map(LibrarianText.inventoryWarning),
                item.alreadyChecked ? String(localized: "librarian.inv.already", defaultValue: "уже отмечен") : nil,
            ]
            .compactMap { $0 }
            .joined(separator: " · "),
            meta: LibrarianText.inventoryShort(item.copy.inventoryNumber)
        ) {
            RowSymbol(
                symbol: item.warning == nil ? "checkmark" : "exclamationmark.triangle.fill",
                tint: item.warning == nil ? TileTint.green : TileTint.orange
            )
        } accessory: {
            LibrarianBadge(text: status.text, tint: status.tint)
        }
    }
}

/// Сканер инвентаризации: не гаснет после кода — наклейки идут подряд вдоль полки.
/// Под камерой — итог последнего скана.
private struct LibrarianInventoryScanSheet: View {
    let since: String
    let scanned: (LibrarianInventoryScanDTO) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var last: LibrarianInventoryScanDTO?
    @State private var failure: String?
    @State private var unavailable = false
    @State private var count = 0

    private let api = LibrarianAPI()

    var body: some View {
        NavigationStack {
            VStack(spacing: Spacing.lg) {
                LibrarianScannerView(onCode: handle, onUnavailable: { unavailable = true })
                    .overlay {
                        if unavailable {
                            ContentUnavailableView(
                                String(localized: "librarian.scan.noCamera", defaultValue: "Нет доступа к камере"),
                                systemImage: "video.slash"
                            )
                            .background(Palette.card)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
                Text(String(localized: "librarian.inv.scanHint", defaultValue: "Наведите камеру на QR-наклейку книги"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                if let failure {
                    Label(failure, systemImage: "exclamationmark.triangle")
                        .font(Typography.meta)
                        .foregroundStyle(Palette.destructive)
                } else if let last {
                    LibrarianInventoryScanRow(item: last)
                        .padding(Spacing.lg)
                        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                }
                if count > 0 {
                    Text(String(localized: "librarian.inv.scannedCount", defaultValue: "Отмечено за этот заход: \(count.formatted())"))
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            .padding(Spacing.xl)
            .background(Palette.background)
            .navigationTitle(Text(String(localized: "librarian.inv.scanTitle", defaultValue: "Наклейка экземпляра")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "librarian.done", defaultValue: "Готово")) { dismiss() }
                }
            }
        }
    }

    private func handle(_ raw: String) -> Bool {
        guard case .copy(let code) = LibrarianQRTarget.parse(raw) else {
            failure = String(localized: "librarian.scan.notCopy", defaultValue: "Это не наклейка книги")
            return false
        }
        Task { await mark(code) }
        return true
    }

    @MainActor
    private func mark(_ code: String) async {
        do {
            let result = try await api.inventoryScan(.code(code), since: since)
            last = result
            failure = nil
            count += 1
            scanned(result)
        } catch {
            failure = LibrarianText.deskMessage(error)
        }
    }
}
