import Observation
import SwiftUI

/// Обязательная настройка 2FA сразу после входа (как `SetupTwoFactorGate` в вебе).
///
/// Роли из `Role.requiresTwoFactor` без второго фактора сервер дальше настройки не пускает
/// (`TWO_FACTOR_SETUP_REQUIRED`). Раньше приложение всё равно открывало оболочку: экраны
/// пустели от отказов, а 2FA человек искал в настройках сам. Теперь ключ запрашивается
/// сразу, без лишнего шага «Настроить»: вход уже был, и делать здесь больше нечего.
///
/// Шаги: ключ и код → резервные коды → продление сессии за токеном с 2FA. Флаг 2FA в
/// токене меняет только продление (сервер собирает его заново из базы), поэтому
/// «Продолжить» продлевает сессию, а не просто закрывает экран.
@MainActor
@Observable
final class TwoFactorSetupGateModel {
    enum Phase: Equatable {
        /// Ключ запрашивается или не пришёл (`formError`).
        case loading
        /// Ключ есть — добавить его в аутентификатор и ввести код.
        case enroll(TwoFactorSetupDTO)
        /// 2FA включена — коды показываются один раз.
        case backupCodes([String])
    }

    /// Длина кода из приложения (TOTP, `two-factor.service.ts`: `/^\d{6}$/`).
    static let codeLength = 6

    var code = ""
    private(set) var phase: Phase = .loading
    private(set) var isBusy = false
    private(set) var codeError: String?
    private(set) var formError: String?
    private(set) var formErrorIsOffline = false

    private let api: AccountFetching
    /// Продлить сессию за токеном с 2FA и открыть приложение (`AppSessionModel`).
    private let complete: @MainActor () async -> Bool

    init(api: AccountFetching = AccountAPI(), complete: @escaping @MainActor () async -> Bool) {
        self.api = api
        self.complete = complete
    }

    func load() async {
        guard !isBusy else { return }
        clearFormError()
        isBusy = true
        defer { isBusy = false }
        do {
            phase = .enroll(try await api.setupTwoFactor())
        } catch is CancellationError {
            return
        } catch let error as APIError where error.code == .conflict {
            // 2FA уже включена (в вебе или на другом телефоне), а токен старый — настраивать
            // нечего, сессию продлеваем за свежим токеном.
            await finishWhileBusy()
        } catch {
            show(error)
        }
    }

    func enable() async {
        guard !isBusy, case .enroll = phase else { return }
        clearFormError()
        let entered = OneTimeCode.normalized(code)
        guard entered.count == Self.codeLength else {
            codeError = String(localized: "auth.error.codeTooShort", defaultValue: "Код из 6 цифр или резервный код")
            return
        }
        codeError = nil
        isBusy = true
        defer { isBusy = false }
        do {
            let issued = try await api.enableTwoFactor(code: entered)
            code = ""
            phase = .backupCodes(issued.backupCodes)
        } catch let error as APIError where error.code == .invalidTwoFactorCode {
            code = ""
            codeError = error.displayMessage
        } catch let error as APIError where error.code == .conflict {
            await finishWhileBusy()
        } catch {
            show(error)
        }
    }

    /// Коды сохранены — в приложение.
    func finish() async {
        guard !isBusy else { return }
        clearFormError()
        isBusy = true
        defer { isBusy = false }
        await finishWhileBusy()
    }

    func clearCodeError() {
        codeError = nil
    }

    private func finishWhileBusy() async {
        guard await complete() else {
            // Продление не дошло (нет связи) — экран остаётся, повтор той же кнопкой.
            formError = String(
                localized: "auth.twoFactorSetup.finishFailed",
                defaultValue: "Не удалось открыть приложение. Проверьте связь и попробуйте ещё раз"
            )
            formErrorIsOffline = false
            return
        }
    }

    private func show(_ error: Error) {
        formError = error.userMessage
        formErrorIsOffline = error.isOffline
    }

    private func clearFormError() {
        formError = nil
        formErrorIsOffline = false
    }
}

struct TwoFactorSetupGateView: View {
    let session: AppSessionModel
    let role: Role

    @Environment(\.motionReduced) private var reduceMotion
    @State private var model: TwoFactorSetupGateModel
    @State private var signingOut = false

    init(session: AppSessionModel, role: Role) {
        self.session = session
        self.role = role
        _model = State(initialValue: TwoFactorSetupGateModel { await session.completeTwoFactorSetup() })
    }

