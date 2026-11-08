import SwiftUI

/// Настройки — по образцу Telegram: шапка с собой, затем разделы, внизу выход и
/// опасная зона. Разделы те же, что во вкладках настроек веба (личное, безопасность,
/// уведомления, внешний вид, приватность, поддержка, опасная зона).
struct SettingsView: View {
    let session: AppSessionModel

    @Environment(ViewerProfileModel.self) private var viewer
    @Environment(\.viewerRole) private var role
    @State private var showsQRApprove = false
    @State private var confirmsSignOut = false

    var body: some View {
        List {
            Section {
                NavigationLink {
                    ProfileEditView()
                } label: {
                    HStack(spacing: Spacing.lg) {
                        AvatarView(url: viewer.profile?.avatarUrl, name: viewer.profile?.name, size: 56)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(viewer.profile?.name ?? "")
                                .font(Typography.sectionTitle)
                                .foregroundStyle(Palette.foreground)
                            if let username = viewer.profile?.username, !username.isEmpty {
                                Text(verbatim: "@\(username)")
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            } else if let email = viewer.profile?.email {
                                Text(verbatim: email)
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                }
                .accessibilityIdentifier("settings.profile")
            }

            Section {
                NavigationLink {
                    ProfileEditView()
                } label: {
                    IconRow(
                        title: String(localized: "settings.personal", defaultValue: "Личные данные"),
                        symbol: "person.text.rectangle",
                        tint: TileTint.blue
                    )
                }
                NavigationLink {
                    SecuritySettingsView(session: session)
                } label: {
                    IconRow(
                        title: String(localized: "settings.security", defaultValue: "Безопасность"),
                        symbol: "lock.shield",
                        tint: TileTint.green,
                        value: viewer.profile?.twoFactorEnabled == true
                            ? String(localized: "settings.2fa.on", defaultValue: "2FA вкл.")
                            : nil
                    )
                }
                .accessibilityIdentifier("settings.security")
                NavigationLink {
                    PrivacySettingsView()
                } label: {
                    IconRow(
                        title: String(localized: "settings.privacy", defaultValue: "Конфиденциальность"),
                        symbol: "hand.raised",
                        tint: TileTint.indigo
                    )
                }
                NavigationLink {
                    NotificationSettingsView()
                } label: {
                    IconRow(
                        title: String(localized: "settings.notifications", defaultValue: "Уведомления"),
                        symbol: "bell.badge",
                        tint: TileTint.red
                    )
                }
                .accessibilityIdentifier("settings.notifications")
            }

            Section {
                NavigationLink(value: AppRoute.community(.username)) {
                    IconRow(
                        title: CommunityScreen.username.title,
                        symbol: "at",
                        tint: TileTint.teal,
                        value: viewer.profile?.username.map { "@\($0)" }
                    )
                }
                NavigationLink(value: AppRoute.community(.notificationLanguage)) {
                    IconRow(
                        title: CommunityScreen.notificationLanguage.title,
                        symbol: "globe",
                        tint: TileTint.blue,
                        value: CommunityLanguageText.title(viewer.profile?.locale)
                    )
                }
                // Mini-app в Telegram — инструмент команды платформы, другим ролям сервер откажет.
                if role == .platformAdmin || role == .platformModerator {
                    NavigationLink(value: AppRoute.community(.telegramLink)) {
                        IconRow(title: CommunityScreen.telegramLink.title, symbol: "paperplane", tint: TileTint.teal)
                    }
                }
            } header: {
                Text(String(localized: "community.settings.account", defaultValue: "Аккаунт"))
            }

            Section {
                NavigationLink {
                    AppearanceSettingsView()
                } label: {
                    IconRow(
                        title: String(localized: "settings.appearance", defaultValue: "Внешний вид"),
                        symbol: "paintbrush",
                        tint: TileTint.purple
                    )
                }
                .accessibilityIdentifier("settings.appearance")
                Button {
                    showsQRApprove = true
                } label: {
                    IconRow(
                        title: String(localized: "auth.qrApproveTitle", defaultValue: "Вход на другом устройстве"),
                        symbol: "qrcode.viewfinder",
                        tint: TileTint.teal
                    )
                }
                .buttonStyle(.plain)
            } header: {
                Text(String(localized: "settings.app", defaultValue: "Приложение"))
            }

            Section {
                NavigationLink {
                    SupportView()
                } label: {
                    IconRow(
                        title: String(localized: "settings.support", defaultValue: "Поддержка"),
                        symbol: "questionmark.bubble",
                        tint: TileTint.orange
                    )
                }
                LabeledContent {
                    Text(verbatim: "\(AppConfiguration.marketingVersion) (\(AppConfiguration.buildNumber))")
                        .font(Typography.tabular(Typography.body))
                } label: {
                    IconRow(
                        title: String(localized: "settings.version", defaultValue: "Версия"),
                        symbol: "info.circle",
                        tint: TileTint.gray
                    )
                }
            }

            Section {
                Button(role: .destructive) {
                    confirmsSignOut = true
                } label: {
                    Label(
                        String(localized: "session.signOut", defaultValue: "Выйти"),
                        systemImage: "rectangle.portrait.and.arrow.right"
                    )
                    .font(Typography.body)
                }
                .accessibilityIdentifier("settings.signOut")
            }

            // Опасная зона — отдельно и в самом низу: удаление аккаунта не должно
            // оказаться под пальцем рядом с переключателем темы.
            Section {
                NavigationLink {
                    DeleteAccountView(session: session)
                } label: {
                    Label(
                        String(localized: "settings.deleteAccount", defaultValue: "Удалить аккаунт"),
                        systemImage: "trash"
                    )
                    .foregroundStyle(Palette.destructive)
                }
            } header: {
                Text(String(localized: "settings.danger", defaultValue: "Опасная зона"))
            } footer: {
                Text(String(
                    localized: "settings.danger.footer",
                    defaultValue: "Удаление необратимо: профиль, публикации и переписки исчезнут."
                ))
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(String(localized: "more.settings", defaultValue: "Настройки")))
        .sheet(isPresented: $showsQRApprove) {
            QRApproveView()
        }
        .confirmationDialog(
            String(localized: "settings.signOut.confirm", defaultValue: "Выйти из аккаунта на этом iPhone?"),
            isPresented: $confirmsSignOut,
            titleVisibility: .visible
        ) {
            Button(String(localized: "session.signOut", defaultValue: "Выйти"), role: .destructive) {
                Task { await session.signOut() }
            }
        }
        .task { await viewer.refresh() }
    }
}

// MARK: - Уведомления

@Observable
final class NotificationPreferencesModel {
    private(set) var value: NotificationPreferencesDTO?
    private(set) var failure: String?
    private let api: AccountFetching

    init(api: AccountFetching = AccountAPI()) {
        self.api = api
    }

    @MainActor
    func load() async {
        do {
            value = try await api.notificationPreferences()
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    /// Переключатель меняется сразу; отказ сервера возвращает прежнее значение.
    @MainActor
    func set(_ keyPath: WritableKeyPath<NotificationPreferencesDTO, Bool?>, to on: Bool) async {
        guard let current = value else { return }
        var next = current
        next[keyPath: keyPath] = on
        value = next
        var change = NotificationPreferencesDTO()
        change[keyPath: keyPath] = on
        do {
            value = try await api.updateNotificationPreferences(change)
            failure = nil
        } catch {
            value = current
            failure = error.userMessage
        }
    }
}

struct NotificationSettingsView: View {
    @State private var model = NotificationPreferencesModel()

    var body: some View {
        Form {
            if let failure = model.failure, model.value != nil {
                FormAlert(message: failure).listRowBackground(Color.clear)
            }
            if let value = model.value {
                Section {
                    toggle(\.pushEnabled, value, String(localized: "notifications.push", defaultValue: "Пуши"), default: false)
                    toggle(\.emailEnabled, value, String(localized: "notifications.email", defaultValue: "Письма"))
                } header: {
                    Text(String(localized: "notifications.channels", defaultValue: "Каналы"))
                } footer: {
                    Text(String(
                        localized: "settings.notifications.channels.footer",
                        defaultValue: "В колокольчике уведомления появляются всегда — здесь выбирается, куда ещё их присылать."
                    ))
                }

                Section {
                    toggle(\.messageEnabled, value, String(localized: "settings.notifications.messages", defaultValue: "Сообщения"))
                    toggle(\.scheduleChangeEnabled, value, String(localized: "settings.notifications.schedule", defaultValue: "Изменения расписания"))
                    toggle(\.postEnabled, value, String(localized: "settings.notifications.posts", defaultValue: "Публикации"))
                    toggle(\.eventEnabled, value, String(localized: "settings.notifications.events", defaultValue: "События"))
                    toggle(\.systemEnabled, value, String(localized: "settings.notifications.system", defaultValue: "Системные"))
                    toggle(\.appUpdateEnabled, value, String(localized: "settings.notifications.updates", defaultValue: "Обновления приложения"))
                } header: {
                    Text(String(localized: "settings.notifications.topics", defaultValue: "О чём сообщать"))
                }
            } else if let failure = model.failure {
                ErrorStateView(message: failure) { await model.load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .navigationTitle(Text(String(localized: "settings.notifications", defaultValue: "Уведомления")))
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
    }

    private func toggle(
        _ keyPath: WritableKeyPath<NotificationPreferencesDTO, Bool?>,
        _ value: NotificationPreferencesDTO,
        _ title: String,
        default fallback: Bool = true
    ) -> some View {
        Toggle(title, isOn: Binding(
            get: { value[keyPath: keyPath] ?? fallback },
            set: { on in Task { await model.set(keyPath, to: on) } }
        ))
    }
}

// MARK: - Конфиденциальность

/// Кто видит профиль и контакты. Поля — те же, что во вкладке «Приватность» веба:
/// `profileVisibility`, `showEmail`, `showPhone`.
struct PrivacySettingsView: View {
    @Environment(ViewerProfileModel.self) private var viewer
    @State private var failure: String?
    @State private var isExporting = false
    @State private var exported: ExportedFile?

    private let api: AccountFetching = AccountAPI()

    static let visibilities = ["PUBLIC", "UNIVERSITY", "FACULTY", "GROUP", "PRIVATE"]

    var body: some View {
        Form {
            if let failure {
                FormAlert(message: failure).listRowBackground(Color.clear)
            }
            Section {
                Picker(
                    String(localized: "settings.privacy.visibility", defaultValue: "Кто видит профиль"),
                    selection: Binding(
                        get: { viewer.profile?.profileVisibility ?? "UNIVERSITY" },
                        set: { value in save(ProfileUpdate(profileVisibility: value)) }
                    )
                ) {
                    ForEach(Self.visibilities, id: \.self) { value in
                        Text(Self.visibilityTitle(value)).tag(value)
                    }
                }
                Toggle(
                    String(localized: "settings.privacy.showEmail", defaultValue: "Показывать почту"),
                    isOn: Binding(
                        get: { viewer.profile?.showEmail ?? false },
                        set: { save(ProfileUpdate(showEmail: $0)) }
                    )
                )
                Toggle(
                    String(localized: "settings.privacy.showPhone", defaultValue: "Показывать телефон"),
                    isOn: Binding(
                        get: { viewer.profile?.showPhone ?? false },
                        set: { save(ProfileUpdate(showPhone: $0)) }
                    )
                )
            } footer: {
                Text(String(
                    localized: "settings.privacy.footer",
                    defaultValue: "Закрытый профиль остальные видят визиткой: имя, фото и роль."
                ))
            }

            Section {
                Button {
                    Task { await export() }
                } label: {
                    HStack {
                        Label(
                            String(localized: "settings.export", defaultValue: "Выгрузить мои данные"),
                            systemImage: "square.and.arrow.down"
                        )
                        Spacer()
                        if isExporting { ProgressView() }
                    }
                }
                .disabled(isExporting)
            } footer: {
                Text(String(
                    localized: "settings.export.footer",
                    defaultValue: "Файл JSON со всем, что платформа хранит о вас. Не чаще трёх раз в час."
                ))
            }
        }
        .navigationTitle(Text(String(localized: "settings.privacy", defaultValue: "Конфиденциальность")))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $exported) { file in
            ShareSheet(items: [file.url])
        }
    }

    static func visibilityTitle(_ value: String) -> String {
        switch value {
        case "PUBLIC": return String(localized: "settings.visibility.public", defaultValue: "Все")
        case "UNIVERSITY": return String(localized: "settings.visibility.university", defaultValue: "Мой вуз")
        case "FACULTY": return String(localized: "settings.visibility.faculty", defaultValue: "Мой факультет")
        case "GROUP": return String(localized: "settings.visibility.group", defaultValue: "Моя группа")
        default: return String(localized: "settings.visibility.private", defaultValue: "Только друзья")
        }
    }

    private func save(_ update: ProfileUpdate) {
        Task { @MainActor in
            do {
                viewer.adopt(try await api.updateProfile(update))
                failure = nil
            } catch {
                failure = error.userMessage
            }
        }
    }

    @MainActor
    private func export() async {
        isExporting = true
        defer { isExporting = false }
        do {
            let locale = Locale.current.language.languageCode?.identifier ?? "ru"
            let data = try await api.exportData(locale: locale)
            let url = FileManager.default.temporaryDirectory.appending(path: "studenthub-data.json")
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            exported = ExportedFile(url: url)
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }
}

struct ExportedFile: Identifiable {
    let url: URL
    var id: URL { url }
}

/// Системный лист «Поделиться»: сохранить в «Файлы», отправить, открыть в другом
/// приложении — всё, что умеет iOS, без своего интерфейса.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
