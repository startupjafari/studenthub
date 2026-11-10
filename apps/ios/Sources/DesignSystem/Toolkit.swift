import QuickLook
import SwiftUI

// Общие кирпичи экранов-списков, форм и сводок. Админских разделов в вебе больше сотни,
// и все они собраны из одного и того же: список с поиском и подгрузкой, лист с формой,
// плитки цифр, строка человека, подтверждение опасного действия, открытие файла.
// Здесь они один раз — экраны отличаются данными, а не поведением.

// MARK: - Роль в окружении

private struct ViewerRoleKey: EnvironmentKey {
    static let defaultValue: Role = .unknown
}

extension EnvironmentValues {
    /// Роль вошедшего: экраны, общие для нескольких ролей (жалобы, заявки, журнал),
    /// по ней решают, какие действия показать. Решение о доступе всё равно за сервером.
    var viewerRole: Role {
        get { self[ViewerRoleKey.self] }
        set { self[ViewerRoleKey.self] = newValue }
    }
}

// MARK: - Список с подгрузкой

/// `List` над `PagedLoader`: состояния, подгрузка у последней строки, обновление жестом.
/// Шапку (фильтры, сводку) экран передаёт в `header` — она остаётся видна и при пустом
/// списке, чтобы фильтр можно было снять.
struct PagedList<Item: Decodable & Identifiable, Row: View, Header: View>: View {
    let loader: PagedLoader<Item>
    var empty: EmptyStateView
    @ViewBuilder var header: () -> Header
    @ViewBuilder var row: (Item) -> Row

    init(
        loader: PagedLoader<Item>,
        empty: EmptyStateView,
        @ViewBuilder header: @escaping () -> Header,
        @ViewBuilder row: @escaping (Item) -> Row
    ) {
        self.loader = loader
        self.empty = empty
        self.header = header
        self.row = row
    }

    var body: some View {
        List {
            header()
            if loader.isLoaded {
                if loader.items.isEmpty {
                    empty.listRowBackground(Color.clear)
                } else {
                    if let failure = loader.failure {
                        StaleDataBanner(message: failure, isOffline: loader.isOffline) { await loader.reload() }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    }
                    Section {
                        ForEach(loader.items) { item in
                            row(item)
                                .task { await loader.loadMore(after: item) }
                        }
                        if let pageFailure = loader.pageFailure {
                            PageFailureRow(message: pageFailure) { await loader.retryMore() }
                        } else if loader.hasMore {
                            HStack {
                                Spacer()
                                ProgressView()
                                Spacer()
                            }
                            .listRowBackground(Color.clear)
                        }
                    } footer: {
                        if let total = loader.total, total > 0 {
                            Text(String(localized: "common.totalCount", defaultValue: "Всего: \(total.formatted())"))
                        }
                    }

                }
            } else if let failure = loader.failure {
                ErrorStateView(message: failure, isOffline: loader.isOffline) { await loader.reload() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        // Поиск, фильтры и список — плотно, без пустых полос, которые список ставит
        // над первой секцией и между секциями.
        .listSectionSpacing(.compact)
        .contentMargins(.top, Spacing.xs, for: .scrollContent)
        .refreshable { await loader.reload() }
        .task { await loader.loadIfNeeded() }
    }
}

/// Строка под списком: следующая страница не пришла. Сразу под последним элементом —
/// там, куда человек смотрит, а не полосой наверху, которую он уже пролистал.
struct PageFailureRow: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: Spacing.sm) {
            Text(message)
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
            RetryButton(action: retry)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.md)
        .listRowBackground(Color.clear)
    }
}

extension PagedList where Header == EmptyView {
    init(loader: PagedLoader<Item>, empty: EmptyStateView, @ViewBuilder row: @escaping (Item) -> Row) {
        self.init(loader: loader, empty: empty, header: { EmptyView() }, row: row)
    }
}

// MARK: - Экран с одной загрузкой

