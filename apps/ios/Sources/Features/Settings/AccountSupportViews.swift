import GRDB
import SwiftUI

/// «Поддержка» — отовсюду, где на неё переходят, сразу переписка с командой платформы:
/// туда и пишут, туда и приходит ответ. У охраны и библиотеки чатов нет (`hasChats` в
/// вебе): им — прежняя форма обращения с подтверждением на месте.
struct SupportView: View {
    @Environment(\.viewerRole) private var role

    var body: some View {
        if AppTab.tabs(for: role).contains(.chats) {
            SupportChatView()
        } else {
            SupportFormView()
        }
    }
}

/// Чат поддержки. Обращение на сервере — это чат `SUPPORT_PLATFORM`: есть он уже в
/// списке чатов — открываем его на месте, нет — пустая переписка с полем ввода, первое
/// сообщение заводит обращение (`POST /support` — сервер создаёт его только с текстом), и
/// экран тут же становится этим чатом. Закрытое обращение сервер открывает снова на
/// новое сообщение.
private struct SupportChatView: View {
    @Environment(\.viewerID) private var viewerID
    @State private var chatID: String?
    @State private var looked = false

    var body: some View {
        Group {
            if let chatID {
                ChatThreadView(chatID: chatID, viewerID: viewerID)
                    .transition(.opacity)
            } else if looked {
                SupportStarterView { chatID = $0 }
                    .transition(.opacity)
            } else {
                Palette.background.ignoresSafeArea()
            }
        }
        .animation(Motion.calm, value: chatID)
        .task {
            guard !looked else { return }
            chatID = await Self.knownTicket()
            looked = true
        }
    }

    /// Последнее обращение из локальной базы списка чатов.
    private static func knownTicket() async -> String? {
        try? await AppServices.database.reader.read { db in
            try ChatRecord
                .filter(Column("type") == ChatKind.supportPlatform.rawValue)
                .order(Column("updatedAt").desc)
                .fetchOne(db)?
                .id
        }
    }
}

/// Пустая переписка с поддержкой: кто ответит и поле ввода внизу, как в чате.
private struct SupportStarterView: View {
    let opened: (String) -> Void

    @State private var text = ""
    @State private var failure: String?
    @State private var isSending = false
    @FocusState private var editing: Bool

    private var canSend: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).count >= 10 && !isSending }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.md) {
                Image(systemName: "questionmark.bubble.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 76, height: 76)
                    .background(Palette.primary, in: Circle())
                    .accessibilityHidden(true)
                    .padding(.bottom, Spacing.xs)
                Text(String(localized: "settings.support", defaultValue: "Поддержка"))
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                Text(String(
                    localized: "settings.support.footer",
                    defaultValue: "Не короче 10 символов. Ответ придёт в чат «Поддержка»."
                ))
                .font(.subheadline)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Spacing.xxl)
            .padding(.top, Spacing.xxl * 2)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.background)
        .safeAreaInset(edge: .bottom) { composer }
        .navigationTitle(Text(String(localized: "settings.support", defaultValue: "Поддержка")))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { editing = true }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            if let failure {
                Text(failure)
                    .font(.footnote)
                    .foregroundStyle(Palette.destructive)
                    .padding(.horizontal, Spacing.sm)
                    .transition(.opacity)
            }
            HStack(alignment: .bottom, spacing: Spacing.sm) {
                TextField(
                    String(localized: "settings.support.placeholder", defaultValue: "Опишите, что случилось"),
                    text: $text,
                    axis: .vertical
                )
                .lineLimit(1...6)
                .focused($editing)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, 10)
                .background(Palette.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .onChange(of: text) { failure = nil }
                Button {
                    Task { await send() }
                } label: {
                    Group {
                        if isSending {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "arrow.up").font(.body.weight(.bold))
                        }
                    }
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(canSend || isSending ? Palette.primary : Palette.mutedForeground.opacity(0.4), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .accessibilityLabel(Text(String(localized: "settings.support.send", defaultValue: "Отправить")))
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
        .background(.bar)
        .animation(Motion.calm, value: failure)
    }

    @MainActor
    private func send() async {
        guard canSend else { return }
        isSending = true
        defer { isSending = false }
        do {
            let ticket = try await AccountAPI().contactSupport(text: text.trimmingCharacters(in: .whitespacesAndNewlines))
            text = ""
            opened(ticket.id)
        } catch {
            failure = error.userMessage
        }
    }
}

