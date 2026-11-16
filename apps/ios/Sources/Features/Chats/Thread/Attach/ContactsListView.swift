import Contacts
import SwiftUI

/// «Контакт» в листе вложений, как в Telegram: список контактов с поиском прямо в
/// компактном листе, без отдельного полноэкранного окна. Касание — карточка уходит на
/// подтверждение. Без доступа к контактам — просьба разрешить, а при отказе — системный
/// выбор (ему доступ не нужен) и путь в настройки.
struct ContactsListView: View {
    let onPick: (ContactCardDraft) -> Void
    let onSystemPicker: () -> Void

    @State private var access = ContactsAccess.current
    @State private var contacts: [ContactRow] = []
    @State private var isLoading = false
    @State private var query = ""

    struct ContactRow: Identifiable, Sendable {
        let id: String
        let draft: ContactCardDraft
        /// Миниатюра фото из «Контактов» (маленькая, для строки списка).
        var thumbnail: Data? = nil

        /// Буква раздела: первая буква имени, всё прочее — «#».
        var letter: String { ContactsIndex.letter(for: draft.name) }
    }

    var body: some View {
        Group {
            switch access {
            case .allowed:
                list
            case .undetermined:
                prompt(
                    text: String(
                        localized: "chats.contacts.prompt",
                        defaultValue: "Разрешите доступ к контактам, чтобы выбрать, чей контакт отправить"
                    ),
                    action: String(localized: "chats.attach.photosAllow", defaultValue: "Разрешить доступ")
                ) {
                    Task {
                        _ = try? await CNContactStore().requestAccess(for: .contacts)
                        access = ContactsAccess.current
                        await reload()
                    }
                }
            case .denied:
                prompt(
                    text: String(
                        localized: "chats.contacts.denied",
                        defaultValue: "Нет доступа к контактам. Можно выбрать контакт в системном окне или разрешить доступ в настройках."
                    ),
                    action: String(localized: "chats.voice.openSettings", defaultValue: "Открыть настройки")
                ) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
            }
        }
        .task { await reload() }
    }

    private var list: some View {
        VStack(spacing: Spacing.sm) {
            ExpressionSearchField(
                query: $query,
                prompt: String(localized: "chats.panel.search", defaultValue: "Поиск")
            )
            .padding(.horizontal, Spacing.lg)

            if isLoading, contacts.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if shown.isEmpty {
                Text(String(localized: "services.notFound", defaultValue: "Ничего не нашлось"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                            ForEach(ContactsIndex.sections(shown, letter: \.letter), id: \.letter) { section in
                                Section {
                                    ForEach(section.rows) { row in
                                        contactRow(row)
                                    }
                                } header: {
                                    Text(section.letter)
                                        .font(Typography.meta.weight(.semibold))
                                        .foregroundStyle(Palette.mutedForeground)
                                        .padding(.horizontal, Spacing.xl)
                                        .padding(.vertical, Spacing.xs)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(Palette.background.opacity(0.95))
                                }
                                .id(section.letter)
                            }
                        }
                        .padding(.trailing, Spacing.xl)
                    }
                    .scrollDismissesKeyboard(.immediately)
                    .overlay(alignment: .trailing) {
                        AlphabetIndex(letters: ContactsIndex.sections(shown, letter: \.letter).map(\.letter)) { letter in
                            proxy.scrollTo(letter, anchor: .top)
                        }
                        .padding(.trailing, 2)
                    }
                }
            }
        }
        .padding(.top, Spacing.xs)
    }

    private func contactRow(_ row: ContactRow) -> some View {
        Button {
            onPick(row.draft)
        } label: {
            HStack(spacing: Spacing.lg) {
                if let data = row.thumbnail, let image = UIImage(data: data) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 40, height: 40)
                        .clipShape(Circle())
                } else {
                    AvatarView(url: nil, name: row.draft.name, size: 40)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.draft.name)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(1)
                    if let detail = row.draft.phones.first ?? row.draft.emails.first {
                        Text(detail)
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("chat.attach.contact.\(row.id)")
    }

    private var shown: [ContactRow] {
        let term = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !term.isEmpty else { return contacts }
        let digits = term.filter(\.isNumber)
        return contacts.filter { row in
            row.draft.name.lowercased().contains(term)
                || row.draft.emails.contains { $0.lowercased().contains(term) }
                || (!digits.isEmpty && row.draft.phones.contains { $0.filter(\.isNumber).contains(digits) })
        }
    }

    private func prompt(text: String, action: String, perform: @escaping () -> Void) -> some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: "person.crop.circle")
                .font(.largeTitle)
                .foregroundStyle(Palette.mutedForeground)
            Text(text)
                .font(Typography.body)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
            Button(action, action: perform)
                .glassProminentButton()
            if access == .denied {
                Button(String(localized: "chats.contacts.systemPicker", defaultValue: "Выбрать в «Контактах»"), action: onSystemPicker)
                    .glassButton()
            }
        }
        .padding(Spacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func reload() async {
        guard access == .allowed else { return }
        isLoading = true
        contacts = await Task.detached(priority: .userInitiated) { Self.load() }.value
        isLoading = false
    }

    /// Все контакты с телефоном или почтой, в порядке, заданном в «Контактах».
    nonisolated private static func load() -> [ContactRow] {
        let keys: [CNKeyDescriptor] = [
            CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactThumbnailImageDataKey as CNKeyDescriptor,
        ]
        let request = CNContactFetchRequest(keysToFetch: keys)
        request.sortOrder = .userDefault
        var rows: [ContactRow] = []
        try? CNContactStore().enumerateContacts(with: request) { contact, _ in
            if let draft = ContactCardDraft(contact) {
                rows.append(ContactRow(id: contact.identifier, draft: draft, thumbnail: contact.thumbnailImageData))
            }
        }
        return rows
    }
}

