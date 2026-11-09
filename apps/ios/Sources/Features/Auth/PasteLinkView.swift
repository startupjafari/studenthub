import SwiftUI

/// «У меня есть приглашение»: вставить ссылку из письма или сообщения.
///
/// Пока на домене нет apple-app-site-association, ссылка из письма открывается в
/// браузере, а не в приложении. Этот экран — путь в регистрацию и новый пароль без
/// браузера: человек копирует ссылку и вставляет её сюда. Принимается и ссылка внутри
/// текста сообщения («Вас пригласили: https://…»).
struct PasteLinkView: View {
    let open: (AuthLink) -> Void

    @State private var text = ""
    @State private var error: String?
    @FocusState private var isFocused: Bool

    var body: some View {
        AuthScaffold {
            StudentHubBrandHeader(
                title: String(localized: "auth.pasteLink.title", defaultValue: "У меня есть приглашение"),
                subtitle: String(
                    localized: "auth.pasteLink.description",
                    defaultValue: "Вставьте ссылку из письма или сообщения — приглашение на регистрацию или ссылку для нового пароля."
                ),
                showsWordmark: false,
                subtitleIsEssential: true
            )
        } panel: {
            StudentHubField(
                label: nil,
                error: error,
                isFocused: isFocused,
                focus: { isFocused = true }
            ) {
                TextField(
                    text: $text,
                    prompt: Text(String(localized: "auth.pasteLink.placeholder", defaultValue: "Ссылка из письма")),
                    axis: .vertical
                ) {
                    Text(String(localized: "auth.pasteLink.placeholder", defaultValue: "Ссылка из письма"))
                }
                .lineLimit(1...4)
                .padding(.vertical, Spacing.md)
                .keyboardType(.URL)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .focused($isFocused)
                .onSubmit(submit)
                .onChange(of: text) { error = nil }
            }

            // Системная кнопка вставки не спрашивает разрешения на чтение буфера: человек
            // сам нажал «Вставить».
            PasteButton(payloadType: String.self) { strings in
                guard let pasted = strings.first else { return }
                Task { @MainActor in
                    text = pasted
                    submit()
                }
            }
            .buttonBorderShape(.capsule)
            .frame(maxWidth: .infinity)

            StudentHubPrimaryButton(
                title: String(localized: "auth.pasteLink.open", defaultValue: "Открыть"),
                action: submit
            )
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() {
        guard let link = AuthLink(pasted: text) else {
            error = String(
                localized: "auth.pasteLink.unknown",
                defaultValue: "Это не ссылка-приглашение и не ссылка для нового пароля. Скопируйте её из письма целиком."
            )
            return
        }
        isFocused = false
        error = nil
        open(link)
    }
}
