import SwiftUI

/// Второй шаг входа: код из приложения-аутентификатора или резервный код.
///
/// Отдельный экран, а не диалог поверх формы: пароль на этом шаге уже не нужен, и
/// показывать его рядом — значит предлагать ввести ещё раз. «Назад ко входу» — шеврон
/// в панели навигации (`LoginView`), как на остальных экранах до входа.
///
/// Два режима ввода, оба — по ячейкам, как пин-код (`OneTimeCodeField`). Код из
/// приложения — шесть цифр: цифровая клавиатура, подстановка из «Паролей» и SMS
/// (`.oneTimeCode`). Резервный код — восемь символов 0–9 и A–F (`randomBytes(4)` на
/// сервере), обычная клавиатура, ячейки группами по четыре; переключатель под формой, а
/// вставленный код с буквами переключает режим сам. Оба уходят сами, как только
/// заполнены все ячейки. Отдельной кнопки вставки нет: код подставляет клавиатура, а
/// скопированный вставляется долгим нажатием на ячейки — под ними настоящее поле.
struct TwoFactorStepView: View {
    @Bindable var model: LoginModel
    let session: AppSessionModel

    @Environment(\.motionReduced) private var reduceMotion
    @FocusState private var isCodeFocused: Bool
    @State private var usesBackupCode = false
    /// Код, уже отправленный сам: исправили одну цифру — уйдёт снова, а тот же код,
    /// пришедший повторным событием изменения, — нет.
    @State private var autoSubmitted: String?

    /// Длина кода из приложения (TOTP, `auth.error.codeTooShort`).
    private static let appCodeLength = 6
    /// Длина резервного кода: четыре байта в шестнадцатеричной записи.
    private static let backupCodeLength = 8

    private var length: Int { usesBackupCode ? Self.backupCodeLength : Self.appCodeLength }

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

        codeField

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
        OneTimeCodeField(
            code: $model.code,
            length: length,
            groupSize: usesBackupCode ? 4 : nil,
            keyboard: usesBackupCode ? .asciiCapable : .numberPad,
            placeholder: placeholder,
            error: model.codeError,
            isFocused: $isCodeFocused,
            isDisabled: model.isBusy,
            submit: submit
        )
        // Тип клавиатуры у поля в фокусе система не меняет на лету — при смене режима
        // поле создаётся заново, ячейки сменяются плавно.
        .id(usesBackupCode)
        .transition(.opacity)
        .onChange(of: model.code) { _, code in codeChanged(code) }
        .onAppear { isCodeFocused = true }
    }

    private var placeholder: String {
        usesBackupCode
            ? String(localized: "auth.twoFactor.backupCodePlaceholder", defaultValue: "Резервный код")
            : String(localized: "auth.twoFactor.appCodePlaceholder", defaultValue: "Код из 6 цифр")
    }

    /// В поле остаются только допустимые символы и не больше ячеек: подстановка и
    /// вставка приносят и «123 456», и «Ваш код: 123456», и «abcd-1234».
    private func codeChanged(_ code: String) {
        model.clearError(for: .code)
        // Буквы бывают только в резервном коде: вставили его в режиме кода из
        // приложения — переходим в резервный с этим кодом.
        if !usesBackupCode, code.contains(where: \.isLetter) {
            let backup = Self.backupSymbols(in: code)
            if backup.count == Self.backupCodeLength {
                withAnimation(AuthMotion.layout(reduceMotion: reduceMotion)) { usesBackupCode = true }
                model.code = backup
                // Поле пересоздаётся под новую клавиатуру — фокус в новое.
                Task { @MainActor in isCodeFocused = true }
                return
            }
        }
        let clean = usesBackupCode ? Self.backupSymbols(in: code) : Self.digits(in: code)
        guard clean == code else {
            model.code = clean
            return
        }
        if clean.count < length {
            autoSubmitted = nil
        } else if clean != autoSubmitted, !model.isBusy {
            autoSubmitted = clean
            submit()
        }
    }

    private func switchMode() {
        model.code = ""
        autoSubmitted = nil
        withAnimation(AuthMotion.layout(reduceMotion: reduceMotion)) { usesBackupCode.toggle() }
        isCodeFocused = false
        // Новое поле появится на следующем такте — фокус ставим в него.
        Task { @MainActor in isCodeFocused = true }
    }

    private static func digits(in text: String) -> String {
        String(text.filter { $0.isASCII && $0.isNumber }.prefix(appCodeLength))
    }

    /// Резервный код: 0–9 и A–F заглавными; пробелы и дефисы сервер всё равно убирает.
    private static func backupSymbols(in text: String) -> String {
        String(text.uppercased().filter { $0.isASCII && $0.isHexDigit }.prefix(backupCodeLength))
    }

    private func submit() {
        Task {
            await model.verifyTwoFactor(into: session)
            if model.codeError != nil { isCodeFocused = true }
        }
    }
}
