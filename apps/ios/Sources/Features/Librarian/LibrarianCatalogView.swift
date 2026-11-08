import SwiftUI
import UniformTypeIdentifiers

/// Каталог фонда (веб `/library/catalog`): поиск по названию, авторам и ISBN, раздел,
/// «есть на полке», архив, сортировка; заведение книги и импорт фонда из таблицы.
struct LibrarianCatalogView: View {
    @State private var loader: PagedLoader<LibrarianBookDTO>
    @State private var search = ""
    @State private var section: String?
    @State private var sections: [String] = []
    @State private var onlyAvailable = false
    @State private var archived = false
    @State private var sort = "title"
    @State private var descending = false
    @State private var creating = false
    @State private var importing = false
    @State private var createdBookID: String?

    private static let api = LibrarianAPI()

    init() {
        _loader = State(initialValue: PagedLoader(limit: 30) { request in
            try await Self.api.books(request, query: nil, section: nil, available: false, archived: false, sort: "title", order: "asc")
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: isFiltered
                    ? String(localized: "librarian.nothingFound", defaultValue: "Ничего не найдено")
                    : String(localized: "librarian.catalog.empty", defaultValue: "В каталоге пока нет книг"),
                symbol: "books.vertical",
                hint: isFiltered ? nil : String(localized: "librarian.catalog.emptyHint", defaultValue: "Добавьте книгу вручную или загрузите фонд из таблицы."),
                actionTitle: isFiltered ? nil : String(localized: "librarian.catalog.addBook", defaultValue: "Добавить книгу"),
                action: isFiltered ? nil : { creating = true }
            ),
            header: {
                Section {
                    if !sections.isEmpty {
                        Picker(String(localized: "librarian.catalog.section", defaultValue: "Раздел"), selection: $section) {
                            Text(String(localized: "librarian.catalog.allSections", defaultValue: "Все разделы")).tag(String?.none)
                            ForEach(sections, id: \.self) { Text($0).tag(String?.some($0)) }
                        }
                    }
                    Toggle(String(localized: "librarian.catalog.onlyAvailable", defaultValue: "Есть на полке"), isOn: $onlyAvailable)
                    Toggle(String(localized: "librarian.catalog.showArchive", defaultValue: "Архив"), isOn: $archived)
                }
                .listRowBackground(Palette.card)
            },
            row: { book in
                NavigationLink(value: AppRoute.librarian(.book(id: book.id))) {
                    LibrarianBookRow(book: book)
                }
            }
        )
        .navigationTitle(Text(LibrarianScreen.catalog.title))
        .debouncedSearch($search, prompt: String(localized: "librarian.catalog.search", defaultValue: "Название, автор или ISBN")) { _ in
            await reload()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { creating = true } label: {
                        Label(String(localized: "librarian.catalog.addBook", defaultValue: "Добавить книгу"), systemImage: "plus")
                    }
                    Button { importing = true } label: {
                        Label(String(localized: "librarian.catalog.import", defaultValue: "Импорт из файла"), systemImage: "square.and.arrow.down")
                    }
                    Divider()
                    Picker(String(localized: "librarian.catalog.sort", defaultValue: "Сортировка"), selection: $sort) {
                        Text(String(localized: "librarian.catalog.sortTitle", defaultValue: "По названию")).tag("title")
                        Text(String(localized: "librarian.catalog.sortAuthors", defaultValue: "По авторам")).tag("authors")
                        Text(String(localized: "librarian.catalog.sortYear", defaultValue: "По году")).tag("year")
                        Text(String(localized: "librarian.catalog.sortCreated", defaultValue: "По дате добавления")).tag("createdAt")
                    }
                    Toggle(String(localized: "librarian.catalog.descending", defaultValue: "По убыванию"), isOn: $descending)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $creating) {
            LibrarianBookFormSheet(book: nil) { saved in
                createdBookID = saved.id
                await loader.reload()
                await loadSections()
            }
        }
        .sheet(isPresented: $importing) {
            LibrarianImportSheet {
                await loader.reload()
                await loadSections()
            }
        }
        .navigationDestination(item: $createdBookID) { id in LibrarianBookView(bookID: id) }
        .onChange(of: section) { _, _ in Task { await reload() } }
        .onChange(of: onlyAvailable) { _, _ in Task { await reload() } }
        .onChange(of: archived) { _, _ in Task { await reload() } }
        .onChange(of: sort) { _, _ in Task { await reload() } }
        .onChange(of: descending) { _, _ in Task { await reload() } }
        .task { await loadSections() }
    }