/// Форма обращения — для ролей без чатов: ответ придёт иначе, здесь только подтверждение.
private struct SupportFormView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var failure: String?
    @State private var isSending = false
    @State private var sent = false
    @FocusState private var editing: Bool

    private var canSend: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).count >= 10 && !isSending }

    var body: some View {
        Form {
            if let failure {
                FormAlert(message: failure).listRowBackground(Color.clear)
            }
            Section {
                TextField(
                    String(localized: "settings.support.placeholder", defaultValue: "Опишите, что случилось"),
                    text: $text,
                    axis: .vertical
                )
                // Пять строк сразу — видно, что писать можно подробно; дальше поле растёт
                // до двенадцати и прокручивается внутри, кнопка не уезжает за клавиатуру.
                .lineLimit(5...12)
                .focused($editing)
            } footer: {
                Text(String(
                    localized: "settings.support.footer",
                    defaultValue: "Не короче 10 символов. Ответ придёт в чат «Поддержка»."
                ))
            }

            Section {
                Button {
                    Task { await send() }
                } label: {
                    Text(String(localized: "settings.support.send", defaultValue: "Отправить"))
                }
                .buttonStyle(PrimaryButtonStyle(isLoading: isSending))
                .disabled(!canSend)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
        }
        .settingsFormLayout()
        .softTopEdge()
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(Text(String(localized: "settings.support", defaultValue: "Поддержка")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // В многострочном поле «Ввод» переносит строку, а не закрывает клавиатуру:
            // без «Готово» над ней до «Отправить» было не добраться, не смахивая список.
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button(String(localized: "common.done", defaultValue: "Готово")) { editing = false }
            }
        }
        .alert(
            String(localized: "settings.support.sent", defaultValue: "Обращение отправлено"),
            isPresented: $sent
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) { dismiss() }
        } message: {
            Text(String(localized: "settings.support.sent.hint", defaultValue: "Команда поддержки получила его и свяжется с вами."))
        }
    }

    @MainActor
    private func send() async {
        guard !isSending else { return }
        isSending = true
        defer { isSending = false }
        do {
            _ = try await AccountAPI().contactSupport(text: text.trimmingCharacters(in: .whitespacesAndNewlines))
            text = ""
            failure = nil
            sent = true
        } catch {
            failure = error.userMessage
        }
    }
}

/// Удаление аккаунта. Сначала спрашиваем сервер, можно ли (книги на руках не дают),
/// затем пароль и, при включённой 2FA, код. Последний шаг — подтверждение диалогом.
struct DeleteAccountView: View {
    let session: AppSessionModel

    @Environment(ViewerProfileModel.self) private var viewer
    @State private var check: DeletionCheckDTO?
    /// Проверка «можно ли удалить» не пришла: без неё формы нет — нужен повтор.
    @State private var checkFailure: String?
    @State private var checkOffline = false
    @State private var password = ""
    @State private var code = ""
    @State private var failure: String?
    @State private var isDeleting = false
    @State private var confirms = false

    private let api: AccountFetching = AccountAPI()
    private var needsCode: Bool { viewer.profile?.twoFactorEnabled == true }
    private var canDelete: Bool {
        check?.canDelete == true && !password.isEmpty && (!needsCode || code.count >= 6) && !isDeleting
    }

    var body: some View {
        Form {
            if let failure {
                FormAlert(message: failure).listRowBackground(Color.clear)
            }
            if let check, !check.canDelete {
                Section {
                    ForEach(check.blockers, id: \.self) { blocker in
                        Label(Self.blockerText(blocker), systemImage: "exclamationmark.octagon")
                            .foregroundStyle(Palette.destructive)
                    }
                } header: {
                    Text(String(localized: "settings.delete.blocked", defaultValue: "Сейчас удалить нельзя"))
                }
            } else if check != nil {
                Section {
                    SecureField(String(localized: "settings.password.current", defaultValue: "Текущий пароль"), text: $password)
                        .textContentType(.password)
                    if needsCode {
                        // Код из приложения или резервный (8 знаков 0–9 и A–F): нужны буквы.
                        TextField(String(localized: "settings.2fa.code", defaultValue: "Код"), text: $code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.asciiCapable)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                    }
                } footer: {
                    Text(String(
                        localized: "settings.danger.footer",
                        defaultValue: "Удаление необратимо: профиль, публикации и переписки исчезнут."
                    ))
                }

                Section {
                    Button(role: .destructive) {
                        confirms = true
                    } label: {
                        HStack {
                            Text(String(localized: "settings.deleteAccount", defaultValue: "Удалить аккаунт"))
                            Spacer()
                            if isDeleting { ProgressView() }
                        }
                    }
                    .disabled(!canDelete)
                }
            }
        }
        .settingsFormLayout()
        .softTopEdge()
        // Проверка ещё идёт или не пришла — состояние по центру экрана, как на других
        // разделах, а не строкой формы под панелью.
        .screenState(check == nil) {
            if let checkFailure {
                ErrorStateView(message: checkFailure, isOffline: checkOffline) { await loadCheck() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(String(localized: "settings.deleteAccount", defaultValue: "Удалить аккаунт")))
        .navigationBarTitleDisplayMode(.inline)
        .alert(
            String(localized: "settings.delete.confirm", defaultValue: "Удалить аккаунт навсегда?"),
            isPresented: $confirms
        ) {
            Button(String(localized: "settings.deleteAccount", defaultValue: "Удалить аккаунт"), role: .destructive) {
                Task { await delete() }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: {
            Text(String(localized: "settings.delete.confirmMessage", defaultValue: "Восстановить его будет нельзя."))
        }
        .task { await loadCheck() }
    }

    @MainActor
    private func loadCheck() async {
        do {
            check = try await api.deletionCheck()
            checkFailure = nil
        } catch is CancellationError {
            return
        } catch {
            checkFailure = error.userMessage
            checkOffline = error.isOffline
        }
    }

    static func blockerText(_ blocker: String) -> String {
        switch blocker {
        case "libraryDebts":
            return String(localized: "settings.delete.libraryDebts", defaultValue: "На руках книги из библиотеки — сначала верните их")
        default:
            return String(localized: "settings.delete.other", defaultValue: "Аккаунт нельзя удалить — обратитесь в поддержку")
        }
    }

    @MainActor
    private func delete() async {
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await api.deleteAccount(password: password, code: needsCode ? code : nil)
            await session.signOut()
        } catch {
            failure = error.userMessage
        }
    }
}
