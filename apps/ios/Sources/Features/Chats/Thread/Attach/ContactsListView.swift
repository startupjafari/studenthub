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
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(shown) { row in
                            Button {
                                onPick(row.draft)
                            } label: {
                                HStack(spacing: Spacing.lg) {
                                    AvatarView(url: nil, name: row.draft.name, size: 40)
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
                        }
                    }
                    .background(Palette.secondary, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))
                    .padding(.horizontal, Spacing.lg)
                }
                .scrollDismissesKeyboard(.immediately)
            }
        }
        .padding(.top, Spacing.xs)
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
        ]
        let request = CNContactFetchRequest(keysToFetch: keys)
        request.sortOrder = .userDefault
        var rows: [ContactRow] = []
        try? CNContactStore().enumerateContacts(with: request) { contact, _ in
            if let draft = ContactCardDraft(contact) {
                rows.append(ContactRow(id: contact.identifier, draft: draft))
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
