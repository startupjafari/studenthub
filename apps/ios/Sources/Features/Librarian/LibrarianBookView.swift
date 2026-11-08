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
        .background(Palette.background)
        .navigationTitle(Text(book?.title ?? LibrarianScreen.book(id: bookID).title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
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
        .confirmationDialog(
            String(localized: "librarian.book.archiveTitle", defaultValue: "Убрать книгу в архив?"),
            isPresented: $confirmArchive,
            titleVisibility: .visible
        ) {
            Button(String(localized: "librarian.book.archive", defaultValue: "В архив"), role: .destructive) {
                Task { await setArchived(true) }
            }
        } message: {
            Text(String(localized: "librarian.book.archiveDesc", defaultValue: "Книга исчезнет из каталога читателей. История выдач останется, вернуть из архива можно в любой момент."))
        }
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
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.xl))
            }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if let book {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { editing = true } label: {
                        Label(String(localized: "librarian.book.edit", defaultValue: "Изменить карточку"), systemImage: "pencil")
                    }
                    Button { adding = true } label: {
                        Label(String(localized: "librarian.book.addCopies", defaultValue: "Добавить экземпляры"), systemImage: "plus.square.on.square")
                    }
                    .disabled(book.isArchived)
                    Button {
                        selecting.toggle()
                        if !selecting { selected = [] }
                    } label: {
                        Label(String(localized: "librarian.book.selectForLabels", defaultValue: "Выбрать для наклеек"), systemImage: "checkmark.circle")
                    }
                    .disabled(book.copies.isEmpty)
                    Button {
                        Task { await printLabels(book.copies.map(\.id)) }
                    } label: {
                        Label(String(localized: "librarian.book.printAll", defaultValue: "Наклейки всех экземпляров"), systemImage: "printer")
                    }
                    .disabled(book.copies.isEmpty)
                    Divider()
                    if book.isArchived {
                        Button { Task { await setArchived(false) } } label: {
                            Label(String(localized: "librarian.book.restore", defaultValue: "Вернуть из архива"), systemImage: "arrow.uturn.backward")
                        }
                    } else {
                        Button(role: .destructive) { confirmArchive = true } label: {
                            Label(String(localized: "librarian.book.archive", defaultValue: "В архив"), systemImage: "archivebox")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    private func content(_ book: LibrarianBookDetailDTO) -> some View {
        List {
            Section {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    PhotosPicker(selection: $coverItem, matching: .images) {
                        ZStack(alignment: .bottomTrailing) {
                            BookCoverView(url: book.coverUrl, width: 96)
                            Image(systemName: "camera.circle.fill")
                                .font(.title3)
                                .symbolRenderingMode(.multicolor)
                                .padding(Spacing.xs)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(String(localized: "librarian.book.cover", defaultValue: "Обложка")))
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(book.title).font(Typography.sectionTitle).foregroundStyle(Palette.foreground)
                        if !book.authors.isEmpty {
                            Text(book.authors).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                        }
                        LibrarianAvailabilityBadge(availability: book.availability)
                        if book.availability.onLoan > 0 {
                            LibrarianBadge(
                                text: String(localized: "librarian.catalog.onLoanCount", defaultValue: "выдано: \(book.availability.onLoan.formatted())"),
                                tint: Palette.info
                            )
                        }
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
                .padding(.vertical, Spacing.xs)
                if let isbn = book.isbn {
                    DetailRow(title: "ISBN", value: isbn)
                }
                if let publisher = book.publisher {
                    DetailRow(title: String(localized: "librarian.book.publisher", defaultValue: "Издательство"), value: publisher)
                }
                if let year = book.year {
                    DetailRow(title: String(localized: "librarian.book.year", defaultValue: "Год издания"), value: String(year))
                }
                if let section = book.section {
                    DetailRow(title: String(localized: "librarian.catalog.section", defaultValue: "Раздел"), value: section)
                }
                if let description = book.description {
                    Text(description).font(Typography.body).foregroundStyle(Palette.foreground)
                }
            }
            .listRowBackground(Palette.card)

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
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .bottom) {
            if selecting {
                Button {
                    Task { await printLabels(Array(selected)) }
                } label: {
                    Text(String(localized: "librarian.book.printLabels", defaultValue: "Печать наклеек: \(selected.count.formatted())"))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(selected.isEmpty)
                .padding(Spacing.xl)
                .background(.bar)
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

/// Строка экземпляра: номер, код наклейки, статус, состояние, кому выдан.
private struct LibrarianCopyRow: View {
    let copy: LibrarianCopyDTO

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: copy.inventoryNumber)
                    .font(Typography.cardTitle.monospacedDigit())
                    .foregroundStyle(Palette.foreground)
                Text([LibrarianText.copyCode(copy.code), LibrarianText.condition(copy.condition)].joined(separator: " · "))
                    .font(Typography.meta.monospaced())
                    .foregroundStyle(Palette.mutedForeground)
                if let loan = copy.loan {
                    Text([loan.readerName, loan.readerGroup, String(localized: "librarian.dueUntil", defaultValue: "до \(LibrarianText.shortDay(loan.dueAt))")]
                        .compactMap { $0 }
                        .joined(separator: " · "))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.foreground)
                }
                if let note = copy.note, !note.isEmpty {
                    Text(note).font(.caption).foregroundStyle(Palette.mutedForeground)
                }
            }
            Spacer(minLength: Spacing.md)
            let status = LibrarianText.copyStatus(copy.status)
            LibrarianBadge(text: status.text, tint: status.tint)
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
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
        List {
            if let book {
                Section {
                    NavigationLink(value: AppRoute.librarian(.book(id: book.id))) {
                        HStack(spacing: Spacing.lg) {
                            BookCoverView(url: book.coverUrl, width: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(book.title).font(Typography.cardTitle).lineLimit(3)
                                if !book.authors.isEmpty {
                                    Text(book.authors).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                                }
                                LibrarianAvailabilityBadge(availability: book.availability)
                            }
                        }
                    }
                }
                .listRowBackground(Palette.card)
            }

            Section {
                HStack {
                    Text(verbatim: LibrarianText.copyCode(current.code)).font(Typography.body.monospaced())
                    Spacer()
                    let status = LibrarianText.copyStatus(current.status)
                    LibrarianBadge(text: status.text, tint: status.tint)
                }
                if let loan = current.loan {
                    DetailRow(
                        title: String(localized: "librarian.copy.reader", defaultValue: "Читатель"),
                        value: [loan.readerName, loan.readerGroup, String(localized: "librarian.dueUntil", defaultValue: "до \(LibrarianText.shortDay(loan.dueAt))")]
                            .compactMap { $0 }
                            .joined(separator: " · ")
                    )
                }
                if let seen = current.inventoriedAt {
                    DetailRow(title: String(localized: "librarian.copy.inventoried", defaultValue: "Последняя инвентаризация"), value: DisplayFormat.date(seen))
                }
            }
            .listRowBackground(Palette.card)

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
            .listRowBackground(Palette.card)

            Section {
                Button {
                    Task { await printLabel() }
                } label: {
                    Label(String(localized: "librarian.copy.printOne", defaultValue: "Напечатать наклейку"), systemImage: "printer")
                }
                Button(role: .destructive) { confirmRotate = true } label: {
                    Label(String(localized: "librarian.copy.rotate", defaultValue: "Перевыпустить наклейку"), systemImage: "arrow.triangle.2.circlepath")
                }
                if isOut {
                    Button {
                        Task { await setStatus("AVAILABLE") }
                    } label: {
                        Label(String(localized: "librarian.copy.backToShelf", defaultValue: "Вернуть на полку"), systemImage: "tray.and.arrow.down")
                    }
                } else if !isBusyCopy {
                    Button(role: .destructive) { withdrawing = "LOST" } label: {
                        Label(String(localized: "librarian.copy.markLost", defaultValue: "Утерян"), systemImage: "questionmark.folder")
                    }
                    Button(role: .destructive) { withdrawing = "WRITTEN_OFF" } label: {
                        Label(String(localized: "librarian.copy.writeOff", defaultValue: "Списать"), systemImage: "trash")
                    }
                }
            } footer: {
                if isBusyCopy {
                    Text(String(localized: "librarian.copy.busy", defaultValue: "Экземпляр выдан или отложен под бронь"))
                }
            }
            .listRowBackground(Palette.card)

            Section {
                if let history {
                    if history.isEmpty {
                        Text(String(localized: "librarian.copy.historyEmpty", defaultValue: "Экземпляр ещё не выдавали"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(history) { loan in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(loan.reader.name).font(Typography.cardTitle)
                            Text([
                                String(localized: "librarian.copy.historyIssued", defaultValue: "выдан \(LibrarianText.shortDay(loan.issuedAt))"),
                                loan.returnedAt.map { String(localized: "librarian.copy.historyReturned", defaultValue: "возвращён \(LibrarianText.shortDay($0))") },
                            ]
                            .compactMap { $0 }
                            .joined(separator: " · "))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                            LibrarianLoanDueBadge(loan: loan)
                        }
                    }
                } else {
                    Button {
                        Task { await loadHistory() }
                    } label: {
                        Label(String(localized: "librarian.copy.history", defaultValue: "История выдач"), systemImage: "clock.arrow.circlepath")
                    }
                }
            } header: {
                Text(String(localized: "librarian.copy.history", defaultValue: "История выдач"))
            }
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
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
        .confirmationDialog(
            withdrawing == "LOST"
                ? String(localized: "librarian.copy.markLostTitle", defaultValue: "Отметить экземпляр утерянным?")
                : String(localized: "librarian.copy.writeOffTitle", defaultValue: "Списать экземпляр?"),
            isPresented: Binding(get: { withdrawing != nil }, set: { if !$0 { withdrawing = nil } }),
            titleVisibility: .visible,
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
        } message: { _ in
            Text(String(
                localized: "librarian.copy.withdrawDesc",
                defaultValue: "Экземпляр \(current.inventoryNumber) выйдет из оборота. История выдач останется, вернуть на полку можно позже."
            ))
        }
        .confirmationDialog(
            String(localized: "librarian.copy.rotateTitle", defaultValue: "Перевыпустить наклейку?"),
            isPresented: $confirmRotate,
            titleVisibility: .visible
        ) {
            Button(String(localized: "librarian.copy.rotate", defaultValue: "Перевыпустить наклейку"), role: .destructive) {
                Task { await rotate() }
            }
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
        do {
            history = try await api.loans(PageRequest(cursor: nil, page: 1, limit: 50), filter: "all", copyID: current.id).items
        } catch {
            failure = error.userMessage
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
            .listRowBackground(Palette.card)
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
