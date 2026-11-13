import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// Каталог библиотеки глазами фонда (веб — `CatalogView mode="staff"`, `BookDetailView`):
// поиск и фильтры, заведение книг, импорт из таблицы, архив; книга с экземплярами,
// наклейки с QR, правка экземпляров, история выдач, обложка.

enum StaffLibraryText {
    static func copyStatus(_ raw: String) -> (String, Color) {
        switch raw {
        case "AVAILABLE": return (String(localized: "staff.cat.status.available", defaultValue: "На полке"), Palette.success)
        case "ON_LOAN": return (String(localized: "staff.cat.status.onLoan", defaultValue: "Выдан"), Palette.info)
        case "RESERVED": return (String(localized: "staff.cat.status.reserved", defaultValue: "Под бронью"), Palette.warning)
        case "LOST": return (String(localized: "staff.cat.status.lost", defaultValue: "Утерян"), Palette.destructive)
        case "WRITTEN_OFF": return (String(localized: "staff.cat.status.writtenOff", defaultValue: "Списан"), Palette.mutedForeground)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static let conditions = ["GOOD", "WORN", "DAMAGED"]

    static func condition(_ raw: String) -> String {
        switch raw {
        case "GOOD": return String(localized: "staff.cat.condition.good", defaultValue: "Хорошее")
        case "WORN": return String(localized: "staff.cat.condition.worn", defaultValue: "Потрёпанное")
        case "DAMAGED": return String(localized: "staff.cat.condition.damaged", defaultValue: "Повреждено")
        default: return raw
        }
    }

    /// Код наклейки группами по четыре — так его читают вслух и сверяют глазами.
    static func code(_ raw: String) -> String {
        var groups: [String] = []
        var current = ""
        for character in raw {
            current.append(character)
            if current.count == 4 {
                groups.append(current)
                current = ""
            }
        }
        if !current.isEmpty { groups.append(current) }
        return groups.joined(separator: " ")
    }

    static func availability(_ book: StaffBook) -> (String, Color) {
        let a = book.availability
        if a.total == 0 { return (String(localized: "staff.cat.noCopies", defaultValue: "Нет экземпляров"), Palette.mutedForeground) }
        if a.available > 0 {
            return (String(localized: "staff.cat.availableOf", defaultValue: "На полке \(a.available.formatted()) из \(a.total.formatted())"), Palette.success)
        }
        return (String(localized: "staff.cat.allOut", defaultValue: "Все выданы"), Palette.warning)
    }
}

// MARK: - Каталог

struct StaffLibraryCatalogView: View {
    @State private var search = ""
    @State private var section: String?
    @State private var available = false
    @State private var archived = false
    @State private var sections: [String] = []
    @State private var loader: PagedLoader<StaffBook>
    @State private var creating = false
    @State private var importing = false
    @State private var appeared = false

    private let api = StaffAPI()

    init() {
        let api = StaffAPI()
        _loader = State(initialValue: PagedLoader(limit: 30) { request in
            try await api.books(search: "", section: nil, available: false, archived: false, request)
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: isFiltered
                    ? String(localized: "staff.cat.nothing", defaultValue: "Ничего не найдено")
                    : String(localized: "staff.cat.empty", defaultValue: "В каталоге пока нет книг"),
                symbol: "books.vertical",
                hint: isFiltered ? nil : String(localized: "staff.cat.empty.hint", defaultValue: "Добавьте книгу вручную или загрузите фонд из таблицы."),
                actionTitle: isFiltered ? nil : String(localized: "staff.cat.addBook", defaultValue: "Добавить книгу"),
                action: isFiltered ? nil : { creating = true }
            ),
            header: {
                FilterChipsRow(
                    options: [
                        (value: String?.none, title: String(localized: "staff.cat.allBooks", defaultValue: "Все книги")),
                        (value: Optional("available"), title: String(localized: "staff.cat.onlyAvailable", defaultValue: "Есть на полке")),
                        (value: Optional("archived"), title: String(localized: "staff.cat.showArchive", defaultValue: "Архив")),
                    ],
                    selection: Binding(
                        get: { archived ? "archived" : (available ? "available" : nil) },
                        set: { value in
                            available = value == "available"
                            archived = value == "archived"
                        }
                    )
                )
                if let section {
                    Section {
                        HStack {
                            Label(section, systemImage: "folder")
                                .font(Typography.meta)
                                .foregroundStyle(Palette.foreground)
                            Spacer()
                            Button {
                                self.section = nil
                            } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(String(localized: "staff.cat.allSections", defaultValue: "Все разделы")))
                        }
                    }
                }
            },
            row: { book in
                NavigationLink(value: AppRoute.staff(.libraryBook(id: book.id))) {
                    StaffBookRow(book: book)
                }
            }
        )
        .navigationTitle(Text(StaffScreen.libraryCatalog.title))
        .adminPinnedSearch($search, prompt: String(localized: "staff.cat.search", defaultValue: "Название, автор или ISBN")) { _ in
            await reload()
        }
        .floatingAction(String(localized: "staff.cat.addBook", defaultValue: "Добавить книгу")) {
            creating = true
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if !sections.isEmpty {
                        Picker(String(localized: "staff.cat.section", defaultValue: "Раздел"), selection: $section) {
                            Text(String(localized: "staff.cat.allSections", defaultValue: "Все разделы")).tag(String?.none)
                            ForEach(sections, id: \.self) { Text($0).tag(String?.some($0)) }
                        }
                        .pickerStyle(.menu)
                    }
                    Button {
                        importing = true
                    } label: {
                        Label(String(localized: "staff.cat.import", defaultValue: "Импорт из файла"), systemImage: "square.and.arrow.down")
                    }
                } label: {
                    Image(systemName: section == nil ? "ellipsis.circle" : "ellipsis.circle.fill")
                }
                .accessibilityLabel(Text(String(localized: "staff.cat.more", defaultValue: "Раздел и импорт")))
            }
        }
        .onChange(of: available) { Task { await reload() } }
        .onChange(of: archived) { Task { await reload() } }
        .onChange(of: section) { Task { await reload() } }
        .sheet(isPresented: $creating) {
            StaffBookFormSheet(book: nil) { await loader.reload() }
        }
        .sheet(isPresented: $importing) {
            StaffLibraryImportSheet { await loader.reload() }
        }
        .task {
            if sections.isEmpty { sections = (try? await api.bookSections()) ?? [] }
        }
        .onAppear {
            if appeared { Task { await loader.reload() } }
            appeared = true
        }
    }

    private var isFiltered: Bool {
        available || archived || section != nil || !search.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func reload() async {
        let needle = search
        let section = section
        let available = available
        let archived = archived
        await loader.replace { request in
            try await api.books(search: needle, section: section, available: available, archived: archived, request)
        }
    }
}

