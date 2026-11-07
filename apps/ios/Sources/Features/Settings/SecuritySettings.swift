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
            .listRowBackground(Palette.card)

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
            .listRowBackground(Palette.card)
        }
        .scrollContentBackground(.hidden)
        .background(Palette.background)
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
                .listRowBackground(Palette.card)
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
                .listRowBackground(Palette.card)
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(Text(String(localized: "settings.password", defaultValue: "Сменить пароль")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "common.cancel", defaultValue: "Отмена")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "common.save", defaultValue: "Сохранить")) {
                        Task { await save() }
                    }
                    .disabled(!canSave)
                }
            }
        }
    }

    @MainActor
    private func save() async {
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
    @State private var isWorking = false

    private let api: AccountFetching = AccountAPI()

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
                    .listRowBackground(Palette.card)
                } else {
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
                        .listRowBackground(Palette.card)
                    }
                    Section {
                        TextField(String(localized: "settings.2fa.code", defaultValue: "Код"), text: $code)
                            .keyboardType(flow == .enable ? .numberPad : .asciiCapable)
                            .textContentType(.oneTimeCode)
                            .font(.system(.body, design: .monospaced))
                    } footer: {
                        if flow != .enable {
                            Text(String(
                                localized: "settings.2fa.codeFooter",
                                defaultValue: "Код из приложения-аутентификатора или резервный код."
                            ))
                        }
                    }
                    .listRowBackground(Palette.card)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(backupCodes == nil
                        ? String(localized: "common.cancel", defaultValue: "Отмена")
                        : String(localized: "common.done", defaultValue: "Готово")) { dismiss() }
                }
                if backupCodes == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "common.confirm", defaultValue: "Подтвердить")) {
                            Task { await confirm() }
                        }
                        .disabled(code.trimmingCharacters(in: .whitespaces).count < 6 || isWorking)
                    }
                }
            }
            .task {
                guard flow == .enable, setup == nil else { return }
                do {
                    setup = try await api.setupTwoFactor()
                } catch {
                    failure = error.userMessage
                }
            }
        }
    }

    private var title: String {
        switch flow {
        case .enable: return String(localized: "settings.2fa.enable", defaultValue: "Включить двухфакторную защиту")
        case .disable: return String(localized: "settings.2fa.disable", defaultValue: "Отключить")
        case .backupCodes: return String(localized: "settings.2fa.backupCodes", defaultValue: "Новые резервные коды")
        }
    }

    @MainActor
    private func confirm() async {
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
