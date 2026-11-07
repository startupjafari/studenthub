import SwiftUI

/// Обращение в поддержку. Сервер заводит чат с командой платформы и отвечает его
/// id — туда и переходим: ответ придёт в переписку, а не в никуда.
struct SupportView: View {
    @State private var text = ""
    @State private var failure: String?
    @State private var isSending = false

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
                .lineLimit(5...12)
            } footer: {
                Text(String(
                    localized: "settings.support.footer",
                    defaultValue: "Не короче 10 символов. Ответ придёт в чат «Поддержка»."
                ))
            }
            .listRowBackground(Palette.card)

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
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "settings.support", defaultValue: "Поддержка")))
        .navigationBarTitleDisplayMode(.inline)
    }

    @MainActor
    private func send() async {
        isSending = true
        defer { isSending = false }
        do {
            let ticket = try await AccountAPI().contactSupport(text: text.trimmingCharacters(in: .whitespacesAndNewlines))
            text = ""
            failure = nil
            AppServices.router.select(.chats)
            AppServices.router.stacks[.chats] = [.chat(id: ticket.id)]
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
                .listRowBackground(Palette.card)
            } else if check != nil {
                Section {
                    SecureField(String(localized: "settings.password.current", defaultValue: "Текущий пароль"), text: $password)
                        .textContentType(.password)
                    if needsCode {
                        TextField(String(localized: "settings.2fa.code", defaultValue: "Код"), text: $code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.asciiCapable)
                    }
                } footer: {
                    Text(String(
                        localized: "settings.danger.footer",
                        defaultValue: "Удаление необратимо: профиль, публикации и переписки исчезнут."
                    ))
                }
                .listRowBackground(Palette.card)

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
                .listRowBackground(Palette.card)
            } else if failure == nil {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "settings.deleteAccount", defaultValue: "Удалить аккаунт")))
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            String(localized: "settings.delete.confirm", defaultValue: "Удалить аккаунт навсегда?"),
            isPresented: $confirms,
            titleVisibility: .visible
        ) {
            Button(String(localized: "settings.deleteAccount", defaultValue: "Удалить аккаунт"), role: .destructive) {
                Task { await delete() }
            }
        } message: {
            Text(String(localized: "settings.delete.confirmMessage", defaultValue: "Восстановить его будет нельзя."))
        }
        .task {
            do {
                check = try await api.deletionCheck()
            } catch {
                failure = error.userMessage
            }
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