/// Экран, который грузит одно значение: карточка, сводка, настройки. `reloadToken` —
/// повод перечитать (сохранили форму — увеличили счётчик).
struct RemoteContent<Value, Content: View>: View {
    var reloadToken: Int = 0
    let load: () async throws -> Value
    @ViewBuilder let content: (Value) -> Content

    @State private var value: Value?
    @State private var failure: String?
    @State private var isOffline = false

    var body: some View {
        Group {
            if let value {
                content(value)
                    // Обновление не удалось, а старое на экране: говорим об этом полосой,
                    // а не молча показываем несвежее (и не стираем его ошибкой).
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if let failure {
                            StaleDataBanner(message: failure, isOffline: isOffline) { await run() }
                                .padding(.horizontal, Spacing.xl)
                                .padding(.vertical, Spacing.sm)
                        }
                    }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await run() }
            } else {
                LoadingStateView()
            }
        }
        .task(id: reloadToken) { await run() }
    }

    @MainActor
    private func run() async {
        do {
            value = try await load()
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

// MARK: - Лист с формой

/// Лист «Отмена — заголовок — Сохранить» над `Form`. Ошибка сохранения показывается
/// над полями, и лист прокручивается к ней; лист не закрывается. Успех закрывает его и
/// зовёт `saved`.
///
/// Несохранённое в форме — смахнуть лист нельзя, а крестик сначала спрашивает, выбросить
/// ли правки: без этого заполненная на треть заявка терялась от случайного жеста.
/// Набранный в полях листа текст лист замечает сам (системные уведомления о вводе), так
/// что ни одна из форм не теряет напечатанное. `isDirty` — для правок без клавиатуры:
/// выбор в списке, переключатель, дата.
struct FormSheet<Content: View>: View {
    let title: String
    var saveTitle: String = String(localized: "common.save", defaultValue: "Сохранить")
    var canSave: Bool = true
    var isDirty: Bool = false
    let save: () async throws -> Void
    var saved: () async -> Void = {}
    @ViewBuilder let content: () -> Content

    @Environment(\.dismiss) private var dismiss
    @State private var failure: String?
    @State private var isSaving = false
    @State private var confirmingDiscard = false
    /// Человек печатал в полях этого листа.
    @State private var typed = false

    private var hasChanges: Bool { isDirty || typed }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                Form {
                    if let failure {
                        FormAlert(message: failure)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                            .id(FormSheetAnchor.failure)
                    }
                    content()
                }
                // Длинная форма прокручена вниз — ошибка над полями была бы не видна, и
                // «Сохранить» выглядело бы как кнопка, которая ничего не делает.
                .onChange(of: failure) { _, next in
                    guard next != nil else { return }
                    withAnimation { proxy.scrollTo(FormSheetAnchor.failure, anchor: .top) }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .interactiveDismissDisabled(isSaving || hasChanges)
            .onReceive(NotificationCenter.default.publisher(for: UITextField.textDidChangeNotification)) { _ in typed = true }
            .onReceive(NotificationCenter.default.publisher(for: UITextView.textDidChangeNotification)) { _ in typed = true }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton {
                        if hasChanges { confirmingDiscard = true } else { dismiss() }
                    }
                    .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(saveTitle) { Task { await run() } }
                            .disabled(!canSave)
                            .accessibilityIdentifier("form.save")
                    }
                }
            }
            .discardChangesDialog(isPresented: $confirmingDiscard) { dismiss() }
        }
    }

    @MainActor
    private func run() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await save()
            await saved()
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}

private enum FormSheetAnchor: Hashable {
    case failure
}

extension View {
    /// «Отменить изменения?» — общий вопрос всех форм перед тем, как выбросить правки.
    func discardChangesDialog(isPresented: Binding<Bool>, discard: @escaping () -> Void) -> some View {
        confirmationDialog(
            String(localized: "form.discard.title", defaultValue: "Отменить изменения?"),
            isPresented: isPresented,
            titleVisibility: .visible
        ) {
            Button(String(localized: "form.discard", defaultValue: "Не сохранять"), role: .destructive, action: discard)
            Button(String(localized: "form.keepEditing", defaultValue: "Продолжить редактирование"), role: .cancel) {}
        }
    }
}

