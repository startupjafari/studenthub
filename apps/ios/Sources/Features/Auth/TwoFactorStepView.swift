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
        VStack(spacing: Spacing.xl) {
            VStack(spacing: Spacing.md) {
                Text(String(localized: "auth.twoFactorTitle", defaultValue: "Двухфакторная аутентификация"))
                    .font(Typography.sectionTitle)
                    .foregroundStyle(Palette.foreground)
                Text(String(
                    localized: "auth.twoFactorPrompt",
                    defaultValue: "Введите код из приложения-аутентификатора"
                ))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            FormAlert(message: model.formError)

            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel(text: String(localized: "auth.twoFactorCodeLabel", defaultValue: "Код подтверждения"))
                TextField(text: $model.code) {
                    Text(verbatim: String(localized: "auth.twoFactorCodeLabel", defaultValue: "Код подтверждения"))
                }
                .labelsHidden()
                // Не `.numberPad`: резервный код не из одних цифр, и с цифровой
                // клавиатурой его было бы не ввести.
                .keyboardType(.asciiCapable)
                .textContentType(.oneTimeCode)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(Typography.tabular(Typography.body))
                .submitLabel(.go)
                .focused($isCodeFocused)
                .formField(isFocused: isCodeFocused, isInvalid: model.codeError != nil)
                FieldError(message: model.codeError)
                Text(String(
                    localized: "auth.twoFactorBackupHint",
                    defaultValue: "Нет доступа к приложению? Введите один из резервных кодов"
                ))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            }

            Button {
                submit()
            } label: {
                Text(String(localized: "auth.twoFactorVerify", defaultValue: "Подтвердить"))
            }
            .buttonStyle(PrimaryButtonStyle(isLoading: model.isBusy))

            Button {
                model.startOver()
            } label: {
                Text(String(localized: "auth.twoFactorBack", defaultValue: "Назад ко входу"))
            }
            .buttonStyle(QuietButtonStyle())
        }
        .onSubmit { submit() }
        .onAppear { isCodeFocused = true }
    }

    private func submit() {
        isCodeFocused = false
        Task { await model.verifyTwoFactor(into: session) }
    }
}