/// Доступ к контактам: частичный (iOS 18) — тоже доступ, к выбранным контактам.
private enum ContactsAccess {
    case allowed, undetermined, denied

    static var current: ContactsAccess {
        // Без `switch`: частичного доступа (`.limited`) нет в iOS 17, на которой
        // приложение ещё работает, а остальные варианты им покрываются.
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .notDetermined { return .undetermined }
        if status == .denied || status == .restricted { return .denied }
        return .allowed
    }
}

/// Разделы списка контактов по первой букве — для индекса справа.
enum ContactsIndex {
    static func letter(for name: String) -> String {
        guard let first = name.trimmingCharacters(in: .whitespaces).first, first.isLetter else { return "#" }
        return String(first).uppercased()
    }

    /// Строки по разделам: буквы в порядке первого появления (порядок задают «Контакты»),
    /// «#» — в конце, как в системном списке.
    static func sections<Row>(_ rows: [Row], letter: (Row) -> String) -> [(letter: String, rows: [Row])] {
        var order: [String] = []
        var groups: [String: [Row]] = [:]
        for row in rows {
            let key = letter(row)
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(row)
        }
        let letters = order.filter { $0 != "#" } + (order.contains("#") ? ["#"] : [])
        return letters.map { ($0, groups[$0] ?? []) }
    }
}

/// Алфавитный указатель у правого края: касание или ведение пальцем — к разделу.
struct AlphabetIndex: View {
    let letters: [String]
    let onSelect: (String) -> Void

    @State private var current: String?

    var body: some View {
        if letters.count > 1 {
            GeometryReader { proxy in
                VStack(spacing: 0) {
                    ForEach(letters, id: \.self) { letter in
                        Text(letter)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(current == letter ? Palette.primaryForeground : Palette.primary)
                            .frame(width: 16, height: proxy.size.height / CGFloat(letters.count))
                            .background(Circle().fill(current == letter ? Palette.primary : .clear))
                    }
                }
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        let step = proxy.size.height / CGFloat(max(letters.count, 1))
                        let index = min(max(Int(drag.location.y / step), 0), letters.count - 1)
                        let letter = letters[index]
                        if letter != current {
                            current = letter
                            Haptics.tap()
                            onSelect(letter)
                        }
                    }
                    .onEnded { _ in current = nil })
            }
            .frame(width: 18, height: min(CGFloat(letters.count) * 16, 420))
            .accessibilityElement()
            .accessibilityLabel(Text(String(localized: "chats.contacts.index", defaultValue: "Алфавитный указатель")))
            .accessibilityIdentifier("chat.attach.contacts.index")
            .accessibilityAdjustableAction { _ in }
        }
    }
}