// MARK: - Сводки

/// Плитка цифры на обзоре: значение крупно, подпись мелко, иконка — для поиска глазом.
struct StatTile: View {
    let title: String
    let value: String
    var symbol: String?
    var tint: Color = Palette.primary
    var caption: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(tint)
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
            }
            Text(value)
                .font(.title2.weight(.semibold).monospacedDigit())
                .foregroundStyle(Palette.foreground)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let caption, !caption.isEmpty {
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface(padding: Spacing.xl)
        .accessibilityElement(children: .combine)
    }
}

/// Сетка плиток в две колонки — помещается на самом узком iPhone с крупным шрифтом.
struct StatGrid<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: Spacing.md), GridItem(.flexible(), spacing: Spacing.md)],
            spacing: Spacing.md,
            content: content
        )
    }
}

/// Полоса «доля»: посещаемость, заполненность, прогресс сбора документов.
struct ShareBar: View {
    let title: String
    /// 0…1.
    let fraction: Double
    var valueText: String?
    var tint: Color = Palette.primary

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack {
                Text(title).font(Typography.body).foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                Text(valueText ?? fraction.formatted(.percent.precision(.fractionLength(0))))
                    .font(Typography.meta.monospacedDigit())
                    .foregroundStyle(Palette.mutedForeground)
            }
            ProgressView(value: min(max(fraction, 0), 1))
                .tint(tint)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Строки

/// Человек в списке: аватар, ФИО, подпись. Длинное не обрезается до бессмыслицы:
/// ФИО — в две строки, подпись — в две.
struct PersonRow: View {
    let name: String
    var subtitle: String?
    var avatarURL: String?
    var trailing: String?
    var size: CGFloat = 40

