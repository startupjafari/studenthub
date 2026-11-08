import SwiftUI

/// Второй шаг входа: код из приложения-аутентификатора или резервный код.
///
/// Отдельный экран, а не диалог поверх формы: пароль на этом шаге уже не нужен, и
/// показывать его рядом — значит предлагать ввести ещё раз.
struct TwoFactorStepView: View {
    @Bindable var model: LoginModel
    let session: AppSessionModel

    @FocusState private var isCodeFocused: Bool

    var body: some View {
        AuthPanelTitle(
            title: String(localized: "auth.twoFactorTitle", defaultValue: "Двухфакторная аутентификация"),
            subtitle: String(localized: "auth.twoFactorPrompt", defaultValue: "Введите код из приложения-аутентификатора")
        )

        FormAlert(message: model.formError)

        VStack(alignment: .leading, spacing: Spacing.sm) {
            StudentHubField(
                label: String(localized: "auth.twoFactorCodeLabel", defaultValue: "Код подтверждения"),
                error: model.codeError,
                isFocused: isCodeFocused
            ) {
                TextField(text: $model.code) {
                    Text(String(localized: "auth.twoFactorCodeLabel", defaultValue: "Код подтверждения"))
                }
                // Не `.numberPad`: резервный код не из одних цифр, и с цифровой
                // клавиатурой его было бы не ввести.
                .keyboardType(.asciiCapable)
                .textContentType(.oneTimeCode)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(Typography.tabular(.title3))
                .submitLabel(.go)
                .focused($isCodeFocused)
                .onSubmit(submit)
            }
            Text(String(
                localized: "auth.twoFactorBackupHint",
                defaultValue: "Нет доступа к приложению? Введите один из резервных кодов"
            ))
            .font(.footnote)
            .foregroundStyle(Palette.mutedForeground)
            .fixedSize(horizontal: false, vertical: true)
        }

        StudentHubPrimaryButton(
            title: String(localized: "auth.twoFactorVerify", defaultValue: "Подтвердить"),
            isLoading: model.isBusy,
            action: submit
        )

        AuthTextLink(title: String(localized: "auth.twoFactorBack", defaultValue: "Назад ко входу")) {
            model.startOver()
        }
        .frame(maxWidth: .infinity)
        .onAppear { isCodeFocused = true }
    }

    private func submit() {
        isCodeFocused = false
        Task { await model.verifyTwoFactor(into: session) }
    }
}