    private var isFiltered: Bool {
        !search.trimmingCharacters(in: .whitespaces).isEmpty || section != nil || onlyAvailable || archived
    }

    @MainActor
    private func loadSections() async {
        if let list = try? await Self.api.sections() { sections = list }
    }

    @MainActor
    private func reload() async {
        let query = String(search.trimmingCharacters(in: .whitespaces).prefix(100))
        let section = section
        let available = onlyAvailable
        let archived = archived
        let sort = sort
        let order = descending ? "desc" : "asc"
        await loader.replace { request in
            try await Self.api.books(
                request,
                query: query.isEmpty ? nil : query,
                section: section,
                available: available,
                archived: archived,
                sort: sort,
                order: order
            )
        }
    }
}

private struct LibrarianBookRow: View {
    let book: LibrarianBookDTO

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            BookCoverView(url: book.coverUrl, width: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(book.title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(3)
                let byline = [book.authors.isEmpty ? nil : book.authors, book.year.map { String($0) }, book.section]
                    .compactMap { $0 }
                    .joined(separator: " · ")
                if !byline.isEmpty {
                    Text(byline).font(Typography.meta).foregroundStyle(Palette.mutedForeground).lineLimit(2)
                }
                HStack(spacing: Spacing.xs) {
                    LibrarianAvailabilityBadge(availability: book.availability)
                    if book.availability.onLoan > 0 {
                        LibrarianBadge(
                            text: String(localized: "librarian.catalog.onLoanCount", defaultValue: "выдано: \(book.availability.onLoan.formatted())"),
                            tint: Palette.info
                        )
                    }
                    if book.isArchived {
                        LibrarianBadge(text: String(localized: "librarian.catalog.archived", defaultValue: "В архиве"), tint: Palette.mutedForeground)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// «На полке N из M», «Все выданы», «Нет экземпляров».
struct LibrarianAvailabilityBadge: View {
    let availability: LibrarianAvailabilityDTO

    var body: some View {
        if availability.total == 0 {
            LibrarianBadge(text: String(localized: "librarian.catalog.noCopies", defaultValue: "Нет экземпляров"), tint: Palette.mutedForeground)
        } else if availability.available == 0 {
            LibrarianBadge(text: String(localized: "librarian.catalog.allOut", defaultValue: "Все выданы"), tint: Palette.warning)
        } else {
            LibrarianBadge(
                text: String(
                    localized: "librarian.catalog.availableOf",
                    defaultValue: "На полке \(availability.available.formatted()) из \(availability.total.formatted())"
                ),
                tint: Palette.success
            )
        }
    }
}

// MARK: - Карточка книги

/// Заведение и правка карточки книги. ISBN — 10 или 13 цифр (дефисы убираются), год —
/// четыре цифры.
struct LibrarianBookFormSheet: View {
    let book: LibrarianBookDetailDTO?
    let saved: (LibrarianBookDTO) async -> Void

    @State private var form: LibrarianBookForm
    private let api = LibrarianAPI()

    init(book: LibrarianBookDetailDTO?, saved: @escaping (LibrarianBookDTO) async -> Void) {
        self.book = book
        self.saved = saved
        var form = LibrarianBookForm()
        if let book {
            form.title = book.title
            form.authors = book.authors
            form.isbn = book.isbn ?? ""
            form.publisher = book.publisher ?? ""
            form.year = book.year.map { String($0) } ?? ""
            form.section = book.section ?? ""
            form.description = book.description ?? ""
        }
        _form = State(initialValue: form)
    }

    var body: some View {
        FormSheet(
            title: book == nil
                ? String(localized: "librarian.catalog.addBook", defaultValue: "Добавить книгу")
                : String(localized: "librarian.book.edit", defaultValue: "Изменить карточку"),
            canSave: isValid,
            save: save
        ) {
            Section {
                TextField(String(localized: "librarian.book.title", defaultValue: "Название"), text: $form.title, axis: .vertical)
                    .lineLimit(1...3)
                TextField(
                    String(localized: "librarian.book.authors", defaultValue: "Авторы"),
                    text: $form.authors,
                    prompt: Text(String(localized: "librarian.book.authorsPlaceholder", defaultValue: "Толстой Л. Н."))
                )
                TextField(String(localized: "librarian.book.isbn", defaultValue: "ISBN"), text: $form.isbn)
                    .keyboardType(.numbersAndPunctuation)
                    .autocorrectionDisabled()
                TextField(String(localized: "librarian.book.publisher", defaultValue: "Издательство"), text: $form.publisher)
                TextField(String(localized: "librarian.book.year", defaultValue: "Год издания"), text: $form.year)
                    .keyboardType(.numberPad)
                TextField(
                    String(localized: "librarian.catalog.section", defaultValue: "Раздел"),
                    text: $form.section,
                    prompt: Text(String(localized: "librarian.book.sectionPlaceholder", defaultValue: "Например, Художественная литература"))
                )
            } footer: {
                if let problem { Text(problem).foregroundStyle(Palette.destructive) }
            }
            .listRowBackground(Palette.card)
            Section(String(localized: "librarian.book.description", defaultValue: "Описание")) {
                TextField(String(localized: "librarian.book.description", defaultValue: "Описание"), text: $form.description, axis: .vertical)
                    .lineLimit(3...10)
            }
            .listRowBackground(Palette.card)
        }
    }

    private var isbnDigits: String {
        form.isbn.filter { !$0.isWhitespace && $0 != "-" }.uppercased()
    }

    private var problem: String? {
        let title = form.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.count > 300 || form.authors.count > 300 || form.description.count > 2000 {
            return String(localized: "librarian.book.tooLong", defaultValue: "Слишком длинный текст")
        }
        if !isbnDigits.isEmpty {
            let valid = (isbnDigits.count == 13 && isbnDigits.allSatisfy(\.isNumber))
                || (isbnDigits.count == 10 && isbnDigits.dropLast().allSatisfy(\.isNumber) && (isbnDigits.last?.isNumber == true || isbnDigits.last == "X"))
            if !valid { return String(localized: "librarian.book.isbnInvalid", defaultValue: "ISBN — 10 или 13 цифр") }
        }
        let year = form.year.trimmingCharacters(in: .whitespaces)
        if !year.isEmpty {
            let maxYear = Calendar.current.component(.year, from: Date()) + 1
            guard let value = Int(year), (1450...maxYear).contains(value) else {
                return String(localized: "librarian.book.yearInvalid", defaultValue: "Год — четыре цифры")
            }
        }
        return nil
    }

    private var isValid: Bool {
        !form.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && problem == nil
    }

    @MainActor
    private func save() async throws {
        var payload = form
        payload.isbn = isbnDigits
        let result: LibrarianBookDTO
        if let book {
            result = try await api.updateBook(id: book.id, form: payload)
        } else {
            result = try await api.createBook(payload)
        }
        await saved(result)
    }
}

// MARK: - Импорт

/// Импорт фонда из CSV или Excel: проверка файла без записи, затем запись готовых строк.
private struct LibrarianImportSheet: View {
    let imported: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var choosing = false
    @State private var preview: LibrarianImportPreviewDTO?
    @State private var failure: String?
    @State private var isBusy = false
    @State private var result: LibrarianImportResultDTO?

    private let api = LibrarianAPI()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(String(localized: "librarian.import.hint", defaultValue: "Таблица CSV или Excel: первая строка — заголовки. Обязательна колонка «Название»; ещё можно «Авторы», «ISBN», «Издательство», «Год», «Раздел», «Инвентарный номер» (несколько — через запятую) или «Количество»."))
                        .font(Typography.meta)
                    Button {
                        choosing = true
                    } label: {
                        Label(
                            preview == nil
                                ? String(localized: "librarian.import.choose", defaultValue: "Выбрать файл")
                                : String(localized: "librarian.import.chooseAnother", defaultValue: "Выбрать другой файл"),
                            systemImage: "doc"
                        )
                    }
                    .disabled(isBusy)
                } footer: {
                    if let failure { Text(failure).foregroundStyle(Palette.destructive) }
                }
                .listRowBackground(Palette.card)

                if let result {
                    Section {
                        Label(
                            String(
                                localized: "librarian.import.done",
                                defaultValue: "Новых книг: \(result.books.formatted()), найдено в каталоге: \(result.matched.formatted()), экземпляров заведено: \(result.copies.formatted())"
                            ),
                            systemImage: "checkmark.circle.fill"
                        )
                        .foregroundStyle(Palette.success)
                    }
                    .listRowBackground(Palette.card)
                } else if let preview {
                    let s = preview.summary
                    Section {
                        Text(String(
                            localized: "librarian.import.summary",
                            defaultValue: "Строк: \(s.total.formatted()). Готово: \(s.ready.formatted()), повторов: \(s.duplicate.formatted()), с ошибкой: \(s.error.formatted()). Экземпляров к заведению: \(s.copies.formatted())."
                        ))
                        .font(Typography.meta)
                        Button {
                            Task { await commit() }
                        } label: {
                            HStack {
                                Spacer()
                                if isBusy { ProgressView() } else {
                                    Text(String(localized: "librarian.import.commit", defaultValue: "Импортировать строк: \(readyRows.count.formatted())")).bold()
                                }
                                Spacer()
                            }
                        }
                        .disabled(readyRows.isEmpty || isBusy)
                    }
                    .listRowBackground(Palette.card)

                    Section {
                        if preview.rows.isEmpty {
                            Text(String(localized: "librarian.import.empty", defaultValue: "В файле нет строк"))
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        ForEach(preview.rows) { row in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(verbatim: "\(row.line). \(row.title)")
                                        .font(Typography.cardTitle)
                                        .lineLimit(2)
                                    Spacer(minLength: Spacing.md)
                                    LibrarianBadge(text: status(row.status).0, tint: status(row.status).1)
                                }
                                let meta = [
                                    row.authors.isEmpty ? nil : row.authors,
                                    row.isbn,
                                    row.year.map { String($0) },
                                    row.inventoryNumbers.isEmpty
                                        ? String(localized: "librarian.import.copies", defaultValue: "экземпляров: \(row.count.formatted())")
                                        : row.inventoryNumbers.joined(separator: ", "),
                                ]
                                .compactMap { $0 }
                                .joined(separator: " · ")
                                Text(meta).font(Typography.meta).foregroundStyle(Palette.mutedForeground).lineLimit(3)
                                if let error = row.error {
                                    Text(error).font(Typography.meta).foregroundStyle(Palette.destructive)
                                }
                            }
                        }
                    }
                    .listRowBackground(Palette.card)
                } else if isBusy {
                    LoadingStateView().listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(Text(String(localized: "librarian.import.title", defaultValue: "Импорт фонда")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "librarian.close", defaultValue: "Закрыть")) { dismiss() }
                        .disabled(isBusy)
                }
            }
            .fileImporter(isPresented: $choosing, allowedContentTypes: Self.types) { outcome in
                if case .success(let url) = outcome { Task { await check(url) } }
            }
        }
    }