    var body: some View {
        HStack(spacing: Spacing.lg) {
            AvatarView(url: avatarURL, name: name, size: size)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: Spacing.md)
            if let trailing, !trailing.isEmpty {
                Text(trailing)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Строка карточки списка: заголовок, плашка статуса справа, строки сведений ниже.
struct ListCardRow: View {
    let title: String
    var subtitle: String?
    var status: (text: String, tint: Color)?
    var lines: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                Text(title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(3)
                Spacer(minLength: Spacing.md)
                if let status {
                    StatusBadge(text: status.text, tint: status.tint)
                }
            }
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(3)
            }
            ForEach(Array(lines.filter { !$0.isEmpty }.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Фильтры

/// Полоса фильтров-капсул над списком. Значение `nil` — «Все».
struct FilterChips<Value: Hashable>: View {
    let options: [(value: Value?, title: String)]
    @Binding var selection: Value?

    @Namespace private var pill
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    // Как папки в Telegram: одна стеклянная капсула-дорожка, внутри — пункты, выбранный
    // подсвечен «таблеткой», которая переезжает к новому пункту. Не влезший в ширину
    // выбранный пункт дорожка докручивает к себе — и при выборе, и при появлении.
    var body: some View {
        ScrollViewReader { scroller in
            chips
                .onAppear { reveal(selection, with: scroller, animated: false) }
                .onChange(of: selection) { _, value in reveal(value, with: scroller, animated: true) }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }

    private func reveal(_ value: Value?, with scroller: ScrollViewProxy, animated: Bool) {
        guard let index = options.firstIndex(where: { $0.value == value }) else { return }
        if animated, !reduceMotion {
            withAnimation(.snappy(duration: 0.3)) { scroller.scrollTo(index, anchor: .center) }
        } else {
            scroller.scrollTo(index, anchor: .center)
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(Array(options.enumerated()), id: \.offset) { index, option in
                    let isOn = option.value == selection
                    Button {
                        withAnimation(Motion.respecting(.snappy(duration: 0.3), reduceMotion: reduceMotion)) {
                            selection = option.value
                        }
                    } label: {
                        Text(option.title)
                            .font(.subheadline.weight(isOn ? .semibold : .medium))
                            .lineLimit(1)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .foregroundStyle(isOn ? Palette.foreground : Palette.mutedForeground)
                            .background {
                                if isOn {
                                    Capsule()
                                        .fill(Palette.foreground.opacity(0.12))
                                        .matchedGeometryEffect(id: "pill", in: pill)
                                }
                            }
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isOn ? .isSelected : [])
                    .id(index)
                }
            }
            .padding(4)
        }
        .scrollClipDisabled(false)
        .clipShape(Capsule())
        .glassSurface(interactive: false, in: Capsule())
    }
}

/// Строка фильтров для `List`: без фона и отступов, чтобы капсулы шли от края.
struct FilterChipsRow<Value: Hashable>: View {
    let options: [(value: Value?, title: String)]
    @Binding var selection: Value?

    var body: some View {
        FilterChips(options: options, selection: $selection)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: Spacing.xs, leading: 0, bottom: Spacing.xs, trailing: 0))
    }
}

// MARK: - Подтверждение

extension View {
    /// Подтверждение опасного действия над элементом: удалить, заблокировать, отклонить.
    func confirmDestructive<Item>(
        _ item: Binding<Item?>,
        title: @escaping (Item) -> String,
        actionTitle: String,
        perform: @escaping (Item) async -> Void
    ) -> some View {
        confirmationDialog(
            item.wrappedValue.map(title) ?? "",
            isPresented: Binding(get: { item.wrappedValue != nil }, set: { if !$0 { item.wrappedValue = nil } }),
            titleVisibility: .visible,
            presenting: item.wrappedValue
        ) { value in
            Button(actionTitle, role: .destructive) {
                Task { await perform(value) }
            }
        }
    }

    /// Ввод короткого текста перед действием: причина отклонения, комментарий.
    func reasonPrompt(
        _ isPresented: Binding<Bool>,
        title: String,
        message: String? = nil,
        placeholder: String = String(localized: "common.reason", defaultValue: "Причина"),
        actionTitle: String,
        text: Binding<String>,
        perform: @escaping () async -> Void
    ) -> some View {
        alert(title, isPresented: isPresented) {
            TextField(placeholder, text: text)
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            Button(actionTitle) { Task { await perform() } }
        } message: {
            if let message { Text(message) }
        }
    }
}

// MARK: - Файлы

/// Открыть файл по ссылке: скачать во временную папку и показать системным просмотром
/// (PDF, картинки, документы Office). Ссылка на хранилище живёт минуты, поэтому её
/// получают прямо перед открытием — `resolve` и делает этот запрос.
@MainActor
@Observable
final class RemoteFileOpener {
    var previewURL: URL?
    var isLoading = false
    var failure: String?

    func open(name: String, resolve: @escaping () async throws -> URL) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let remote = try await resolve()
            let (temp, response) = try await URLSession.shared.download(from: remote)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw APIError.malformedResponse(statusCode: http.statusCode)
            }
            let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let safeName = name.replacingOccurrences(of: "/", with: "-")
            let target = folder.appending(path: safeName.isEmpty ? remote.lastPathComponent : safeName)
            try FileManager.default.moveItem(at: temp, to: target)
            previewURL = target
        } catch {
            failure = error.userMessage
        }
    }
}

extension View {
    /// Показ скачанного файла и ошибки скачивания. Экран держит `RemoteFileOpener` в
    /// `@State` и зовёт `open` по нажатию.
    func remoteFilePreview(_ opener: RemoteFileOpener) -> some View {
        modifier(RemoteFilePreviewModifier(opener: opener))
    }
}

private struct RemoteFilePreviewModifier: ViewModifier {
    @Bindable var opener: RemoteFileOpener