    var body: some View {
        AuthScaffold(keyboardTarget: isEnrolling ? AnyHashable(AuthScrollTarget.primary) : nil) {
            StudentHubBrandHeader(
                title: String(
                    localized: "auth.twoFactorSetup.title",
                    defaultValue: "Настройте двухфакторную аутентификацию"
                ),
                subtitle: String(
                    localized: "auth.twoFactorSetup.subtitle",
                    defaultValue: "Для роли «\(role.title)» она обязательна: без кода из приложения-аутентификатора войти в аккаунт нельзя."
                ),
                collapsesWithKeyboard: true
            )
        } panel: {
            switch model.phase {
            case .loading:
                loadingPanel
            case .enroll(let setup):
                TwoFactorEnrollPanel(model: model, setup: setup)
                signOutLink
            case .backupCodes(let codes):
                TwoFactorBackupCodesPanel(model: model, codes: codes)
            }
        }
        .animation(AuthMotion.layout(reduceMotion: reduceMotion), value: model.phase)
        .task {
            guard case .loading = model.phase else { return }
            await model.load()
        }
    }

    private var isEnrolling: Bool {
        if case .enroll = model.phase { return true }
        return false
    }

    @ViewBuilder
    private var loadingPanel: some View {
        AuthPanelTitle(title: String(localized: "auth.twoFactorSetup.keyTitle", defaultValue: "Ключ для приложения"))
        if model.formError != nil {
            AuthFormError(message: model.formError, isOffline: model.formErrorIsOffline) {
                Task { await model.load() }
            }
            StudentHubPrimaryButton(
                title: String(localized: "common.retry", defaultValue: "Повторить"),
                isLoading: model.isBusy
            ) {
                Task { await model.load() }
            }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, minHeight: 120)
        }
        signOutLink
    }

    /// Уйти со входа другим аккаунтом. На шаге резервных кодов ссылки нет, как в вебе:
    /// коды показываются один раз, и выход в этот момент означал бы их потерю.
    private var signOutLink: some View {
        AuthTextLink(title: String(localized: "auth.twoFactorSetup.signOut", defaultValue: "Выйти из аккаунта")) {
            guard !signingOut else { return }
            signingOut = true
            Task { await session.signOut() }
        }
        .frame(maxWidth: .infinity)
        .disabled(model.isBusy || signingOut)
    }
}

/// Ключ и код. На телефоне QR-код с его же экрана не отсканировать, поэтому первым —
/// «Открыть в приложении-аутентификаторе» и ключ с копированием; QR — для аутентификатора
/// на другом устройстве.
private struct TwoFactorEnrollPanel: View {
    @Bindable var model: TwoFactorSetupGateModel
    let setup: TwoFactorSetupDTO

    @FocusState private var isCodeFocused: Bool
    @State private var showsQR = false
    @State private var copied = false
    /// Код, уже отправленный сам: исправили цифру — уйдёт снова, повтор того же — нет.
    @State private var autoSubmitted: String?