private struct StaffBookRow: View {
    let book: StaffBook

    var body: some View {
        let availability = StaffLibraryText.availability(book)
        TelegramStyleRow(
            title: book.title,
            subtitle: subtitle,
            meta: book.availability.onLoan > 0
                ? String(localized: "staff.cat.onLoanCount", defaultValue: "Выдано: \(book.availability.onLoan.formatted())")
                : nil
        ) {
            BookCoverView(url: book.coverUrl, width: 40)
        } accessory: {
            if book.archived {
                StatusBadge(text: String(localized: "staff.cat.archived", defaultValue: "В архиве"), tint: Palette.mutedForeground)
            } else {
                StatusBadge(text: availability.0, tint: availability.1)
            }
        }
    }

    private var subtitle: String {
        var first: [String] = []
        if !book.authors.isEmpty { first.append(book.authors) }
        if let year = book.year { first.append(String(year)) }
        var lines: [String] = []
        if !first.isEmpty { lines.append(first.joined(separator: " · ")) }
        if let section = book.section, !section.isEmpty { lines.append(section) }
        return lines.joined(separator: "\n")
    }
}

// MARK: - Карточка книги

private struct StaffBookFormSheet: View {
    let book: StaffBook?
    let saved: () async -> Void

    @State private var title = ""
    @State private var authors = ""
    @State private var isbn = ""
    @State private var publisher = ""
    @State private var year = ""
    @State private var section = ""
    @State private var description = ""

    private let api = StaffAPI()

    var body: some View {
        FormSheet(
            title: book == nil
                ? String(localized: "staff.cat.addBook", defaultValue: "Добавить книгу")
                : String(localized: "staff.cat.editBook", defaultValue: "Изменить карточку"),
            canSave: problem == nil,
            save: {
                let input = StaffBookInput(
                    title: title.trimmingCharacters(in: .whitespaces),
                    authors: authors.trimmingCharacters(in: .whitespaces),
                    isbn: clean(isbn)?.replacingOccurrences(of: "-", with: "").replacingOccurrences(of: " ", with: ""),
                    publisher: clean(publisher),
                    year: Int(year),
                    section: clean(section),
                    description: clean(description)
                )
                if let book {
                    try await api.updateBook(id: book.id, input)
                } else {
                    _ = try await api.createBook(input)
                }
            },
            saved: saved
        ) {
            if let problem {
                Section {
                    Text(problem).font(Typography.meta).foregroundStyle(Palette.destructive)
                }
                .listRowBackground(Color.clear)
            }
            Section {
                TextField(String(localized: "staff.cat.field.title", defaultValue: "Название"), text: $title, axis: .vertical)
                TextField(String(localized: "staff.cat.field.authors", defaultValue: "Авторы"), text: $authors)
                TextField("ISBN", text: $isbn)
                    .keyboardType(.numbersAndPunctuation)
                    .autocorrectionDisabled()
            }
            Section {
                TextField(String(localized: "staff.cat.field.publisher", defaultValue: "Издательство"), text: $publisher)
                TextField(String(localized: "staff.cat.field.year", defaultValue: "Год издания"), text: $year)
                    .keyboardType(.numberPad)
                TextField(String(localized: "staff.cat.field.section", defaultValue: "Раздел"), text: $section)
            }
            Section(String(localized: "staff.cat.field.description", defaultValue: "Описание")) {
                TextField(String(localized: "staff.cat.field.description", defaultValue: "Описание"), text: $description, axis: .vertical)
                    .lineLimit(3...8)
            }
        }
        .onAppear {
            guard let book, title.isEmpty else { return }
            title = book.title
            authors = book.authors
            isbn = book.isbn ?? ""
            publisher = book.publisher ?? ""
            year = book.year.map { String($0) } ?? ""
            section = book.section ?? ""
            description = book.description ?? ""
        }
    }