    func body(content: Content) -> some View {
        content
            .quickLookPreview($opener.previewURL)
            .actionFailureAlert($opener.failure)
            .overlay {
                if opener.isLoading {
                    ProgressView()
                        .padding(Spacing.xl)
                        .glassSurface(interactive: false, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                }
            }
    }
}

// MARK: - Сведения из JSON

/// Секция «подпись — значение» по объекту JSON: для сводок, полей журнала, деталей
/// записи, форма которых шире, чем стоит описывать типом. Порядок — как задан в `keys`;
/// без него — по алфавиту.
struct JSONDetailsSection: View {
    let title: String?
    let value: JSONValue
    var keys: [(key: String, title: String)]?

    var body: some View {
        Section {
            ForEach(rows, id: \.0) { row in
                DetailRow(title: row.0, value: row.1)
            }
        } header: {
            if let title { Text(title) }
        }

    }

    private var rows: [(String, String)] {
        guard let object = value.object else { return [] }
        if let keys {
            return keys.compactMap { entry in
                guard let field = object[entry.key], !field.isNull else { return nil }
                return (entry.title, field.display)
            }
        }
        return object.keys.sorted().compactMap { key in
            guard let field = object[key], !field.isNull, field.object == nil else { return nil }
            return (key, field.display)
        }
    }
}

// MARK: - Форматы

enum DisplayFormat {
    /// «12 окт., 14:30».
    static func dateTime(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }

    /// «12 окт. 2026».
    static func date(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(.dateTime.day().month(.abbreviated).year())
    }

    /// «5 мин назад».
    static func relative(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(.relative(presentation: .named))
    }

    static func name(first: String?, last: String?, middle: String? = nil) -> String {
        let parts = [last, first, middle].compactMap { $0?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return parts.isEmpty ? "—" : parts.joined(separator: " ")
    }

    static func percent(_ value: Double?) -> String {
        guard let value else { return "—" }
        return "\(Int(value.rounded()))%"
    }

    static func fileSize(_ bytes: Int?) -> String {
        guard let bytes else { return "" }
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

/// Поиск с задержкой: запрос уходит, когда человек перестал печатать, а не на каждую
/// букву. Первый показ экрана поиск не запускает — первую страницу грузит сам список.
extension View {
    func debouncedSearch(
        _ text: Binding<String>,
        prompt: String,
        delay: Duration = .milliseconds(350),
        onChange: @escaping (String) async -> Void
    ) -> some View {
        modifier(DebouncedSearchModifier(text: text, prompt: prompt, delay: delay, onChange: onChange))
    }
}

private struct DebouncedSearchModifier: ViewModifier {
    @Binding var text: String
    let prompt: String
    let delay: Duration
    let onChange: (String) async -> Void

    @State private var lastSent = ""

    func body(content: Content) -> some View {
        content
            .searchable(text: $text, prompt: Text(prompt))
            .task(id: text) {
                let needle = text.trimmingCharacters(in: .whitespaces)
                guard needle != lastSent else { return }
                if !needle.isEmpty {
                    try? await Task.sleep(for: delay)
                    guard !Task.isCancelled else { return }
                }
                lastSent = needle
                await onChange(needle)
            }
    }
}

// MARK: - Подстановки в локализованные строки

/// Значения для `\(…)` внутри `String(localized:defaultValue:)` без кавычек: разбор строк
/// (`LocalizationTests`, синхронизация каталога) обрывает значение на первой кавычке, и
/// `\(name ?? "")` превращался в каталоге в обрывок кода, который видел человек.
extension Optional where Wrapped == String {
    /// Пустая строка вместо `nil`.
    var orEmpty: String { self ?? "" }
    /// Тире вместо `nil` или пустого.
    var orDash: String {
        guard let self, !self.isEmpty else { return "—" }
        return self
    }
}

extension DisplayFormat {
    /// «4:05» — минуты и секунды обратного отсчёта.
    static func minutesSeconds(_ seconds: Int) -> String {
        let clamped = max(0, seconds)
        let rest = clamped % 60
        return "\(clamped / 60):" + (rest < 10 ? "0\(rest)" : "\(rest)")
    }
}
