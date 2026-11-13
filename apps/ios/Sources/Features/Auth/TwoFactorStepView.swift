import SwiftUI

/// Второй шаг входа: код из приложения-аутентификатора или резервный код.
///
/// Отдельный экран, а не диалог поверх формы: пароль на этом шаге уже не нужен, и
/// показывать его рядом — значит предлагать ввести ещё раз. «Назад ко входу» — шеврон
/// в панели навигации (`LoginView`), как на остальных экранах до входа.
///
/// Два режима ввода. Код из приложения — шесть цифр: цифровая клавиатура, подстановка
/// из «Паролей» и SMS (`.oneTimeCode`), отправка сама, как только набраны все шесть.
/// Резервный код — с буквами, ему нужна обычная клавиатура; переключатель под формой,
/// а вставленный из буфера код с буквами переключает режим сам.
struct TwoFactorStepView: View {
    @Bindable var model: LoginModel
    let session: AppSessionModel

    @FocusState private var isCodeFocused: Bool
    @State private var usesBackupCode = false
    /// Код, уже отправленный сам: исправили одну цифру — уйдёт снова, а тот же код,
    /// пришедший повторным событием изменения, — нет.
    @State private var autoSubmitted: String?

    /// Длина кода из приложения (TOTP, `auth.error.codeTooShort`).
    private static let appCodeLength = 6

    var body: some View {
        AuthPanelTitle(
            title: String(localized: "auth.twoFactorTitle", defaultValue: "Двухфакторная аутентификация"),
            subtitle: usesBackupCode
                ? String(
                    localized: "auth.twoFactorBackupHint",
                    defaultValue: "Нет доступа к приложению? Введите один из резервных кодов"
                )
                : String(localized: "auth.twoFactorPrompt", defaultValue: "Введите код из приложения-аутентификатора")
        )

        AuthFormError(message: model.formError, isOffline: model.formErrorIsOffline, retry: submit)

        StudentHubField(
            label: nil,
            error: model.codeError,
            isFocused: isCodeFocused,
            focus: { isCodeFocused = true }
        ) {
            codeField
        } accessory: {
            // Системная кнопка вставки не спрашивает разрешения на чтение буфера: человек
            // сам нажал «Вставить».
            PasteButton(payloadType: String.self) { strings in
                guard let pasted = strings.first else { return }
                Task { @MainActor in paste(pasted) }
            }
            .labelStyle(.iconOnly)
            .buttonBorderShape(.capsule)
            .tint(Palette.primary)
            .disabled(model.isBusy)
        }

        StudentHubPrimaryButton(
            title: String(localized: "auth.twoFactorVerify", defaultValue: "Подтвердить"),
            isLoading: model.isBusy,
            action: submit
        )
        .onChange(of: model.isBusy) { _, busy in
            if busy { isCodeFocused = false }
        }

        AuthTextLink(
            title: usesBackupCode
                ? String(localized: "auth.twoFactor.useAppCode", defaultValue: "Ввести код из приложения")
                : String(localized: "auth.twoFactor.useBackupCode", defaultValue: "Ввести резервный код"),
            action: switchMode
        )
        .frame(maxWidth: .infinity)
        .disabled(model.isBusy)
    }

    private var codeField: some View {
        TextField(text: $model.code, prompt: Text(placeholder)) {
            Text(String(localized: "auth.twoFactorCodeLabel", defaultValue: "Код подтверждения"))
        }
        .keyboardType(usesBackupCode ? .asciiCapable : .numberPad)
        .textContentType(.oneTimeCode)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .font(Typography.tabular(.title3))
        .tracking(usesBackupCode ? 0 : 4)
        .submitLabel(.go)
        .focused($isCodeFocused)
        .accessibilityIdentifier("auth.code")
        .onSubmit(submit)
        .disabled(model.isBusy)
        // Тип клавиатуры у поля в фокусе система не меняет на лету — при смене режима
        // поле создаётся заново.
        .id(usesBackupCode)
        .onChange(of: model.code) { _, code in codeChanged(code) }
        .onAppear { isCodeFocused = true }
    }

    private var placeholder: String {
        usesBackupCode
            ? String(localized: "auth.twoFactor.backupCodePlaceholder", defaultValue: "Резервный код")
            : String(localized: "auth.twoFactor.appCodePlaceholder", defaultValue: "Код из 6 цифр")
    }

    /// В режиме кода из приложения в поле остаются только цифры, не больше шести —
    /// подстановка и вставка приносят и «123 456», и «Ваш код: 123456».
    private func codeChanged(_ code: String) {
        model.clearError(for: .code)
        guard !usesBackupCode else { return }
        let digits = Self.digits(in: code)
        guard digits == code else {
            model.code = digits
            return
        }
        if digits.count < Self.appCodeLength {
            autoSubmitted = nil
        } else if digits != autoSubmitted, !model.isBusy {
            autoSubmitted = digits
            submit()
        }
    }

    private func paste(_ text: String) {
        let pasted = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // Буквы бывают только в резервном коде.
        if !usesBackupCode, pasted.contains(where: \.isLetter) {
            usesBackupCode = true
        }
        model.code = usesBackupCode ? pasted : Self.digits(in: pasted)
        // Код из приложения уходит сам на шестой цифре (`codeChanged`), резервный —
        // сразу: дописывать к вставленному нечего.
        if usesBackupCode, !pasted.isEmpty { submit() }
    }

    private func switchMode() {
        model.code = ""
        autoSubmitted = nil
        usesBackupCode.toggle()
        isCodeFocused = false
        // Новое поле появится на следующем такте — фокус ставим в него.
        Task { @MainActor in isCodeFocused = true }
    }

    private static func digits(in text: String) -> String {
        String(text.filter { $0.isASCII && $0.isNumber }.prefix(appCodeLength))
    }

    private func submit() {
        Task {
            await model.verifyTwoFactor(into: session)
            if model.codeError != nil { isCodeFocused = true }
        }
    }
}