    private func clean(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Пустая форма — без подсказки: ошибку показываем, только когда что-то введено не так.
    private var problem: String? {
        if title.trimmingCharacters(in: .whitespaces).isEmpty {
            return title.isEmpty ? "" : String(localized: "staff.cat.titleRequired", defaultValue: "Укажите название")
        }
        let digits = isbn.uppercased().filter { !$0.isWhitespace && $0 != "-" }
        if !digits.isEmpty, digits.range(of: "^(\\d{9}[\\dX]|\\d{13})$", options: .regularExpression) == nil {
            return String(localized: "staff.cat.isbnInvalid", defaultValue: "ISBN — 10 или 13 цифр")
        }
        if !year.isEmpty {
            let limit = Calendar.current.component(.year, from: Date()) + 1
            guard let value = Int(year), (1450...limit).contains(value) else {
                return String(localized: "staff.cat.yearInvalid", defaultValue: "Год — четыре цифры")
            }
        }
        return nil
    }
}

struct StaffBookDetailView: View {
    let bookID: String

    @State private var book: StaffBook?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var notice: String?
    @State private var editing = false
    @State private var addingCopies = false
    @State private var editingCopy: StaffBookCopy?
    @State private var historyCopy: StaffBookCopy?
    @State private var rotating: StaffBookCopy?
    @State private var confirmArchive = false
    @State private var selected: Set<String> = []
    @State private var coverPick: PhotosPickerItem?
    @State private var pickingCover = false
    @State private var isWorking = false
    @State private var sheetFile: URL?

