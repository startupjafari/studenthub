import SwiftUI

/// Настройки — по образцу Telegram: шапка с собой, затем разделы, внизу выход и
/// опасная зона. Разделы те же, что во вкладках настроек веба (личное, безопасность,
/// уведомления, внешний вид, приватность, поддержка, опасная зона).
///
/// Все строки — `SettingsRow`: одна плитка, высота и выравнивание значения. Экран
/// открывается в стеке вкладки, панель вкладок под ним остаётся (`AppShellView`).
struct SettingsView: View {
    let session: AppSessionModel

    @Environment(ViewerProfileModel.self) private var viewer
    @Environment(\.viewerRole) private var role
    @Environment(\.viewerID) private var viewerID
    @State private var showsQRApprove = false
    @State private var confirmsSignOut = false
    /// Профиль освежается один раз за жизнь экрана, а не при каждом возврате из раздела.
    @State private var refreshed = false
    @ScaledMetric(relativeTo: .title) private var avatarSize: CGFloat = 72

    var body: some View {
        List {
            header
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: Spacing.xl, bottom: Spacing.xs, trailing: Spacing.xl))
                .listRowSeparator(.hidden)

            Section {
                // Кнопка, а не ссылка со значением маршрута: ссылка оставалась подсвеченной,
                // когда профиль уже лежал в стеке под настройками, — и открывала его второй
                // копией. Теперь из профиля — назад к нему, откуда-то ещё — переход.
                Button(action: openOwnProfile) {
                    SettingsRow(
                        title: String(localized: "settings.myProfile", defaultValue: "Мой профиль"),
                        symbol: "person.crop.circle.fill",
                        tint: TileTint.red,
                        showsChevron: true
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings.profile")
                NavigationLink {
                    SavedPostsView()
                } label: {
                    SettingsRow(
                        title: String(localized: "saved.title", defaultValue: "Сохранённое"),
                        symbol: "bookmark.fill",
                        tint: TileTint.blue
                    )
                }
            }

            Section {
                NavigationLink {
                    ProfileEditView()
                } label: {
                    SettingsRow(
                        title: String(localized: "settings.personal", defaultValue: "Личные данные"),
                        symbol: "person.text.rectangle.fill",
                        tint: TileTint.blue
                    )
                }
                NavigationLink {
                    SecuritySettingsView(session: session)
                } label: {
                    SettingsRow(
                        title: String(localized: "settings.security", defaultValue: "Безопасность"),
                        symbol: "lock.fill",
                        tint: TileTint.green,
                        value: twoFactorStatus
                    )
                }
                .accessibilityIdentifier("settings.security")
                NavigationLink {
                    PrivacySettingsView()
                } label: {
                    SettingsRow(
                        title: String(localized: "settings.privacy", defaultValue: "Конфиденциальность"),
                        symbol: "hand.raised.fill",
                        tint: TileTint.indigo
                    )
                }
                NavigationLink {
                    NotificationSettingsView()
                } label: {
                    SettingsRow(
                        title: String(localized: "settings.notifications", defaultValue: "Уведомления"),
                        symbol: "bell.badge.fill",
                        tint: TileTint.red
                    )
                }
                .accessibilityIdentifier("settings.notifications")
            }

            Section {
                NavigationLink(value: AppRoute.community(.username)) {
                    SettingsRow(
                        title: CommunityScreen.username.title,
                        symbol: "at",
                        tint: TileTint.orange,
                        value: viewer.profile?.username.map { "@\($0)" }
                    )
                }
                NavigationLink(value: AppRoute.community(.notificationLanguage)) {
                    SettingsRow(
                        title: CommunityScreen.notificationLanguage.title,
                        symbol: "globe",
                        tint: TileTint.blue,
                        value: CommunityLanguageText.title(viewer.profile?.locale)
                    )
                }
                // Mini-app в Telegram — инструмент команды платформы, другим ролям сервер откажет.
                if role == .platformAdmin || role == .platformModerator {
                    NavigationLink(value: AppRoute.community(.telegramLink)) {
                        SettingsRow(title: CommunityScreen.telegramLink.title, symbol: "paperplane.fill", tint: TileTint.teal)
                    }
                }
            } header: {
                Text(String(localized: "community.settings.account", defaultValue: "Аккаунт"))
            }

            Section {
                NavigationLink {
                    AppearanceSettingsView()
                } label: {
                    SettingsRow(
                        title: String(localized: "settings.appearance", defaultValue: "Внешний вид"),
                        symbol: "paintbrush.fill",
                        tint: TileTint.purple
                    )
                }
                .accessibilityIdentifier("settings.appearance")
                // Открывает лист, а не экран: шеврона нет.
                Button {
                    showsQRApprove = true
                } label: {
                    SettingsRow(
                        title: String(localized: "auth.qrApproveTitle", defaultValue: "Вход на другом устройстве"),
                        symbol: "qrcode.viewfinder",
                        tint: TileTint.blue
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
                    SettingsRow(
                        title: String(localized: "settings.support", defaultValue: "Поддержка"),
                        symbol: "questionmark.bubble.fill",
                        tint: TileTint.orange
                    )
                }
                ForEach(LegalDocument.allCases) { document in
                    NavigationLink(value: AppRoute.legal(document)) {
                        SettingsRow(title: document.title, symbol: document.symbol, tint: TileTint.gray)
                    }
                }
                // Сведение, а не переход: без шеврона и без отклика на касание.
                SettingsRow(
                    title: String(localized: "settings.version", defaultValue: "Версия"),
                    symbol: "info.circle.fill",
                    tint: TileTint.gray,
                    value: "\(AppConfiguration.marketingVersion) (\(AppConfiguration.buildNumber))"
                )
            }

            Section {
                Button {
                    confirmsSignOut = true
                } label: {
                    SettingsRow(
                        title: String(localized: "session.signOut", defaultValue: "Выйти"),
                        symbol: "rectangle.portrait.and.arrow.right",
                        tint: TileTint.red,
                        isDestructive: true
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings.signOut")
            }

            // Опасная зона — отдельно и в самом низу: удаление аккаунта не должно
            // оказаться под пальцем рядом с переключателем темы. Предупреждение — в
            // подписи, подтверждение — на экране удаления.
            Section {
                NavigationLink {
                    DeleteAccountView(session: session)
                } label: {
                    SettingsRow(
                        title: String(localized: "settings.deleteAccount", defaultValue: "Удалить аккаунт"),
                        symbol: "trash.fill",
                        tint: TileTint.red,
                        isDestructive: true
                    )
                }
            } header: {
                Text(String(localized: "settings.danger", defaultValue: "Опасная зона"))
                    .foregroundStyle(Palette.destructive)
            } footer: {
                Text(String(
                    localized: "settings.danger.footer",
                    defaultValue: "Удаление необратимо: профиль, публикации и переписки исчезнут."
                ))
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        // Шапка — сразу под панелью, без пустой полосы, которую список ставит над
        // первой секцией.
        .contentMargins(.top, Spacing.sm, for: .scrollContent)
        .hardTopEdge()
        .navigationTitle(Text(String(localized: "more.settings", defaultValue: "Настройки")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Обе кнопки — справа, одной группой: слева у вложенного экрана «Назад», и
            // круглая QR-кнопка рядом с ней читалась как вторая «Назад». Обе — значками:
            // значок и слово в одной стеклянной капсуле стояли с неровным зазором.
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    showsQRApprove = true
                } label: {
                    Image(systemName: "qrcode.viewfinder")
                }
                .accessibilityLabel(Text(String(localized: "auth.qrApproveTitle", defaultValue: "Вход на другом устройстве")))
                NavigationLink {
                    ProfileEditView()
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel(Text(String(localized: "profile.editTitle", defaultValue: "Изменить профиль")))
                .accessibilityIdentifier("settings.edit")
            }
        }
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
        .task {
            guard !refreshed else { return }
            refreshed = true
            await viewer.refresh()
        }
    }

    /// Состояние 2FA словами. Пока профиль не пришёл — без значения, а не «выключена».
    private var twoFactorStatus: String? {
        guard let enabled = viewer.profile?.twoFactorEnabled else { return nil }
        return enabled
            ? String(localized: "settings.2fa.statusOn", defaultValue: "2FA включена")
            : String(localized: "settings.2fa.statusOff", defaultValue: "2FA выключена")
    }

    /// «Мой профиль»: если профиль уже в стеке под настройками — вернуться к нему, иначе
    /// открыть. Вторая копия своего профиля в одном стеке ни к чему.
    private func openOwnProfile() {
        let router = AppServices.router
        let tab = router.selectedTab
        var stack = router.stacks[tab] ?? []
        let isOwnProfile: (AppRoute) -> Bool = { route in
            route == .section(.profile) || (!viewerID.isEmpty && route == .profile(id: viewerID))
        }
        if let index = stack.lastIndex(where: isOwnProfile) {
            stack.removeSubrange((index + 1)...)
        } else {
            stack.append(.section(.profile))
        }
        router.stacks[tab] = stack
    }

    /// Шапка как в «Настройках» Telegram: аватар по центру, имя, ниже — почта и имя
    /// пользователя. Правка — кнопкой с карандашом в панели.
    private var header: some View {
        VStack(spacing: Spacing.xs) {
            AvatarView(url: viewer.profile?.avatarUrl, name: viewer.profile?.name, size: min(avatarSize, 112))
                .padding(.bottom, Spacing.xs)
            Text(viewer.profile?.name ?? "")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if !headerSubtitle.isEmpty {
                Text(verbatim: headerSubtitle)
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        // Высота шапки не зависит от того, пришёл ли профиль: имя без данных — пустая
        // строка той же высоты, и секции под шапкой не прыгают.
        .frame(minHeight: min(avatarSize, 112) + 40, alignment: .top)
        .accessibilityElement(children: .combine)
    }

    private var headerSubtitle: String {
        var parts: [String] = []
        if let email = viewer.profile?.email, !email.isEmpty { parts.append(email) }
        if let username = viewer.profile?.username, !username.isEmpty { parts.append("@\(username)") }
        return parts.joined(separator: " • ")
    }
}

// MARK: - Уведомления

@Observable
final class NotificationPreferencesModel {
    private(set) var value: NotificationPreferencesDTO?
    private(set) var failure: String?
    private(set) var isOffline = false
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
            isOffline = error.isOffline
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
                ErrorStateView(message: failure, isOffline: model.isOffline) { await model.load() }
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