    private static var types: [UTType] {
        var list: [UTType] = [.commaSeparatedText, .spreadsheet]
        if let xlsx = UTType(filenameExtension: "xlsx") { list.append(xlsx) }
        if let xls = UTType(filenameExtension: "xls") { list.append(xls) }
        return list
    }

    private var readyRows: [LibrarianImportRowDTO] {
        preview?.rows.filter { $0.status == "READY" } ?? []
    }

    private func status(_ raw: String) -> (String, Color) {
        switch raw {
        case "READY": return (String(localized: "librarian.import.ready", defaultValue: "Готово"), Palette.success)
        case "DUPLICATE": return (String(localized: "librarian.import.duplicate", defaultValue: "Повтор"), Palette.warning)
        case "ERROR": return (String(localized: "librarian.import.error", defaultValue: "Ошибка"), Palette.destructive)
        default: return (raw, Palette.mutedForeground)
        }
    }

    @MainActor
    private func check(_ url: URL) async {
        isBusy = true
        defer { isBusy = false }
        result = nil
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            preview = try await api.importPreview(data: data, filename: url.lastPathComponent)
            failure = nil
        } catch {
            preview = nil
            failure = String(localized: "librarian.import.parseError", defaultValue: "Не удалось прочитать файл: проверьте формат .csv или .xlsx, первая строка — заголовки, есть колонка «Название».")
                + "\n" + error.userMessage
        }
    }

    @MainActor
    private func commit() async {
        isBusy = true
        defer { isBusy = false }
        do {
            result = try await api.importCommit(rows: readyRows)
            preview = nil
            failure = nil
            await imported()
        } catch {
            failure = error.userMessage
        }
    }
}
