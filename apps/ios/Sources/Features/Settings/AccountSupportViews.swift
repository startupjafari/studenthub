import SwiftUI

/// Обращение в поддержку. Сервер заводит чат с командой платформы и отвечает его
/// id — туда и переходим: ответ придёт в переписку, а не в никуда. У охраны и
/// библиотеки чатов нет (`hasChats` в вебе): им — подтверждение на месте.
struct SupportView: View {
    @Environment(\.viewerRole) private var role
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
        .hardTopEdge()
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
            let ticket = try await AccountAPI().contactSupport(text: text.trimmingCharacters(in: .whitespacesAndNewlines))
            text = ""
            failure = nil
            if AppTab.tabs(for: role).contains(.chats) {
                AppServices.router.select(.chats)
                AppServices.router.stacks[.chats] = [.chat(id: ticket.id)]
            } else {
                sent = true
            }
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
        .hardTopEdge()
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