    private let api = StaffAPI()

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
        .navigationTitle(Text(StaffScreen.libraryBook(id: bookID).title))
        .navigationBarTitleDisplayMode(.inline)
        .photosPicker(isPresented: $pickingCover, selection: $coverPick, matching: .images)
        .sheet(isPresented: $editing) {
            if let book { StaffBookFormSheet(book: book) { await load() } }
        }
        .sheet(isPresented: $addingCopies) {
            StaffAddCopiesSheet(bookID: bookID) { await load() }
        }
        .sheet(item: $editingCopy) { copy in
            StaffCopyEditSheet(copy: copy) { await load() }
        }
        .sheet(item: $historyCopy) { copy in
            StaffCopyHistorySheet(copy: copy)
        }
        .sheet(item: Binding(get: { sheetFile.map { StaffDownloadedFile(url: $0) } }, set: { sheetFile = $0?.url })) { file in
            StaffActivitySheet(items: [file.url])
        }
        .alert(
            String(localized: "staff.cat.archive.title", defaultValue: "Убрать книгу в архив?"),
            isPresented: $confirmArchive
        ) {
            Button(String(localized: "staff.cat.archive", defaultValue: "В архив")) { Task { await setArchived(true) } }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: {
            Text(String(localized: "staff.cat.archive.message", defaultValue: "Книга исчезнет из каталога читателей. История выдач останется, вернуть из архива можно в любой момент."))
        }
        .confirmDestructive(
            $rotating,
            title: { copy in
                String(localized: "staff.cat.rotate.confirm", defaultValue: "Перевыпустить наклейку? Старая наклейка экземпляра \(copy.inventoryNumber) перестанет работать — наклейте новую.")
            },
            actionTitle: String(localized: "staff.cat.rotate", defaultValue: "Перевыпустить наклейку")
        ) { copy in
            await rotate(copy)
        }
        .onChange(of: coverPick) { _, item in
            guard let item else { return }
            Task { await uploadCover(item) }
        }
        .actionFailureAlert($actionFailure)
        .alert(
            String(localized: "staff.cat.done", defaultValue: "Готово"),
            isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(notice ?? "")
        }
        .overlay {
            if isWorking {
                ProgressView()
                    .padding(Spacing.xl)
                    .glassSurface(interactive: false, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func content(_ book: StaffBook) -> some View {
        let copies = book.copies ?? []
        let availability = StaffLibraryText.availability(book)
        List {
            // Шапка как у карточки человека: обложка по центру, название, плашки и ряд
            // круглых кнопок — вместо аватара здесь книга.
            Section {
                VStack(spacing: Spacing.sm) {
                    BookCoverView(url: book.coverUrl, width: 96)
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
                    HStack(spacing: Spacing.sm) {
                        if book.archived {
                            StatusBadge(text: String(localized: "staff.cat.archived", defaultValue: "В архиве"), tint: Palette.mutedForeground)
                        } else {
                            StatusBadge(text: availability.0, tint: availability.1)
                        }
                        if book.availability.reserved > 0 {
                            StatusBadge(
                                text: String(localized: "staff.cat.reservedCount", defaultValue: "Под бронью: \(book.availability.reserved.formatted())"),
                                tint: Palette.warning
                            )
                        }
                    }
                    HeroActionRow(actions: heroActions(book, copies: copies)) {
                        HeroMenuItem(String(localized: "staff.cat.cover", defaultValue: "Обложка"), symbol: "photo") {
                            pickingCover = true
                        }
                        HeroMenuDivider()
                        if book.archived {
                            HeroMenuItem(String(localized: "staff.cat.restore", defaultValue: "Вернуть из архива"), symbol: "tray.and.arrow.up") {
                                Task { await setArchived(false) }
                            }
                        } else {
                            HeroMenuItem(String(localized: "staff.cat.archive", defaultValue: "В архив"), symbol: "archivebox", isDestructive: true) {
                                confirmArchive = true
                            }
                        }
                    }
                    .padding(.top, Spacing.md)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.sm)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: Spacing.sm, leading: 0, bottom: Spacing.sm, trailing: 0))
            }

            Section {
                if let isbn = book.isbn { DetailRow(title: "ISBN", value: isbn, symbol: "barcode") }
                if let publisher = book.publisher {
                    DetailRow(title: String(localized: "staff.cat.field.publisher", defaultValue: "Издательство"), value: publisher, symbol: "building.2")
                }
                if let year = book.year {
                    DetailRow(title: String(localized: "staff.cat.field.year", defaultValue: "Год издания"), value: String(year), symbol: "calendar")
                }
                if let section = book.section {
                    DetailRow(title: String(localized: "staff.cat.section", defaultValue: "Раздел"), value: section, symbol: "folder")
                }
                if let description = book.description, !description.isEmpty {
                    Text(description).font(Typography.body).foregroundStyle(Palette.mutedForeground)
                }
            }

            Section {
                if copies.isEmpty {
                    Text(String(localized: "staff.cat.noCopies.hint", defaultValue: "Добавьте экземпляры — каждому выдаётся инвентарный номер и QR-наклейка."))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                ForEach(copies) { copy in
                    copyRow(copy)
                }
                Button {
                    addingCopies = true
                } label: {
                    Label(String(localized: "staff.cat.addCopies", defaultValue: "Добавить экземпляры"), systemImage: "plus")
                }
                .disabled(book.archived)
                if !copies.isEmpty {
                    Button {
                        Task { await printLabels(selected.isEmpty ? copies.map(\.id) : Array(selected)) }
                    } label: {
                        Label(
                            selected.isEmpty
                                ? String(localized: "staff.cat.printAll", defaultValue: "Наклейки для всех экземпляров")
                                : String(localized: "staff.cat.printSelected", defaultValue: "Наклейки для выбранных: \(selected.count.formatted())"),
                            systemImage: "printer"
                        )
                    }
                }
            } header: {
                Text(String(localized: "staff.cat.copies", defaultValue: "Экземпляры"))
            } footer: {
                Text(String(localized: "staff.cat.copies.hint", defaultValue: "Нажмите на кружок, чтобы выбрать экземпляры для печати наклеек. Наклейки собираются в PDF — его можно напечатать или сохранить."))
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .pullToRefresh { await load() }
    }

    private func heroActions(_ book: StaffBook, copies: [StaffBookCopy]) -> [HeroAction] {
        var actions = [
            HeroAction(title: String(localized: "staff.cat.editShort", defaultValue: "Изменить"), symbol: "pencil") { editing = true },
        ]
        if !book.archived {
            actions.append(HeroAction(title: String(localized: "staff.cat.copiesShort", defaultValue: "Экземпляры"), symbol: "plus.square.on.square") {
                addingCopies = true
            })
        }
        if !copies.isEmpty {
            actions.append(HeroAction(title: String(localized: "staff.cat.labelsShort", defaultValue: "Наклейки"), symbol: "printer") {
                Task { await printLabels(selected.isEmpty ? copies.map(\.id) : Array(selected)) }
            })
        }
        return actions
    }

    private func copyRow(_ copy: StaffBookCopy) -> some View {
        let status = StaffLibraryText.copyStatus(copy.status)
        let isSelected = selected.contains(copy.id)
        return HStack(alignment: .top, spacing: Spacing.md) {
            Button {
                if isSelected { selected.remove(copy.id) } else { selected.insert(copy.id) }
            } label: {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? Palette.primary : Palette.mutedForeground)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(Text(String(localized: "staff.cat.selectCopy", defaultValue: "Выбрать экземпляр \(copy.inventoryNumber)")))

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(copy.inventoryNumber).font(Typography.body.weight(.medium).monospacedDigit())
                    Spacer(minLength: Spacing.md)
                    StatusBadge(text: status.0, tint: status.1)
                }
                Text(verbatim: "\(StaffLibraryText.code(copy.code)) · \(StaffLibraryText.condition(copy.condition))")
                    .font(Typography.meta.monospaced())
                    .foregroundStyle(Palette.mutedForeground)
                if let loan = copy.loan {
                    let overdue = loan.dueAt < Date()
                    Text([loan.readerName, loan.readerGroup].compactMap { $0 }.joined(separator: " · "))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.foreground)
                    Text(String(localized: "staff.cat.dueUntil", defaultValue: "до \(DisplayFormat.date(loan.dueAt))"))
                        .font(Typography.meta)
                        .foregroundStyle(overdue ? Palette.destructive : Palette.mutedForeground)
                } else if let note = copy.note, !note.isEmpty {
                    Text(note).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                }
            }
        }
        .contentShape(Rectangle())
        .contextMenu {
            Button {
                editingCopy = copy
            } label: {
                Label(String(localized: "staff.cat.editCopy", defaultValue: "Изменить экземпляр"), systemImage: "pencil")
            }
            Button {
                Task { await printLabels([copy.id]) }
            } label: {
                Label(String(localized: "staff.cat.printOne", defaultValue: "Напечатать наклейку"), systemImage: "printer")
            }
            Button {
                historyCopy = copy
            } label: {
                Label(String(localized: "staff.cat.history", defaultValue: "История выдач"), systemImage: "clock.arrow.circlepath")
            }
            Button(role: .destructive) {
                rotating = copy
            } label: {
                Label(String(localized: "staff.cat.rotate", defaultValue: "Перевыпустить наклейку"), systemImage: "arrow.triangle.2.circlepath")
            }
        }
        .swipeActions {
            Button {
                editingCopy = copy
            } label: {
                Label(String(localized: "staff.cat.editCopy", defaultValue: "Изменить экземпляр"), systemImage: "pencil")
            }
            .tint(Palette.primary)
            Button {
                historyCopy = copy
            } label: {
                Label(String(localized: "staff.cat.history", defaultValue: "История выдач"), systemImage: "clock")
            }
            .tint(Palette.info)
        }
    }

    // MARK: Действия

    @MainActor
    private func load() async {
        do {
            book = try await api.book(id: bookID)
            failure = nil
            isOffline = false
        } catch {
            if book == nil {
                failure = error.userMessage
                isOffline = error.isOffline
            } else {
                actionFailure = error.userMessage
            }
        }
    }

    @MainActor
    private func setArchived(_ archived: Bool) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await api.setBookArchived(id: bookID, archived: archived)
            notice = archived
                ? String(localized: "staff.cat.archivedToast", defaultValue: "Книга в архиве")
                : String(localized: "staff.cat.restoredToast", defaultValue: "Книга снова в каталоге")
            await load()
        } catch let error as APIError where error.code == .conflict {
            actionFailure = String(localized: "staff.cat.archiveBusy", defaultValue: "Нельзя: экземпляры выданы или отложены под бронь")
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func rotate(_ copy: StaffBookCopy) async {
        isWorking = true
        defer { isWorking = false }
        do {
            let label = try await api.rotateCopyCode(id: copy.id)
            await load()
            sheetFile = try StaffLabelSheet.pdf([label])
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func printLabels(_ ids: [String]) async {
        guard !ids.isEmpty else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let labels = try await api.copyLabels(Array(ids.prefix(200)))
            sheetFile = try StaffLabelSheet.pdf(labels)
            selected = []
        } catch {
            actionFailure = error.userMessage
        }
    }

    /// Обложка в пропорциях книги (2:3), 600 пикселей по ширине — хватает на карточку.
    @MainActor
    private func uploadCover(_ item: PhotosPickerItem) async {
        defer { coverPick = nil }
        isWorking = true
        defer { isWorking = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
                  let jpeg = StaffLabelSheet.cover(image)
            else { return }
            try await api.uploadBookCover(id: bookID, data: jpeg)
            notice = String(localized: "staff.cat.coverSaved", defaultValue: "Обложка сохранена")
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

// MARK: - Экземпляры

private struct StaffAddCopiesSheet: View {
    let bookID: String
    let added: () async -> Void

    @State private var byNumbers = false
    @State private var count = 1
    @State private var numbers = ""
    @State private var condition = "GOOD"

    private let api = StaffAPI()

    var body: some View {
        StaffFormSheet(
            title: String(localized: "staff.cat.addCopies", defaultValue: "Добавить экземпляры"),
            canSave: !byNumbers || (!parsed.isEmpty && parsed.count <= 200 && parsed.allSatisfy { $0.count <= 40 }),
            save: {
                do {
                    try await api.addCopies(
                        bookID: bookID,
                        count: byNumbers ? nil : count,
                        inventoryNumbers: byNumbers ? parsed : nil,
                        condition: condition
                    )
                } catch let error as APIError where error.code == .conflict {
                    throw StaffMessageError(message: String(localized: "staff.cat.inventoryTaken", defaultValue: "Такой инвентарный номер уже есть в фонде"))
                }
            },
            saved: added
        ) {
            Section {
                Picker(String(localized: "staff.cat.mode", defaultValue: "Как добавить"), selection: $byNumbers) {
                    Text(String(localized: "staff.cat.modeCount", defaultValue: "Количеством")).tag(false)
                    Text(String(localized: "staff.cat.modeNumbers", defaultValue: "Номерами")).tag(true)
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())

            Section {
                if byNumbers {
                    TextField(String(localized: "staff.cat.inventoryNumbers", defaultValue: "Инвентарные номера"), text: $numbers, axis: .vertical)
                        .lineLimit(3...8)
                        .autocorrectionDisabled()
                } else {
                    Stepper(value: $count, in: 1...200) {
                        StaffValueRow(title: String(localized: "staff.cat.copiesCount", defaultValue: "Сколько экземпляров"), value: count.formatted(), tint: Palette.foreground)
                    }
                }
                Picker(String(localized: "staff.cat.condition", defaultValue: "Состояние"), selection: $condition) {
                    ForEach(StaffLibraryText.conditions, id: \.self) { Text(StaffLibraryText.condition($0)).tag($0) }
                }
            } footer: {
                Text(byNumbers
                    ? String(localized: "staff.cat.numbers.hint", defaultValue: "Через запятую или с новой строки.")
                    : String(localized: "staff.cat.count.hint", defaultValue: "Номера выдадутся по порядку после наибольшего номера фонда."))
            }
        }
    }

    private var parsed: [String] {
        numbers.split(whereSeparator: { $0 == "," || $0.isNewline })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}

/// Правка экземпляра. Статус вручную — только вывод из оборота (утерян, списан) и возврат
/// на полку из них; выдачу и бронь двигают сами выдачи и брони.
private struct StaffCopyEditSheet: View {
    let copy: StaffBookCopy
    let saved: () async -> Void

    @State private var inventoryNumber = ""
    @State private var condition = "GOOD"
    @State private var note = ""
    @State private var status = "AVAILABLE"

    private let api = StaffAPI()

    var body: some View {
        StaffFormSheet(
            title: String(localized: "staff.cat.editCopy", defaultValue: "Изменить экземпляр"),
            canSave: !inventoryNumber.trimmingCharacters(in: .whitespaces).isEmpty && inventoryNumber.count <= 40 && note.count <= 500,
            save: {
                do {
                    try await api.updateCopy(
                        id: copy.id,
                        inventoryNumber: inventoryNumber.trimmingCharacters(in: .whitespaces),
                        condition: condition,
                        note: note,
                        status: status == copy.status ? nil : status
                    )
                } catch let error as APIError where error.code == .conflict {
                    throw StaffMessageError(message: String(localized: "staff.cat.copyBusy", defaultValue: "Экземпляр выдан или отложен под бронь"))
                }
            },
            saved: saved
        ) {
            Section {
                TextField(String(localized: "staff.cat.inventoryNumber", defaultValue: "Инв. номер"), text: $inventoryNumber)
                Picker(String(localized: "staff.cat.condition", defaultValue: "Состояние"), selection: $condition) {
                    ForEach(StaffLibraryText.conditions, id: \.self) { Text(StaffLibraryText.condition($0)).tag($0) }
                }
                TextField(String(localized: "staff.cat.note", defaultValue: "Заметка"), text: $note, axis: .vertical)
                    .lineLimit(2...5)
            }
            if canChangeStatus {
                Section {
                    Picker(String(localized: "staff.cat.statusLabel", defaultValue: "Статус"), selection: $status) {
                        Text(String(localized: "staff.cat.backToShelf", defaultValue: "На полке")).tag("AVAILABLE")
                        Text(String(localized: "staff.cat.markLost", defaultValue: "Утерян")).tag("LOST")
                        Text(String(localized: "staff.cat.writeOff", defaultValue: "Списан")).tag("WRITTEN_OFF")
                    }
                } footer: {
                    Text(String(localized: "staff.cat.withdraw.hint", defaultValue: "Утерянный или списанный экземпляр выходит из оборота. История выдач останется, вернуть на полку можно позже."))
                }
            }
        }
        .onAppear {
            guard inventoryNumber.isEmpty else { return }
            inventoryNumber = copy.inventoryNumber
            condition = copy.condition
            note = copy.note ?? ""
            status = copy.status
        }
    }

    private var canChangeStatus: Bool { ["AVAILABLE", "LOST", "WRITTEN_OFF"].contains(copy.status) }
}

/// История экземпляра: все его выдачи — кто, когда, чем закончилась.
private struct StaffCopyHistorySheet: View {
    let copy: StaffBookCopy

    @Environment(\.dismiss) private var dismiss
    private let api = StaffAPI()

    var body: some View {
        NavigationStack {
            RemoteContent(load: { try await api.loans(filter: "all", copyID: copy.id, limit: 100) }) { loans in
                List {
                    ForEach(loans) { loan in
                        VStack(alignment: .leading, spacing: 2) {
                            StaffLoanRow(loan: loan)
                            Text([
                                String(localized: "staff.cat.history.issued", defaultValue: "выдан \(DisplayFormat.date(loan.issuedAt))"),
                                loan.returnedAt.map { String(localized: "staff.cat.history.returned", defaultValue: "возвращён \(DisplayFormat.date($0))") },
                                loan.cancelReason.map { String(localized: "staff.cat.history.cancelReason", defaultValue: "причина отмены: \($0)") },
                            ].compactMap { $0 }.joined(separator: " · "))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .screenState(loans.isEmpty) {
                    EmptyStateView(
                        title: String(localized: "staff.cat.history.empty", defaultValue: "Экземпляр ещё не выдавали"),
                        symbol: "clock"
                    )
                }
            }
            .navigationTitle(Text(String(localized: "staff.cat.history.title", defaultValue: "История экземпляра \(copy.inventoryNumber)")))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
        }
    }
}

// MARK: - Наклейки и обложка

/// Лист наклеек: QR, инвентарный номер, название — сеткой на A4. Веб печатает их через
/// окно браузера; здесь — PDF, который отдаётся в «Поделиться» (печать, «Файлы»).
enum StaffLabelSheet {
    static func pdf(_ labels: [StaffCopyLabel]) throws -> URL {
        let page = CGRect(x: 0, y: 0, width: 595, height: 842)
        let margin: CGFloat = 24
        let columns = 3
        let rows = 7
        let cellWidth = (page.width - margin * 2) / CGFloat(columns)
        let cellHeight = (page.height - margin * 2) / CGFloat(rows)
        let renderer = UIGraphicsPDFRenderer(bounds: page)
        let data = renderer.pdfData { context in
            for (index, label) in labels.enumerated() {
                let slot = index % (columns * rows)
                if slot == 0 { context.beginPage() }
                let column = slot % columns
                let row = slot / columns
                let cell = CGRect(
                    x: margin + CGFloat(column) * cellWidth,
                    y: margin + CGFloat(row) * cellHeight,
                    width: cellWidth,
                    height: cellHeight
                ).insetBy(dx: 6, dy: 6)
                draw(label, in: cell)
            }
        }
        let name = String(localized: "staff.cat.labelsFile", defaultValue: "Наклейки") + ".pdf"
        return try StaffPickedFile.temporary(data, name: name)
    }

    private static func draw(_ label: StaffCopyLabel, in cell: CGRect) {
        UIColor.lightGray.setStroke()
        let border = UIBezierPath(roundedRect: cell, cornerRadius: 6)
        border.lineWidth = 0.5
        border.stroke()
        let qrSide = min(cell.height - 12, cell.width * 0.45)
        if let image = qrImage(label.qr) {
            image.draw(in: CGRect(x: cell.minX + 6, y: cell.midY - qrSide / 2, width: qrSide, height: qrSide))
        }
        let textRect = CGRect(x: cell.minX + qrSide + 12, y: cell.minY + 6, width: cell.width - qrSide - 18, height: cell.height - 12)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        let text = NSMutableAttributedString(
            string: label.inventoryNumber + "\n",
            attributes: [.font: UIFont.boldSystemFont(ofSize: 11), .paragraphStyle: paragraph]
        )
        text.append(NSAttributedString(
            string: label.title + "\n",
            attributes: [.font: UIFont.systemFont(ofSize: 8), .paragraphStyle: paragraph]
        ))
        if let university = label.university {
            text.append(NSAttributedString(
                string: university,
                attributes: [.font: UIFont.systemFont(ofSize: 7), .foregroundColor: UIColor.darkGray, .paragraphStyle: paragraph]
            ))
        }
        text.draw(with: textRect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], context: nil)
    }

    /// QR приходит PNG в data-URL.
    private static func qrImage(_ dataURL: String) -> UIImage? {
        DataURLImage.image(from: dataURL)
    }

    /// Обложка: обрезка по центру до 2:3 и уменьшение до 600 пикселей по ширине.
    static func cover(_ image: UIImage) -> Data? {
        let size = image.size
        let targetRatio: CGFloat = 2.0 / 3.0
        var crop = CGRect(origin: .zero, size: size)
        if size.width / size.height > targetRatio {
            let width = size.height * targetRatio
            crop = CGRect(x: (size.width - width) / 2, y: 0, width: width, height: size.height)
        } else {
            let height = size.width / targetRatio
            crop = CGRect(x: 0, y: (size.height - height) / 2, width: size.width, height: height)
        }
        let output = CGSize(width: 600, height: 900)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let rendered = UIGraphicsImageRenderer(size: output, format: format).image { _ in
            let scale = output.width / crop.width
            image.draw(in: CGRect(
                x: -crop.minX * scale,
                y: -crop.minY * scale,
                width: size.width * scale,
                height: size.height * scale
            ))
        }
        return rendered.jpegData(compressionQuality: 0.85)
    }
}

// MARK: - Импорт фонда

/// Файл разбирает сервер; здесь — предпросмотр с ошибками по строкам и запись только
/// готовых строк.
private struct StaffLibraryImportSheet: View {
    let imported: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var preview: StaffImportPreview?
    @State private var picking = false
    @State private var isWorking = false
    @State private var failure: String?
    @State private var result: String?

    private let api = StaffAPI()

    var body: some View {
        NavigationStack {
            List {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    Text(String(
                        localized: "staff.cat.import.hint",
                        defaultValue: "Таблица CSV или Excel: первая строка — заголовки. Обязательна колонка «Название»; ещё можно «Авторы», «ISBN», «Издательство», «Год», «Раздел», «Инвентарный номер» (несколько — через запятую) или «Количество»."
                    ))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    Button {
                        picking = true
                    } label: {
                        Label(
                            preview == nil
                                ? String(localized: "staff.cat.import.choose", defaultValue: "Выбрать файл")
                                : String(localized: "staff.cat.import.another", defaultValue: "Выбрать другой файл"),
                            systemImage: "doc.badge.plus"
                        )
                    }
                    .disabled(isWorking)
                }

                if let preview {
                    Section {
                        Text(String(
                            localized: "staff.cat.import.summary",
                            defaultValue: "Строк: \(preview.summary.total.formatted()). Готово: \(preview.summary.ready.formatted()), повторов: \(preview.summary.duplicate.formatted()), с ошибкой: \(preview.summary.error.formatted()). Экземпляров к заведению: \(preview.summary.copies.formatted())."
                        ))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.foreground)
                        if preview.rows.isEmpty {
                            Text(String(localized: "staff.cat.import.empty", defaultValue: "В файле нет строк"))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        ForEach(preview.rows) { row in
                            importRow(row)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Text(String(localized: "staff.cat.import.title", defaultValue: "Импорт фонда")))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isWorking)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                        .disabled(isWorking)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isWorking {
                        ProgressView()
                    } else {
                        Button(String(localized: "staff.cat.import.commit", defaultValue: "Импортировать")) {
                            Task { await commit() }
                        }
                        .disabled(readyRows.isEmpty)
                    }
                }
            }
            .fileImporter(
                isPresented: $picking,
                allowedContentTypes: [.commaSeparatedText, .staffXlsx, .spreadsheet, .plainText]
            ) { result in
                Task { await loadPreview(result) }
            }
            .alert(
                String(localized: "staff.cat.import.done", defaultValue: "Импорт завершён"),
                isPresented: Binding(get: { result != nil }, set: { if !$0 { result = nil; dismiss() } })
            ) {
                Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
            } message: {
                Text(result ?? "")
            }
        }
    }

    private var readyRows: [StaffImportRow] { (preview?.rows ?? []).filter { $0.status == "READY" } }

    private func importRow(_ row: StaffImportRow) -> some View {
        let status: (String, Color) = {
            switch row.status {
            case "READY": return (String(localized: "staff.cat.import.ready", defaultValue: "Готово"), Palette.success)
            case "DUPLICATE": return (String(localized: "staff.cat.import.duplicate", defaultValue: "Повтор"), Palette.warning)
            default: return (String(localized: "staff.cat.import.error", defaultValue: "Ошибка"), Palette.destructive)
            }
        }()
        let copies = row.inventoryNumbers.isEmpty ? row.count : row.inventoryNumbers.count
        return VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: "\(row.line). \(row.title)")
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                Spacer(minLength: Spacing.md)
                StatusBadge(text: status.0, tint: status.1)
            }
            Text([
                row.authors.isEmpty ? nil : row.authors,
                String(localized: "staff.cat.import.copies", defaultValue: "Экземпляров: \(copies.formatted())"),
            ].compactMap { $0 }.joined(separator: " · "))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            if let error = row.error, !error.isEmpty {
                Text(error).font(Typography.meta).foregroundStyle(Palette.destructive)
            }
        }
    }

    @MainActor
    private func loadPreview(_ result: Result<URL, Error>) async {
        guard let file = StaffPickedFile.read(result) else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            preview = try await api.importPreview(data: file.data, name: file.name, mime: file.mime)
            failure = nil
        } catch let error as APIError where error.code == .badRequest {
            failure = String(localized: "staff.cat.import.format", defaultValue: "Не удалось прочитать файл. Проверьте: формат .csv или .xlsx, первая строка — заголовки, есть колонка «Название».")
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func commit() async {
        isWorking = true
        defer { isWorking = false }
        do {
            let done = try await api.importCommit(readyRows)
            await imported()
            result = String(
                localized: "staff.cat.import.result",
                defaultValue: "Новых книг: \(done.books.formatted()), найдено в каталоге: \(done.matched.formatted()), экземпляров заведено: \(done.copies.formatted())"
            )
        } catch let error as APIError where error.code == .conflict {
            failure = String(localized: "staff.cat.inventoryTaken", defaultValue: "Такой инвентарный номер уже есть в фонде")
        } catch {
            failure = error.userMessage
        }
    }
}
