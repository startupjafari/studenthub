import SwiftUI

/// Безопасность: пароль и двухфакторная защита.
///
/// Списка сессий здесь нет, и это не упущение экрана: у API нет маршрута ни для
/// списка устройств, ни для завершения отдельной сессии (в вебе его тоже нет). Выйти
/// везде можно сменой пароля — сервер гасит все сессии, и экран это прямо говорит.
struct SecuritySettingsView: View {
    let session: AppSessionModel

    @Environment(ViewerProfileModel.self) private var viewer
    @State private var changingPassword = false
    @State private var twoFactorFlow: TwoFactorFlow?

    var body: some View {
        Form {
            Section {
                Button {
                    changingPassword = true
                } label: {
                    IconRow(
                        title: String(localized: "settings.password", defaultValue: "Сменить пароль"),
                        symbol: "key",
                        tint: TileTint.orange
                    )
                }
                .buttonStyle(.plain)
            } footer: {
                Text(String(
                    localized: "settings.password.footer",
                    defaultValue: "После смены пароля вы выйдете на всех устройствах, включая этот."
                ))
            }

            Section {
                if viewer.profile?.twoFactorEnabled == true {
                    Label(
                        String(localized: "settings.2fa.enabled", defaultValue: "Двухфакторная защита включена"),
                        systemImage: "checkmark.shield.fill"
                    )
                    .foregroundStyle(Palette.success)
                    Button(String(localized: "settings.2fa.backupCodes", defaultValue: "Новые резервные коды")) {
                        twoFactorFlow = .backupCodes
                    }
                    Button(String(localized: "settings.2fa.disable", defaultValue: "Отключить"), role: .destructive) {
                        twoFactorFlow = .disable
                    }
                } else {
                    Button {
                        twoFactorFlow = .enable
                    } label: {
                        IconRow(
                            title: String(localized: "settings.2fa.enable", defaultValue: "Включить двухфакторную защиту"),
                            symbol: "lock.shield",
                            tint: TileTint.green
                        )
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                Text(String(localized: "settings.2fa", defaultValue: "Двухфакторная защита"))
            } footer: {
                Text(String(
                    localized: "settings.2fa.footer",
                    defaultValue: "При входе кроме пароля понадобится код из приложения-аутентификатора."
                ))
            }
        }
        .settingsFormLayout()
        .softTopEdge()
        .navigationTitle(Text(String(localized: "settings.security", defaultValue: "Безопасность")))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $changingPassword) {
            ChangePasswordView(session: session)
        }
        .sheet(item: $twoFactorFlow, onDismiss: { Task { await viewer.refresh() } }) { flow in
            TwoFactorView(flow: flow)
        }
    }
}

// MARK: - Пароль

private struct ChangePasswordView: View {
    let session: AppSessionModel

    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var new = ""
    @State private var repeated = ""
    @State private var failure: String?
    @State private var isSaving = false

    private var mismatch: Bool { !repeated.isEmpty && new != repeated }
    private var canSave: Bool { !current.isEmpty && new.count >= 8 && new == repeated && !isSaving }

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure).listRowBackground(Color.clear)
                }
                Section {
                    SecureField(String(localized: "settings.password.current", defaultValue: "Текущий пароль"), text: $current)
                        .textContentType(.password)
                }
                Section {
                    SecureField(String(localized: "settings.password.new", defaultValue: "Новый пароль"), text: $new)
                        .textContentType(.newPassword)
                    SecureField(String(localized: "settings.password.repeat", defaultValue: "Повторите пароль"), text: $repeated)
                        .textContentType(.newPassword)
                } footer: {
                    if mismatch {
                        FieldError(message: String(localized: "settings.password.mismatch", defaultValue: "Пароли не совпадают"))
                    } else {
                        Text(String(localized: "settings.password.rule", defaultValue: "Не короче 8 символов: буква, цифра и спецсимвол"))
                    }
                }
            }
            .settingsFormLayout()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(Text(String(localized: "settings.password", defaultValue: "Сменить пароль")))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(String(localized: "common.save", defaultValue: "Сохранить")) {
                            Task { await save() }
                        }
                        .disabled(!canSave)
                    }
                }
            }
        }
    }

    @MainActor
    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await AccountAPI().changePassword(current: current, new: new)
            // Сервер погасил все сессии, и эту тоже: остаться «внутри» с мёртвым
            // токеном хуже, чем сразу показать вход.
            dismiss()
            await session.signOut()
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Двухфакторная защита