    var body: some View {
        AuthPanelTitle(
            title: String(localized: "auth.twoFactorSetup.keyTitle", defaultValue: "Ключ для приложения"),
            subtitle: String(
                localized: "auth.twoFactorSetup.keyHint",
                defaultValue: "Добавьте ключ в приложение-аутентификатор (Google Authenticator, «Пароли» и т. п.) и введите код из него."
            )
        )

        AuthFormError(message: model.formError, isOffline: model.formErrorIsOffline) {
            Task { await model.enable() }
        }

        if let url = URL(string: setup.otpauthUrl) {
            StudentHubSecondaryButton(
                title: String(localized: "settings.2fa.openApp", defaultValue: "Открыть в приложении-аутентификаторе"),
                systemImage: "arrow.up.forward.app"
            ) {
                // Ссылку выдал наш сервер, а не чужое содержимое: подтверждать её
                // окном с полным адресом (в нём — сам ключ) незачем.
                ExternalLinkOpener.open(url, confirmed: true)
            }
            .disabled(model.isBusy)
        }

        secretRow

        if let qr = setup.qr {
            if showsQR, let image = DataURLImage.image(from: qr) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 180, height: 180)
                    .padding(Spacing.md)
                    .background(.white, in: RoundedRectangle(cornerRadius: AuthMetrics.fieldRadius, style: .continuous))
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel(Text(String(localized: "settings.2fa.qr", defaultValue: "QR-код для приложения-аутентификатора")))
                    .transition(.opacity)
            } else {
                AuthTextLink(
                    title: String(localized: "auth.twoFactorSetup.showQR", defaultValue: "Показать QR-код для другого устройства")
                ) {
                    showsQR = true
                }
                .frame(maxWidth: .infinity)
            }
        }

        OneTimeCodeField(
            code: $model.code,
            length: TwoFactorSetupGateModel.codeLength,
            placeholder: String(localized: "auth.twoFactor.appCodePlaceholder", defaultValue: "Код из 6 цифр"),
            error: model.codeError,
            isFocused: $isCodeFocused,
            isDisabled: model.isBusy,
            submit: submit
        )
        .onChange(of: model.code) { _, code in codeChanged(code) }

        StudentHubPrimaryButton(
            title: String(localized: "auth.twoFactorSetup.enable", defaultValue: "Включить"),
            isLoading: model.isBusy,
            action: submit
        )
        .onChange(of: model.isBusy) { _, busy in
            if busy { isCodeFocused = false }
        }
    }

    /// Ключ группами по четыре — так его проще сверить при вводе вручную.
    private var secretRow: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(String(localized: "settings.2fa.secret", defaultValue: "Ключ"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                Text(verbatim: Self.grouped(setup.secret))
                    .font(.system(.callout, design: .monospaced))
                    .foregroundStyle(Palette.foreground)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                UIPasteboard.general.string = setup.secret
                copied = true
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(copied ? Palette.success : Palette.primary)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "auth.twoFactorSetup.copyKey", defaultValue: "Скопировать ключ")))
            .sensoryFeedback(.success, trigger: copied) { _, new in new }
        }
        .padding(.leading, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .padding(.trailing, Spacing.xs)
        .background(AuthPalette.field, in: RoundedRectangle(cornerRadius: AuthMetrics.fieldRadius, style: .continuous))
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            copied = false
        }
    }

    static func grouped(_ secret: String) -> String {
        stride(from: 0, to: secret.count, by: 4)
            .map { start -> String in
                let from = secret.index(secret.startIndex, offsetBy: start)
                let to = secret.index(from, offsetBy: 4, limitedBy: secret.endIndex) ?? secret.endIndex
                return String(secret[from..<to])
            }
            .joined(separator: " ")
    }

    /// В поле — только цифры и не больше ячеек; полный код уходит сам, как на входе.
    private func codeChanged(_ code: String) {
        model.clearCodeError()
        let digits = String(code.filter { $0.isASCII && $0.isNumber }.prefix(TwoFactorSetupGateModel.codeLength))
        guard digits == code else {
            model.code = digits
            return
        }
        if digits.count < TwoFactorSetupGateModel.codeLength {
            autoSubmitted = nil
        } else if digits != autoSubmitted, !model.isBusy {
            autoSubmitted = digits
            submit()
        }
    }

    private func submit() {
        Task {
            await model.enable()
            if model.codeError != nil { isCodeFocused = true }
        }
    }
}

/// Резервные коды: показываются один раз, поэтому рядом — «Сохранить» и «Скопировать».
private struct TwoFactorBackupCodesPanel: View {
    let model: TwoFactorSetupGateModel
    let codes: [String]

    @State private var copied = false

    var body: some View {
        AuthPanelTitle(
            title: String(localized: "auth.twoFactorSetup.codesTitle", defaultValue: "Сохраните резервные коды"),
            subtitle: String(
                localized: "auth.twoFactorSetup.codesHint",
                defaultValue: "Каждый код одноразовый. Храните их в надёжном месте — они помогут войти без телефона."
            )
        )

        AuthFormError(message: model.formError, isOffline: model.formErrorIsOffline) {
            Task { await model.finish() }
        }

        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: Spacing.md) {
            ForEach(codes, id: \.self) { code in
                Text(verbatim: code)
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(Palette.foreground)
                    .tracking(1.5)
            }
        }
        .textSelection(.enabled)
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity)
        .background(AuthPalette.field, in: RoundedRectangle(cornerRadius: AuthMetrics.fieldRadius, style: .continuous))

        HStack(spacing: Spacing.md) {
            ShareLink(item: codes.joined(separator: "\n")) {
                Label(String(localized: "settings.2fa.saveCodes", defaultValue: "Сохранить коды"), systemImage: "square.and.arrow.up")
            }
            .buttonStyle(QuietButtonStyle())

            Button {
                UIPasteboard.general.string = codes.joined(separator: "\n")
                copied = true
            } label: {
                Label(
                    copied
                        ? String(localized: "auth.twoFactorSetup.copied", defaultValue: "Скопировано")
                        : String(localized: "common.copy", defaultValue: "Скопировать"),
                    systemImage: copied ? "checkmark" : "doc.on.doc"
                )
            }
            .buttonStyle(QuietButtonStyle())
            .sensoryFeedback(.success, trigger: copied) { _, new in new }
        }

        StudentHubPrimaryButton(
            title: String(localized: "auth.twoFactorSetup.continue", defaultValue: "Продолжить"),
            isLoading: model.isBusy
        ) {
            Task { await model.finish() }
        }
    }
}
