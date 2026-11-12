import SwiftUI
import UIKit

// Аккаунт: логин, язык писем и пушей, привязка Telegram mini-app; черновики и
// отложенные посты; вступление в чат по ссылке.

// MARK: - Логин

struct CommunityUsernameView: View {
    @Environment(ViewerProfileModel.self) private var viewer
    @Environment(\.dismiss) private var dismiss
    @State private var username = ""
    @State private var failure: String?
    @State private var isSaving = false
    @State private var saved = 0

    var body: some View {
        Form {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            Section {
                HStack(spacing: Spacing.xs) {
                    Text(verbatim: "@").foregroundStyle(Palette.mutedForeground)
                    TextField(String(localized: "community.username.placeholder", defaultValue: "логин"), text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: username) { _, value in
                            let lowered = value.lowercased()
                            if lowered != value { username = lowered }
                        }
                }
            } footer: {
                if !normalized.isEmpty, !isValid {
                    FieldError(message: String(localized: "community.username.invalid", defaultValue: "От 3 до 32 символов: латинские буквы, цифры и _"))
                } else {
                    Text(String(localized: "community.username.hint", defaultValue: "По логину вас находят в поиске и упоминают через @. Латинские буквы, цифры и _."))
                }
            }
        }
        .settingsFormLayout()
        .hardTopEdge()
        .navigationTitle(Text(CommunityScreen.username.title))
        .navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.success, trigger: saved)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if isSaving {
                    ProgressView()
                } else {
                    Button(String(localized: "common.save", defaultValue: "Сохранить")) { Task { await save() } }
                        .disabled(!isValid || normalized == (viewer.profile?.username ?? ""))
                }
            }
        }
        .onAppear { if username.isEmpty { username = viewer.profile?.username ?? "" } }
    }

    private var normalized: String { username.trimmingCharacters(in: .whitespaces).lowercased() }
    private var isValid: Bool { normalized.range(of: "^[a-z0-9_]{3,32}$", options: .regularExpression) != nil }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let profile = try await AccountAPI().changeUsername(normalized)
            viewer.adopt(profile)
            failure = nil
            saved += 1
            dismiss()
        } catch let error as APIError where error.code == .usernameTaken {
            failure = String(localized: "community.username.taken", defaultValue: "Этот логин уже занят")
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Язык писем и пушей

struct CommunityLanguageView: View {
    @Environment(ViewerProfileModel.self) private var viewer
    @State private var selection = "ru"
    @State private var failure: String?
    @State private var saving: String?

    private static let options: [(code: String, title: String)] = [
        ("ru", "Русский"), ("kk", "Қазақша"), ("en", "English"),
    ]

    var body: some View {
        List {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            Section {
                ForEach(Self.options, id: \.code) { option in
                    Button {
                        Task { await choose(option.code) }
                    } label: {
                        HStack {
                            Text(verbatim: option.title).foregroundStyle(Palette.foreground)
                            Spacer()
                            if saving == option.code {
                                ProgressView()
                            } else if selection == option.code {
                                Image(systemName: "checkmark").foregroundStyle(Palette.primary)
                            }
                        }
                    }
                    .accessibilityAddTraits(selection == option.code ? .isSelected : [])
                }
            } footer: {
                Text(String(localized: "community.language.hint", defaultValue: "На этом языке приходят письма и пуш-уведомления. Язык самого приложения меняется в настройках iOS."))
            }

            Section {
                Button(String(localized: "community.language.appSettings", defaultValue: "Язык приложения в настройках iOS")) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
            }
        }
        .compactListStyle()
        .hardTopEdge()
        .navigationTitle(Text(CommunityScreen.notificationLanguage.title))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { selection = viewer.profile?.locale ?? "ru" }
    }

    @MainActor
    private func choose(_ code: String) async {
        guard code != selection else { return }
        saving = code
        defer { saving = nil }
        do {
            let profile = try await CommunityAPI().setLocale(code)
            viewer.adopt(profile)
            selection = code
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }
}

enum CommunityLanguageText {
    static func title(_ code: String?) -> String {
        switch code {
        case "kk": return "Қазақша"
        case "en": return "English"
        default: return "Русский"
        }
    }
}

// MARK: - Telegram

/// Привязка Telegram mini-app (только команда платформы): код на пять минут вводится
/// в боте; привязку можно отозвать.
struct CommunityTelegramLinkView: View {
    @State private var link: CommunityTelegramLinkDTO?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var code: CommunityTelegramCodeDTO?
    @State private var issuedAt = Date()
    @State private var confirmingRevoke = false
    @State private var isBusy = false
    @State private var actionFailure: String?

    private let api = CommunityAPI()

    var body: some View {
        List {
            if let link {
                Section {
                    if link.linked {
                        Label(
                            link.username.map { String(localized: "community.telegram.linkedAs", defaultValue: "Привязан как @\($0)") }
                                ?? String(localized: "community.telegram.linkedNoName", defaultValue: "Привязан (без имени пользователя)"),
                            systemImage: "checkmark.seal.fill"
                        )
                        .foregroundStyle(Palette.success)
                        if let linkedAt = link.linkedAt {
                            DetailRow(title: String(localized: "community.telegram.linkedAt", defaultValue: "С"), value: DisplayFormat.date(linkedAt))
                        }
                        if let seen = link.lastSeenAt {
                            DetailRow(title: String(localized: "community.telegram.lastSeen", defaultValue: "Последний вход"), value: DisplayFormat.relative(seen))
                        }
                    } else {
                        Label(String(localized: "community.telegram.notLinked", defaultValue: "Telegram не привязан"), systemImage: "paperplane")
                    }
                } footer: {
                    Text(String(localized: "community.telegram.hint", defaultValue: "Откройте бота StudentHub в Telegram и введите код на экране привязки."))
                }

                if let code {
                    Section {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let left = max(0, code.expiresIn - Int(context.date.timeIntervalSince(issuedAt)))
                            VStack(spacing: Spacing.md) {
                                Text(verbatim: code.code)
                                    .font(.system(.largeTitle, design: .monospaced).weight(.bold))
                                    .foregroundStyle(left > 0 ? Palette.foreground : Palette.mutedForeground)
                                    .textSelection(.enabled)
                                if left > 0 {
                                    Text(String(localized: "community.telegram.expires", defaultValue: "Действует ещё \(DisplayFormat.minutesSeconds(left))"))
                                        .font(Typography.meta.monospacedDigit())
                                        .foregroundStyle(Palette.mutedForeground)
                                    Button {
                                        UIPasteboard.general.string = code.code
                                    } label: {
                                        Label(String(localized: "community.telegram.copy", defaultValue: "Скопировать"), systemImage: "doc.on.doc")
                                    }
                                    .glassButton()
                                } else {
                                    Text(String(localized: "community.telegram.expired", defaultValue: "Код истёк"))
                                        .font(Typography.meta)
                                        .foregroundStyle(Palette.destructive)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Spacing.md)
                        }
                    }
                }

                Section {
                    Button {
                        Task { await issueCode() }
                    } label: {
                        Label(
                            code == nil
                                ? String(localized: "community.telegram.getCode", defaultValue: "Получить код")
                                : String(localized: "community.telegram.newCode", defaultValue: "Новый код"),
                            systemImage: "key"
                        )
                    }
                    .disabled(isBusy)
                    if link.linked {
                        Button(role: .destructive) {
                            confirmingRevoke = true
                        } label: {
                            Label(String(localized: "community.telegram.revoke", defaultValue: "Отвязать"), systemImage: "link.badge.plus")
                        }
                        .disabled(isBusy)
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }.listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .compactListStyle()
        .hardTopEdge()
        .navigationTitle(Text(CommunityScreen.telegramLink.title))
        .pullToRefresh { await load() }
        .task { await load() }
        .alert(
            String(localized: "community.telegram.revoke.title", defaultValue: "Отвязать Telegram?"),
            isPresented: $confirmingRevoke
        ) {
            Button(String(localized: "community.telegram.revoke", defaultValue: "Отвязать"), role: .destructive) {
                Task { await revoke() }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: {
            Text(String(localized: "community.telegram.revoke.message", defaultValue: "Mini-app перестанет открываться без новой привязки."))
        }
        .actionFailureAlert($actionFailure)
    }

    @MainActor
    private func load() async {
        do {
            link = try await api.telegramLink()
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func issueCode() async {
        isBusy = true
        defer { isBusy = false }
        do {
            code = try await api.telegramCode()
            issuedAt = Date()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func revoke() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await api.revokeTelegramLink()
            code = nil
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

// MARK: - Черновики и отложенные

struct CommunityMyPostsView: View {
    @Environment(\.viewerID) private var viewerID
    @State private var status = "DRAFT"
    @State private var feed = FeedModel(api: FeedAPI(scope: .all))

    var body: some View {
        PostActionsHost(model: feed) { actions in
            ScrollView {
                LazyVStack(spacing: Spacing.lg) {
                    FilterChips(
                        options: [
                            (value: Optional("DRAFT"), title: String(localized: "community.myPosts.drafts", defaultValue: "Черновики")),
                            (value: Optional("SCHEDULED"), title: String(localized: "community.myPosts.scheduled", defaultValue: "Отложенные")),
                        ],
                        selection: Binding(get: { Optional(status) }, set: { if let next = $0 { status = next } }),
                        fillsWidth: true
                    )

                    if !feed.posts.isEmpty {
                        ForEach(feed.posts) { post in
                            VStack(alignment: .leading, spacing: Spacing.sm) {
                                if let at = post.scheduledAt {
                                    StatusBadge(
                                        text: String(localized: "community.myPosts.at", defaultValue: "Выйдет \(DisplayFormat.dateTime(at))"),
                                        tint: Palette.warning
                                    )
                                }
                                PostCardView(post: post, model: feed, viewerID: viewerID, actions: actions)
                            }
                            .onAppear {
                                if post.id == feed.posts.last?.id { Task { await feed.loadMore() } }
                            }
                        }
                    }
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.xl)
            }
            .contentMargins(.top, Spacing.sm, for: .scrollContent)
            .screenState(feed.posts.isEmpty) {
                if !feed.hasLoaded {
                    LoadingStateView()
                } else if let failure = feed.failure {
                    ErrorStateView(message: failure, isOffline: feed.isOffline) { await feed.refresh() }
                } else {
                    EmptyStateView(
                        title: status == "DRAFT"
                            ? String(localized: "community.myPosts.noDrafts", defaultValue: "Черновиков нет")
                            : String(localized: "community.myPosts.noScheduled", defaultValue: "Отложенных публикаций нет"),
                        symbol: status == "DRAFT" ? "doc" : "clock",
                        hint: status == "DRAFT"
                            ? String(localized: "community.myPosts.noDrafts.hint", defaultValue: "Сохраните пост черновиком, чтобы закончить его позже")
                            : String(localized: "community.myPosts.noScheduled.hint", defaultValue: "Выберите время публикации, когда создаёте пост")
                    )
                }
            }
            .background(Palette.background)
            .pullToRefresh { await feed.refresh() }
        }
        .navigationTitle(Text(CommunityScreen.myPosts.title))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(status)|\(viewerID)") {
            guard !viewerID.isEmpty else { return }
            feed = FeedModel(api: FeedAPI(scope: .authorStatus(id: viewerID, status: status)))
            await feed.refresh()
        }
    }
}

// MARK: - Вступление в чат по ссылке

struct CommunityJoinChatView: View {
    let chatID: String
    let code: String

    @Environment(\.viewerRole) private var role
    @Environment(\.viewerID) private var viewerID
    @State private var failure: String?
    @State private var isOffline = false
    @State private var joined: CommunityJoinedChatDTO?

    var body: some View {
        Group {
            if role == .employer {
                EmptyStateView(
                    title: String(localized: "community.join.unavailable", defaultValue: "Групповые чаты работодателю недоступны"),
                    symbol: "person.3"
                )
            } else if let joined {
                ChatThreadView(chatID: joined.id, viewerID: viewerID)
            } else if let failure {
                // Сбой — не «пусто»: с повтором (пропала связь) и выходом к чатам
                // (ссылка недействительна).
                VStack(spacing: Spacing.lg) {
                    ErrorStateView(message: failure, isOffline: isOffline) { await join() }
                    Button(String(localized: "community.join.toChats", defaultValue: "К чатам")) {
                        AppServices.router.select(.chats)
                    }
                    .font(Typography.meta.weight(.semibold))
                }
            } else {
                VStack(spacing: Spacing.lg) {
                    ProgressView()
                    Text(String(localized: "community.join.joining", defaultValue: "Вступаем в чат…"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
        .task { await join() }
    }

    @MainActor
    private func join() async {
        guard joined == nil, role != .employer else { return }
        do {
            joined = try await CommunityAPI().joinChat(id: chatID, code: code)
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}
