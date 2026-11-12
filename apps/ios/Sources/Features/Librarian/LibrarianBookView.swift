import PhotosUI
import QuickLook
import SwiftUI

/// Книга глазами фонда (веб `/library/catalog/[id]`): карточка, обложка, архив, экземпляры
/// с тем, кому выдано и до какого срока, заведение и правка экземпляров, печать QR-наклеек.
struct LibrarianBookView: View {
    let bookID: String
    /// Экземпляр, открытый по наклейке, — подсвечивается в списке.
    var highlightCopyID: String?

    @State private var book: LibrarianBookDetailDTO?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var editing = false
    @State private var adding = false
    @State private var confirmArchive = false
    @State private var selecting = false
    @State private var selected: Set<String> = []
    @State private var openCopy: LibrarianCopyDTO?
    @State private var coverItem: PhotosPickerItem?
    /// Окно «Фото» открывает экран, а не строка списка: строка перерисовывается, пока
    /// окно открыто, и оно зависало на «Загрузке».
    @State private var pickingCover = false
    @State private var busy = false
    @State private var actionFailure: String?
    @State private var notice: String?
    @State private var labelsURL: URL?

    private let api = LibrarianAPI()

    var body: some View {
        Group {
            if let book {
                content(book)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(book?.title ?? LibrarianScreen.book(id: bookID).title))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editing) {
            if let book {
                LibrarianBookFormSheet(book: book) { _ in
                    notice = String(localized: "librarian.book.saved", defaultValue: "Карточка сохранена")
                    await load()
                }
            }
        }
        .sheet(isPresented: $adding) {
            LibrarianAddCopiesSheet(bookID: bookID) { added in
                notice = String(localized: "librarian.book.copiesAdded", defaultValue: "Добавлено экземпляров: \(added.count.formatted())")
                selected = Set(added.map(\.id))
                selecting = !added.isEmpty
                await load()
            }
        }
        .sheet(item: $openCopy) { copy in
            NavigationStack {
                LibrarianCopyDetail(copy: copy, book: nil) { await load() }
            }
        }
        .alert(
            String(localized: "librarian.book.archiveTitle", defaultValue: "Убрать книгу в архив?"),
            isPresented: $confirmArchive
        ) {
            Button(String(localized: "librarian.book.archive", defaultValue: "В архив"), role: .destructive) {
                Task { await setArchived(true) }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: {
            Text(String(localized: "librarian.book.archiveDesc", defaultValue: "Книга исчезнет из каталога читателей. История выдач останется, вернуть из архива можно в любой момент."))
        }
        .photosPicker(isPresented: $pickingCover, selection: $coverItem, matching: .images)
        .onChange(of: coverItem) { _, item in
            guard let item else { return }
            Task { await uploadCover(item) }
        }
        .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .actionFailureAlert($actionFailure)
        .quickLookPreview($labelsURL)
        .overlay {
            if busy {
                ProgressView()
                    .padding(Spacing.xl)
                    .glassSurface(interactive: false, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    /// Редкое и опасное — в «Ещё» под шапкой: выбор наклеек и архив.
    @HeroMenuBuilder
    private func moreMenu(_ book: LibrarianBookDetailDTO) -> [HeroMenuElement] {
        HeroMenuItem(
            String(localized: "librarian.book.selectForLabels", defaultValue: "Выбрать для наклеек"),
            symbol: "checkmark.circle",
            isDisabled: book.copies.isEmpty
        ) {
            selecting.toggle()
            if !selecting { selected = [] }
        }
        HeroMenuDivider()
        if book.isArchived {
            HeroMenuItem(String(localized: "librarian.book.restore", defaultValue: "Вернуть из архива"), symbol: "arrow.uturn.backward") { Task { await setArchived(false) } }
        } else {
            HeroMenuItem(String(localized: "librarian.book.archive", defaultValue: "В архив"), symbol: "archivebox", isDestructive: true) { confirmArchive = true }
        }
    }

    private func heroActions(_ book: LibrarianBookDetailDTO) -> [HeroAction] {
        var actions = [
            HeroAction(title: String(localized: "librarian.book.editShort", defaultValue: "Изменить"), symbol: "pencil") { editing = true },
        ]
        if !book.isArchived {
            actions.append(HeroAction(title: String(localized: "librarian.book.addCopiesShort", defaultValue: "Экземпляры"), symbol: "plus.square.on.square") { adding = true })
        }
        if !book.copies.isEmpty {
            actions.append(HeroAction(title: String(localized: "librarian.book.labelsShort", defaultValue: "Наклейки"), symbol: "printer") {
                Task { await printLabels(book.copies.map(\.id)) }
            })
        }
        return actions
    }

    private func content(_ book: LibrarianBookDetailDTO) -> some View {
        List {
            // Шапка как у карточки в Telegram, только вместо аватара — обложка: нажатие
            // меняет её, ниже — название, авторы, наличие и круглые кнопки действий.
            Section {
                VStack(spacing: Spacing.sm) {
                    Button {
                        pickingCover = true
                    } label: {
                        ZStack(alignment: .bottomTrailing) {
                            BookCoverView(url: book.coverUrl, width: 112)
                            Image(systemName: "camera.fill")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Palette.primary)
                                .frame(width: 32, height: 32)
                                .glassSurface(in: Circle())
                                .offset(x: 8, y: 8)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(String(localized: "librarian.book.cover", defaultValue: "Обложка")))
                    .padding(.bottom, Spacing.xs)
                    Text(book.title)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if !book.authors.isEmpty {
                        Text(book.authors)
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                            .multilineTextAlignment(.center)
                    }
                    HStack(spacing: Spacing.xs) {
                        LibrarianAvailabilityBadge(availability: book.availability)
                        if book.availability.onLoan > 0 {
                            LibrarianBadge(
                                text: String(localized: "librarian.catalog.onLoanCount", defaultValue: "выдано: \(book.availability.onLoan.formatted())"),
                                tint: Palette.info
                            )
                        }
                    }
                    if book.availability.reserved > 0 || book.isArchived {
                        HStack(spacing: Spacing.xs) {
                            if book.availability.reserved > 0 {
                                LibrarianBadge(
                                    text: String(localized: "librarian.book.reservedCount", defaultValue: "под бронью: \(book.availability.reserved.formatted())"),
                                    tint: Palette.warning
                                )
                            }
                            if book.isArchived {
                                LibrarianBadge(text: String(localized: "librarian.catalog.archived", defaultValue: "В архиве"), tint: Palette.mutedForeground)
                            }
                        }
                    }
                    HeroActionRow(actions: heroActions(book)) { moreMenu(book) }
                        .padding(.top, Spacing.md)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.sm)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: Spacing.sm, leading: 0, bottom: Spacing.sm, trailing: 0))
            }

            if book.isbn != nil || book.publisher != nil || book.year != nil || book.section != nil {
                Section(String(localized: "librarian.book.about", defaultValue: "О книге")) {
                    if let isbn = book.isbn {
                        DetailRow(title: "ISBN", value: isbn, symbol: "barcode")
                    }
                    if let publisher = book.publisher {
                        DetailRow(title: String(localized: "librarian.book.publisher", defaultValue: "Издательство"), value: publisher, symbol: "building.2")
                    }
                    if let year = book.year {
                        DetailRow(title: String(localized: "librarian.book.year", defaultValue: "Год издания"), value: String(year), symbol: "calendar")
                    }
                    if let section = book.section {
                        DetailRow(title: String(localized: "librarian.catalog.section", defaultValue: "Раздел"), value: section, symbol: "folder")
                    }
                }
            }

            if let description = book.description, !description.isEmpty {
                Section(String(localized: "librarian.book.description", defaultValue: "Описание")) {
                    Text(description)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                        .textSelection(.enabled)
                }
            }

            Section {
                if book.copies.isEmpty {
                    EmptyStateView(
                        title: String(localized: "librarian.book.noCopies", defaultValue: "Экземпляров нет"),
                        symbol: "square.stack",
                        hint: String(localized: "librarian.book.noCopiesHint", defaultValue: "Добавьте экземпляры — каждому выдаётся инвентарный номер и QR-наклейка."),
                        actionTitle: book.isArchived ? nil : String(localized: "librarian.book.addCopies", defaultValue: "Добавить экземпляры"),
                        action: book.isArchived ? nil : { adding = true }
                    )
                }
                if selecting, !book.copies.isEmpty {
                    Button {
                        if selected.count == book.copies.count { selected = [] } else { selected = Set(book.copies.map(\.id)) }
                    } label: {
                        Text(String(localized: "librarian.book.selectAll", defaultValue: "Выбрать все"))
                    }
                }
                ForEach(book.copies) { copy in
                    Button {
                        if selecting {
                            if selected.contains(copy.id) { selected.remove(copy.id) } else { selected.insert(copy.id) }
                        } else {
                            openCopy = copy
                        }
                    } label: {
                        HStack(spacing: Spacing.md) {
                            if selecting {
                                Image(systemName: selected.contains(copy.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selected.contains(copy.id) ? Palette.primary : Palette.mutedForeground)
                            }
                            LibrarianCopyRow(copy: copy)
                        }
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(copy.id == highlightCopyID ? Palette.primary.opacity(0.12) : Palette.card)
                }
            } header: {
                Text(String(localized: "librarian.book.copies", defaultValue: "Экземпляры"))
            } footer: {
                Text(String(localized: "librarian.book.copiesHint", defaultValue: "Инвентарные номера, наклейки и кому выдано. Нажмите на экземпляр, чтобы изменить его."))
            }
        }
        .listStyle(.insetGrouped)
        .toolbar {
            if selecting {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(String(localized: "common.cancel", defaultValue: "Отмена")) {
                        selecting = false
                        selected = []
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if selecting {
                Button {
                    Task { await printLabels(Array(selected)) }
                } label: {
                    Label(String(localized: "librarian.book.printLabels", defaultValue: "Печать наклеек: \(selected.count.formatted())"), systemImage: "printer.fill")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.xs)
                }
                .glassProminentButton()
                .disabled(selected.isEmpty)
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.md)
            }
        }
    }

    @MainActor
    private func load() async {
        do {
            book = try await api.book(id: bookID)
            failure = nil
            isOffline = false
        } catch is CancellationError {
            return
        } catch {
            failure = (error as? APIError)?.code == .notFound
                ? String(localized: "librarian.book.notFound", defaultValue: "Книга не найдена")
                : error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func setArchived(_ archived: Bool) async {
        busy = true
        defer { busy = false }
        do {
            let saved = try await api.setArchived(bookID: bookID, archived: archived)
            notice = saved.isArchived
                ? String(localized: "librarian.book.archivedToast", defaultValue: "Книга в архиве")
                : String(localized: "librarian.book.restoredToast", defaultValue: "Книга снова в каталоге")
            await load()
        } catch {
            actionFailure = (error as? APIError)?.code == .conflict
                ? String(localized: "librarian.book.archiveBusy", defaultValue: "Нельзя: экземпляры выданы или отложены под бронь")
                : error.userMessage
        }
    }

    @MainActor
    private func printLabels(_ ids: [String]) async {
        guard !ids.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            let labels = try await api.labels(copyIDs: ids)
            labelsURL = try LibrarianLabelSheet.makePDF(labels)
            selecting = false
            selected = []
        } catch {
            actionFailure = error.userMessage
        }
    }

    /// Обложка в пропорциях книги (2:3), 600 px по ширине хватает на карточку.
    @MainActor
    private func uploadCover(_ item: PhotosPickerItem) async {
        busy = true
        defer {
            busy = false
            coverItem = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
                  let jpeg = Self.cover(from: image)
            else { return }
            _ = try await api.uploadCover(bookID: bookID, data: jpeg, mime: "image/jpeg", filename: "cover.jpg")
            notice = String(localized: "librarian.book.coverSaved", defaultValue: "Обложка сохранена")
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }

    private static func cover(from image: UIImage) -> Data? {
        let source = image.size
        guard source.width > 0, source.height > 0 else { return nil }
        let aspect: CGFloat = 2.0 / 3.0
        var crop = CGRect(origin: .zero, size: source)
        if source.width / source.height > aspect {
            crop.size.width = source.height * aspect
            crop.origin.x = (source.width - crop.width) / 2
        } else {
            crop.size.height = source.width / aspect
            crop.origin.y = (source.height - crop.height) / 2
        }
        let target = CGSize(width: 600, height: 900)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let rendered = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            let scale = target.width / crop.width
            image.draw(in: CGRect(
                x: -crop.origin.x * scale,
                y: -crop.origin.y * scale,
                width: source.width * scale,
                height: source.height * scale
            ))
        }
        return rendered.jpegData(compressionQuality: 0.85)
    }
}

/// Строка экземпляра — как строка чата: значок с цветом статуса, инвентарный номер,
/// код наклейки и состояние, кому выдан; статус — плашкой справа.
private struct LibrarianCopyRow: View {
    let copy: LibrarianCopyDTO

    var body: some View {
        let status = LibrarianText.copyStatus(copy.status)
        TelegramStyleRow(
            title: copy.inventoryNumber,
            subtitle: subtitle,
            meta: copy.loan.map { String(localized: "librarian.dueUntil", defaultValue: "до \(LibrarianText.shortDay($0.dueAt))") }
        ) {
            RowSymbol(symbol: "book.closed.fill", tint: status.tint)
        } accessory: {
            LibrarianBadge(text: status.text, tint: status.tint)
        }
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        var lines = [[LibrarianText.copyCode(copy.code), LibrarianText.condition(copy.condition)].joined(separator: " · ")]
        if let loan = copy.loan {
            lines.append([loan.readerName, loan.readerGroup].compactMap { $0 }.joined(separator: " · "))
        } else if let note = copy.note, !note.isEmpty {
            lines.append(note)
        }
        return lines.joined(separator: "\n")
    }
}

// MARK: - Экземпляр

/// Экземпляр: правка номера, состояния и заметки, вывод из оборота и возврат на полку,
/// перевыпуск и печать наклейки, история выдач. `book` — когда экземпляр открыт по
/// наклейке и книгу нужно показать рядом.
struct LibrarianCopyDetail: View {
    let copy: LibrarianCopyDTO
    let book: LibrarianBookDTO?
    let changed: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var inventoryNumber: String
    @State private var condition: String
    @State private var note: String
    @State private var current: LibrarianCopyDTO
    @State private var failure: String?
    @State private var notice: String?
    @State private var busy = false
    @State private var withdrawing: String?
    @State private var confirmRotate = false
    @State private var labelsURL: URL?
    @State private var history: [LibrarianLoanDTO]?
    @State private var historyLoading = false
    /// Сбой истории — в её же секции: общий `failure` подписан под формой правки,
    /// и сбой истории там читался бы как отказ сохранения.
    @State private var historyFailure: String?

    private let api = LibrarianAPI()

    init(copy: LibrarianCopyDTO, book: LibrarianBookDTO?, changed: @escaping () async -> Void) {
        self.copy = copy
        self.book = book
        self.changed = changed
        _inventoryNumber = State(initialValue: copy.inventoryNumber)
        _condition = State(initialValue: copy.condition)
        _note = State(initialValue: copy.note ?? "")
        _current = State(initialValue: copy)
    }

    private var isBusyCopy: Bool { current.status == "ON_LOAN" || current.status == "RESERVED" }
    private var isOut: Bool { current.status == "LOST" || current.status == "WRITTEN_OFF" }

    private var hasChanges: Bool {
        inventoryNumber.trimmingCharacters(in: .whitespaces) != current.inventoryNumber
            || condition != current.condition
            || note.trimmingCharacters(in: .whitespacesAndNewlines) != (current.note ?? "")
    }

    var body: some View {
        let status = LibrarianText.copyStatus(current.status)
        List {
            Section {
                HeroHeader(
                    visual: .symbol("book.closed.fill", tint: status.tint),
                    title: current.inventoryNumber,
                    subtitle: LibrarianText.copyCode(current.code),
                    actions: copyActions
                ) {
                    LibrarianBadge(text: status.text, tint: status.tint)
                }
            }

            if let book {
                Section {
                    NavigationLink(value: AppRoute.librarian(.book(id: book.id))) {
                        HStack(spacing: Spacing.lg) {
                            BookCoverView(url: book.coverUrl, width: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(book.title).font(.body.weight(.semibold)).lineLimit(3)
                                if !book.authors.isEmpty {
                                    Text(book.authors).font(.subheadline).foregroundStyle(Palette.mutedForeground)
                                }
                                LibrarianAvailabilityBadge(availability: book.availability)
                            }
                        }
                    }
                }
            }

            if current.loan != nil || current.inventoriedAt != nil {
                Section {
                    if let loan = current.loan {
                        DetailRow(
                            title: String(localized: "librarian.copy.reader", defaultValue: "Читатель"),
                            value: [loan.readerName, loan.readerGroup, String(localized: "librarian.dueUntil", defaultValue: "до \(LibrarianText.shortDay(loan.dueAt))")]
                                .compactMap { $0 }
                                .joined(separator: " · "),
                            symbol: "person"
                        )
                    }
                    if let seen = current.inventoriedAt {
                        DetailRow(title: String(localized: "librarian.copy.inventoried", defaultValue: "Последняя инвентаризация"), value: DisplayFormat.date(seen), symbol: "checklist")
                    }
                }
            }

            Section {
                TextField(String(localized: "librarian.copy.inventoryNumber", defaultValue: "Инв. номер"), text: $inventoryNumber)
                    .autocorrectionDisabled()
                    .disabled(current.status == "ON_LOAN")
                Picker(String(localized: "librarian.condition", defaultValue: "Состояние"), selection: $condition) {
                    ForEach(LibrarianText.conditions, id: \.self) { Text(LibrarianText.condition($0)).tag($0) }
                }
                TextField(String(localized: "librarian.copy.note", defaultValue: "Заметка"), text: $note, axis: .vertical)
                    .lineLimit(1...4)
                Button {
                    Task { await saveFields() }
                } label: {
                    Text(String(localized: "common.save", defaultValue: "Сохранить")).bold()
                }
                .disabled(!hasChanges || busy || inventoryNumber.trimmingCharacters(in: .whitespaces).isEmpty)
            } header: {
                Text(String(localized: "librarian.copy.edit", defaultValue: "Изменить экземпляр"))
            } footer: {
                if let failure { Text(failure).foregroundStyle(Palette.destructive) }
            }

            Section {
                if let history {
                    if history.isEmpty {
                        Text(String(localized: "librarian.copy.historyEmpty", defaultValue: "Экземпляр ещё не выдавали"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(history) { loan in
                        TelegramStyleRow(
                            title: loan.reader.name,
                            subtitle: [
                                String(localized: "librarian.copy.historyIssued", defaultValue: "выдан \(LibrarianText.shortDay(loan.issuedAt))"),
                                loan.returnedAt.map { String(localized: "librarian.copy.historyReturned", defaultValue: "возвращён \(LibrarianText.shortDay($0))") },
                            ]
                            .compactMap { $0 }
                            .joined(separator: " · ")
                        ) {
                            AvatarView(url: nil, name: loan.reader.name, size: 40)
                        } accessory: {
                            LibrarianLoanDueBadge(loan: loan)
                        }
                    }
                } else if !historyLoading, let historyFailure {
                    DashboardFailurePlaceholder(message: historyFailure) { await loadHistory() }
                } else {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                }
            } header: {
                Text(String(localized: "librarian.copy.history", defaultValue: "История выдач"))
            }

            // Опасное — отдельно внизу, красным: перевыпуск гасит старую наклейку,
            // утеря и списание выводят экземпляр из оборота.
            Section {
                if isOut {
                    Button {
                        Task { await setStatus("AVAILABLE") }
                    } label: {
                        Label(String(localized: "librarian.copy.backToShelf", defaultValue: "Вернуть на полку"), systemImage: "tray.and.arrow.down")
                    }
                }
                Button(role: .destructive) { confirmRotate = true } label: {
                    Label(String(localized: "librarian.copy.rotate", defaultValue: "Перевыпустить наклейку"), systemImage: "arrow.triangle.2.circlepath")
                        .foregroundStyle(Palette.destructive)
                }
                if !isOut, !isBusyCopy {
                    Button(role: .destructive) { withdrawing = "LOST" } label: {
                        Label(String(localized: "librarian.copy.markLost", defaultValue: "Утерян"), systemImage: "questionmark.folder")
                            .foregroundStyle(Palette.destructive)
                    }
                    Button(role: .destructive) { withdrawing = "WRITTEN_OFF" } label: {
                        Label(String(localized: "librarian.copy.writeOff", defaultValue: "Списать"), systemImage: "trash")
                            .foregroundStyle(Palette.destructive)
                    }
                }
            } footer: {
                if isBusyCopy {
                    Text(String(localized: "librarian.copy.busy", defaultValue: "Экземпляр выдан или отложен под бронь"))
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(String(localized: "librarian.copy.title", defaultValue: "Экземпляр \(current.inventoryNumber)")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if book == nil {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "librarian.done", defaultValue: "Готово")) { dismiss() }
                }
            }
        }
        .overlay {
            if busy { ProgressView() }
        }
        .task {
            if history == nil { await loadHistory() }
        }
        .alert(
            withdrawing == "LOST"
                ? String(localized: "librarian.copy.markLostTitle", defaultValue: "Отметить экземпляр утерянным?")
                : String(localized: "librarian.copy.writeOffTitle", defaultValue: "Списать экземпляр?"),
            isPresented: Binding(get: { withdrawing != nil }, set: { if !$0 { withdrawing = nil } }),
            presenting: withdrawing
        ) { status in
            Button(
                status == "LOST"
                    ? String(localized: "librarian.copy.markLost", defaultValue: "Утерян")
                    : String(localized: "librarian.copy.writeOff", defaultValue: "Списать"),
                role: .destructive
            ) {
                Task { await setStatus(status) }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: { _ in
            Text(String(
                localized: "librarian.copy.withdrawDesc",
                defaultValue: "Экземпляр \(current.inventoryNumber) выйдет из оборота. История выдач останется, вернуть на полку можно позже."
            ))
        }
        .alert(
            String(localized: "librarian.copy.rotateTitle", defaultValue: "Перевыпустить наклейку?"),
            isPresented: $confirmRotate
        ) {
            Button(String(localized: "librarian.copy.rotate", defaultValue: "Перевыпустить наклейку"), role: .destructive) {
                Task { await rotate() }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: {
            Text(String(
                localized: "librarian.copy.rotateDesc",
                defaultValue: "Старая наклейка экземпляра \(current.inventoryNumber) перестанет работать — наклейте новую."
            ))
        }
        .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .quickLookPreview($labelsURL)
    }

    private var copyActions: [HeroAction] {
        [
            HeroAction(title: String(localized: "librarian.copy.labelShort", defaultValue: "Наклейка"), symbol: "printer") {
                Task { await printLabel() }
            },
        ]
    }

    @MainActor
    private func saveFields() async {
        var fields: [String: JSONValue] = [:]
        let number = inventoryNumber.trimmingCharacters(in: .whitespaces)
        if number != current.inventoryNumber { fields["inventoryNumber"] = .string(number) }
        if condition != current.condition { fields["condition"] = .string(condition) }
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedNote != (current.note ?? "") { fields["note"] = .text(trimmedNote) }
        await update(fields, message: String(localized: "librarian.copy.saved", defaultValue: "Экземпляр сохранён"))
    }

    @MainActor
    private func setStatus(_ status: String) async {
        await update(["status": .string(status)], message: String(localized: "librarian.copy.saved", defaultValue: "Экземпляр сохранён"))
    }

    @MainActor
    private func update(_ fields: [String: JSONValue], message: String) async {
        guard !fields.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            let saved = try await api.updateCopy(id: current.id, fields: fields)
            current = saved
            inventoryNumber = saved.inventoryNumber
            condition = saved.condition
            note = saved.note ?? ""
            failure = nil
            notice = message
            await changed()
        } catch {
            if LibrarianText.conflictField(error) == "inventoryNumber" {
                failure = String(localized: "librarian.error.inventoryTaken", defaultValue: "Такой инвентарный номер уже есть в фонде")
            } else if (error as? APIError)?.code == .conflict {
                failure = String(localized: "librarian.copy.busy", defaultValue: "Экземпляр выдан или отложен под бронь")
            } else {
                failure = error.userMessage
            }
        }
    }

    @MainActor
    private func rotate() async {
        busy = true
        defer { busy = false }
        do {
            let label = try await api.rotateCode(copyID: current.id)
            notice = String(localized: "librarian.copy.codeRotated", defaultValue: "Код перевыпущен")
            labelsURL = try LibrarianLabelSheet.makePDF([label])
            await changed()
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func printLabel() async {
        busy = true
        defer { busy = false }
        do {
            labelsURL = try LibrarianLabelSheet.makePDF(try await api.labels(copyIDs: [current.id]))
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func loadHistory() async {
        historyLoading = true
        defer { historyLoading = false }
        do {
            history = try await api.loans(PageRequest(cursor: nil, page: 1, limit: 50), filter: "all", copyID: current.id).items
            historyFailure = nil
        } catch is CancellationError {
            return
        } catch {
            historyFailure = error.userMessage
        }
    }
}

// MARK: - Новые экземпляры

/// Новые экземпляры: количеством (номера выдаются по порядку) или номерами списком.
private struct LibrarianAddCopiesSheet: View {
    let bookID: String
    let added: ([LibrarianCopyDTO]) async -> Void

    @State private var byNumbers = false
    @State private var count = 1
    @State private var numbers = ""
    @State private var condition = "GOOD"

    private let api = LibrarianAPI()
    private static let maxCopies = 200

    var body: some View {
        FormSheet(
            title: String(localized: "librarian.book.addCopies", defaultValue: "Добавить экземпляры"),
            canSave: isValid,
            save: save
        ) {
            Section {
                Picker(String(localized: "librarian.copies.mode", defaultValue: "Как завести"), selection: $byNumbers) {
                    Text(String(localized: "librarian.copies.modeCount", defaultValue: "Количеством")).tag(false)
                    Text(String(localized: "librarian.copies.modeNumbers", defaultValue: "Номерами")).tag(true)
                }
                .pickerStyle(.segmented)
                if byNumbers {
                    TextField(String(localized: "librarian.copies.numbers", defaultValue: "Инвентарные номера"), text: $numbers, axis: .vertical)
                        .lineLimit(3...8)
                        .autocorrectionDisabled()
                } else {
                    Stepper(value: $count, in: 1...Self.maxCopies) {
                        Text(String(localized: "librarian.copies.count", defaultValue: "Сколько экземпляров: \(count.formatted())"))
                    }
                }
                Picker(String(localized: "librarian.condition", defaultValue: "Состояние"), selection: $condition) {
                    ForEach(LibrarianText.conditions, id: \.self) { Text(LibrarianText.condition($0)).tag($0) }
                }
            } footer: {
                Text(byNumbers
                    ? String(localized: "librarian.copies.numbersHint", defaultValue: "Через запятую или с новой строки.")
                    : String(localized: "librarian.copies.countHint", defaultValue: "Номера выдадутся по порядку после наибольшего номера фонда."))
            }
        }
    }

    private var parsedNumbers: [String] {
        numbers
            .split(whereSeparator: { $0 == "," || $0 == "\n" || $0 == ";" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private var isValid: Bool {
        if byNumbers {
            let list = parsedNumbers
            return !list.isEmpty && list.count <= Self.maxCopies && list.allSatisfy { $0.count <= 40 }
        }
        return (1...Self.maxCopies).contains(count)
    }

    @MainActor
    private func save() async throws {
        do {
            let copies = try await api.addCopies(
                bookID: bookID,
                count: byNumbers ? nil : count,
                inventoryNumbers: byNumbers ? parsedNumbers : nil,
                condition: condition
            )
            await added(copies)
        } catch {
            if LibrarianText.conflictField(error) == "inventoryNumber" || LibrarianText.conflictField(error) == "inventoryNumbers" {
                throw LibrarianText.messageError(String(localized: "librarian.error.inventoryTaken", defaultValue: "Такой инвентарный номер уже есть в фонде"))
            }
            throw error
        }
    }
}

// MARK: - Наклейки

/// Лист наклеек для печати: 24 на A4 (3 × 8) под разрезание. Крупно — инвентарный номер:
/// по нему книгу ищут на полке. Готовый PDF открывается системным просмотром — оттуда
/// печать и «Поделиться».
enum LibrarianLabelSheet {
    private static let perPage = 24
    private static let pageSize = CGSize(width: 595, height: 842)

    @MainActor
    static func makePDF(_ labels: [LibrarianCopyLabelDTO]) throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: String(localized: "librarian.labels.file", defaultValue: "Наклейки") + ".pdf")
        var box = CGRect(origin: .zero, size: pageSize)
        guard let context = CGContext(url as CFURL, mediaBox: &box, nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        let pages = stride(from: 0, to: labels.count, by: perPage).map { Array(labels[$0..<min($0 + perPage, labels.count)]) }
        for page in pages {
            let renderer = ImageRenderer(content: LibrarianLabelPage(labels: page).frame(width: pageSize.width, height: pageSize.height))
            renderer.render { _, draw in
                context.beginPDFPage(nil)
                draw(context)
                context.endPDFPage()
            }
        }
        context.closePDF()
        return url
    }
}

private struct LibrarianLabelPage: View {
    let labels: [LibrarianCopyLabelDTO]

    var body: some View {
        // Без ленивых контейнеров: `ImageRenderer` их не рисует.
        Grid(horizontalSpacing: 0, verticalSpacing: 0) {
            ForEach(Array(stride(from: 0, to: labels.count, by: 3)), id: \.self) { start in
                GridRow {
                    ForEach(labels[start..<min(start + 3, labels.count)]) { label in
                        cell(label)
                    }
                }
            }
        }
        .padding(.top, 36)
        .frame(width: 595, height: 842, alignment: .top)
        .background(Color.white)
        .environment(\.colorScheme, .light)
    }

    private func cell(_ label: LibrarianCopyLabelDTO) -> some View {
        HStack(spacing: 6) {
            if let image = Self.image(from: label.qr) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 70, height: 70)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(label.university.uppercased())
                    .font(.system(size: 6, weight: .semibold))
                    .foregroundStyle(Color.blue)
                    .lineLimit(1)
                Text(verbatim: label.inventoryNumber)
                    .font(.system(size: 14, weight: .bold).monospacedDigit())
                    .foregroundStyle(Color.black)
                Text(label.title)
                    .font(.system(size: 7))
                    .foregroundStyle(Color.black)
                    .lineLimit(2)
                if !label.authors.isEmpty {
                    Text(label.authors)
                        .font(.system(size: 6))
                        .foregroundStyle(Color.gray)
                        .lineLimit(1)
                }
                Text(verbatim: LibrarianText.copyCode(label.code))
                    .font(.system(size: 6).monospaced())
                    .foregroundStyle(Color.gray)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .frame(width: 180, height: 96)
        .overlay(Rectangle().strokeBorder(style: StrokeStyle(lineWidth: 0.5, dash: [3])).foregroundStyle(Color.gray.opacity(0.6)))
    }

    /// QR приходит готовой картинкой `data:image/png;base64,…`.
    private static func image(from dataURL: String) -> UIImage? {
        guard let comma = dataURL.firstIndex(of: ",") else { return nil }
        let base64 = String(dataURL[dataURL.index(after: comma)...])
        guard let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }
}