enum TwoFactorFlow: String, Identifiable {
    case enable
    case disable
    case backupCodes

    var id: String { rawValue }
}

private struct TwoFactorView: View {
    let flow: TwoFactorFlow

    @Environment(\.dismiss) private var dismiss
    @State private var setup: TwoFactorSetupDTO?
    @State private var code = ""
    @State private var backupCodes: [String]?
    @State private var failure: String?
    /// Ключ для приложения-аутентификатора не пришёл: без него вводить код не из чего.
    @State private var setupFailure: String?
    @State private var setupOffline = false
    @State private var isWorking = false
    /// Высота листа. Для одного поля кода хватает половины экрана — на весь экран лист
    /// был пустой тёмной простынёй. Включению нужен QR, а выданным кодам — список из
    /// десяти строк: там лист раскрывается целиком.
    @State private var detent: PresentationDetent
    @FocusState private var codeFocused: Bool

    private let api: AccountFetching = AccountAPI()

    init(flow: TwoFactorFlow) {
        self.flow = flow
        _detent = State(initialValue: flow == .enable ? .large : .medium)
    }

    private var canConfirm: Bool {
        code.trimmingCharacters(in: .whitespaces).count >= 6 && !isWorking
    }

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure).listRowBackground(Color.clear)
                }
                if let backupCodes {
                    Section {
                        ForEach(backupCodes, id: \.self) { code in
                            Text(verbatim: code)
                                .font(.system(.body, design: .monospaced))
                                .textSelection(.enabled)
                        }
                        ShareLink(item: backupCodes.joined(separator: "\n")) {
                            Label(String(localized: "settings.2fa.saveCodes", defaultValue: "Сохранить коды"), systemImage: "square.and.arrow.up")
                        }
                    } header: {
                        Text(String(localized: "settings.2fa.codesTitle", defaultValue: "Резервные коды"))
                    } footer: {
                        Text(String(
                            localized: "settings.2fa.codesFooter",
                            defaultValue: "Каждый код срабатывает один раз. Сохраните их: больше они не покажутся."
                        ))
                    }
                } else if flow != .enable || setup != nil {
                    if flow == .enable, let setup {
                        Section {
                            if let image = Self.image(fromDataURL: setup.qr) {
                                Image(uiImage: image)
                                    .interpolation(.none)
                                    .resizable()
                                    .scaledToFit()
                                    .frame(maxWidth: 220)
                                    .frame(maxWidth: .infinity)
                                    .accessibilityLabel(Text(String(localized: "settings.2fa.qr", defaultValue: "QR-код для приложения-аутентификатора")))
                            }
                            if let url = URL(string: setup.otpauthUrl) {
                                Link(destination: url) {
                                    Label(
                                        String(localized: "settings.2fa.openApp", defaultValue: "Открыть в приложении-аутентификаторе"),
                                        systemImage: "arrow.up.forward.app"
                                    )
                                }
                            }
                            LabeledContent(String(localized: "settings.2fa.secret", defaultValue: "Ключ")) {
                                Text(verbatim: setup.secret)
                                    .font(.system(.footnote, design: .monospaced))
                                    .textSelection(.enabled)
                            }
                        } footer: {
                            Text(String(
                                localized: "settings.2fa.setupFooter",
                                defaultValue: "Отсканируйте код или добавьте ключ вручную, затем введите шесть цифр из приложения."
                            ))
                        }
                    }
                    Section {
                        // При включении годится только код из приложения — цифровая
                        // клавиатура. Дальше подходит и резервный: 8 знаков 0–9 и A–F,
                        // поэтому нужны буквы; сервер сам приводит регистр и убирает
                        // пробелы, заглавные — чтобы набранное совпадало с бумажкой.
                        TextField(String(localized: "settings.2fa.code", defaultValue: "Код"), text: $code)
                            .keyboardType(flow == .enable ? .numberPad : .asciiCapable)
                            .textContentType(.oneTimeCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .submitLabel(.done)
                            .focused($codeFocused)
                            .onSubmit {
                                guard canConfirm else { return }
                                Task { await confirm() }
                            }
                            .font(.system(.body, design: .monospaced))
                    } footer: {
                        if flow != .enable {
                            Text(String(
                                localized: "settings.2fa.codeFooter",
                                defaultValue: "Код из приложения-аутентификатора или резервный код."
                            ))
                        }
                    }
                }
            }
            .settingsFormLayout()
            .scrollDismissesKeyboard(.interactively)
            // Ключ для включения ещё грузится или не пришёл — состояние по центру листа.
            .screenState(flow == .enable && setup == nil && backupCodes == nil) {
                if let setupFailure {
                    ErrorStateView(message: setupFailure, isOffline: setupOffline) { await loadSetup() }
                } else {
                    LoadingStateView()
                }
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            // Выданные коды больше не покажутся: случайный жест вниз не должен их стереть.
            // Лист закрывает только «Готово».
            .interactiveDismissDisabled(isWorking || backupCodes != nil)
            .toolbar {
                // Отмена — крестиком, подтверждение — галочкой: два слова в стеклянных
                // капсулах съедали панель, и заголовок обрезался до «Новые ре…».
                if backupCodes == nil {
                    ToolbarItem(placement: .cancellationAction) {
                        SheetCloseButton { dismiss() }
                            .disabled(isWorking)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        if isWorking {
                            ProgressView()
                        } else {
                            TwoFactorConfirmButton(
                                title: String(localized: "common.confirm", defaultValue: "Подтвердить")
                            ) {
                                Task { await confirm() }
                            }
                            .disabled(!canConfirm)
                        }
                    }
                }
                if backupCodes != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        TwoFactorConfirmButton(title: String(localized: "common.done", defaultValue: "Готово")) {
                            dismiss()
                        }
                    }
                }
            }
            .task {
                guard flow == .enable, setup == nil else { return }
                await loadSetup()
            }
            .onAppear {
                // Отключение и новые коды — одно поле, его и ждут: клавиатура сразу.
                // При включении сначала QR — клавиатура закрыла бы его.
                if flow != .enable { codeFocused = true }
            }
            .onChange(of: backupCodes) { _, codes in
                guard codes != nil else { return }
                codeFocused = false
                detent = .large
            }
        }
        .presentationDetents(flow == .enable ? [.large] : [.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
    }

    @MainActor
    private func loadSetup() async {
        do {
            setup = try await api.setupTwoFactor()
            setupFailure = nil
        } catch is CancellationError {
            return
        } catch {
            setupFailure = error.userMessage
            setupOffline = error.isOffline
        }
    }

    private var title: String {
        switch flow {
        // Короткие заголовки: «Включить двухфакторную защиту» и голое «Отключить» в
        // панели листа то обрезались, то не говорили, что именно отключаем.
        case .enable: return String(localized: "settings.2fa", defaultValue: "Двухфакторная защита")
        case .disable: return String(localized: "settings.2fa.disableTitle", defaultValue: "Отключить 2FA")
        case .backupCodes: return String(localized: "settings.2fa.backupCodes", defaultValue: "Новые резервные коды")
        }
    }

    @MainActor
    private func confirm() async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        let code = code.trimmingCharacters(in: .whitespaces)
        do {
            switch flow {
            case .enable:
                backupCodes = try await api.enableTwoFactor(code: code).backupCodes
            case .backupCodes:
                backupCodes = try await api.regenerateBackupCodes(code: code).backupCodes
            case .disable:
                try await api.disableTwoFactor(code: code)
                dismiss()
            }
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    /// `qr` приходит картинкой в `data:` URL — показываем как есть, без своей генерации.
    static func image(fromDataURL string: String?) -> UIImage? {
        guard let string, let comma = string.firstIndex(of: ",") else { return nil }
        guard let data = Data(base64Encoded: String(string[string.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }
}

/// Подтверждение в панели листа 2FA: на iOS 26 — системная галочка в синем стекле
/// (`role: .confirm`), раньше — та же галочка значком. Слово в капсуле не помещалось
/// рядом с заголовком листа.
private struct TwoFactorConfirmButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                Button(role: .confirm, action: action)
                    .accessibilityLabel(Text(title))
            } else {
                legacy
            }
        #else
            legacy
        #endif
    }

    private var legacy: some View {
        Button(action: action) {
            Image(systemName: "checkmark")
                .fontWeight(.semibold)
        }
        .accessibilityLabel(Text(title))
    }
}
