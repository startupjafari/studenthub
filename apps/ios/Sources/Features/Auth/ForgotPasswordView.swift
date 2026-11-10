import Observation
import SwiftUI

/// Восстановление пароля: адрес → письмо со ссылкой на новый пароль.
///
/// Сервер отвечает одинаково для любого адреса и не говорит, зарегистрирован ли он
/// (`POST /auth/password/forgot` — 202 всегда), поэтому и подтверждение условное: «если
/// адрес зарегистрирован, письмо ушло». Новый пароль задаётся по ссылке из письма.
@MainActor
@Observable
final class ForgotPasswordModel {
    enum Phase: Equatable {
        case form
        case sent(email: String)
    }

    var email = ""
    private(set) var phase: Phase = .form
    private(set) var isSending = false
    private(set) var emailError: String?
    private(set) var formError: String?
    private(set) var formErrorIsOffline = false
    /// До какого момента повторная отправка закрыта. Сервер пускает три письма в
    /// четверть часа; минута между попытками — чтобы не сжечь их подряд.
    private(set) var resendAvailableAt: Date?

    private let api: AuthRecovering
    private let resendDelay: TimeInterval

    init(api: AuthRecovering = AuthRecoveryAPI(), resendDelay: TimeInterval = 60) {
        self.api = api
        self.resendDelay = resendDelay
    }

    /// Адрес в той же форме, что проверяет сервер: без пробелов, в нижнем регистре.
    var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    func send() async {
        guard !isSending else { return }
        formError = nil
        formErrorIsOffline = false
        let address = normalizedEmail
        guard Self.isValidEmail(address) else {
            emailError = address.isEmpty
                ? String(localized: "auth.emailRequired", defaultValue: "Укажите email")
                : String(localized: "auth.emailInvalid", defaultValue: "Введите корректный email")
            return
        }
        emailError = nil
        isSending = true
        defer { isSending = false }
        do {
            try await api.requestPasswordReset(email: address)
            phase = .sent(email: address)
            resendAvailableAt = Date().addingTimeInterval(resendDelay)
        } catch let error as APIError where error.code == .validationError {
            emailError = String(localized: "auth.emailInvalid", defaultValue: "Введите корректный email")
        } catch {
            formError = error.userMessage
            formErrorIsOffline = error.isOffline
        }
    }

    /// Ввести другой адрес.
    func editAddress() {
        phase = .form
        formError = nil
    }

    /// Проверка формы до запроса — та же граница, что у `ForgotPasswordSchema`: адрес
    /// с «@» и доменом с точкой, не длиннее 160 символов. Окончательно решает сервер.
    static func isValidEmail(_ value: String) -> Bool {
        guard value.count <= 160, !value.contains(" ") else { return false }
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return false }
        let domain = parts[1]
        guard let dot = domain.lastIndex(of: "."), dot != domain.startIndex else { return false }
        return domain.distance(from: dot, to: domain.endIndex) > 2
    }
}

struct ForgotPasswordView: View {
    /// Адрес, уже набранный на экране входа, — если это почта, а не логин.
    var prefill: String = ""

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model = ForgotPasswordModel()
    @FocusState private var isEmailFocused: Bool

    var body: some View {
        AuthScaffold {
            StudentHubBrandHeader(
                title: String(localized: "auth.forgotTitle", defaultValue: "Восстановление пароля"),
                subtitle: String(
                    localized: "auth.forgot.description",
                    defaultValue: "Укажите email вашей учётной записи — мы пришлём ссылку для создания нового пароля."
                ),
                subtitleIsEssential: true
            )
        } panel: {
            switch model.phase {
            case .form:
                form
            case .sent(let email):
                sent(email)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .animation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion), value: model.phase)
        .onAppear {
            if model.email.isEmpty, prefill.contains("@") { model.email = prefill }
        }
    }

    @ViewBuilder
    private var form: some View {
        AuthFormError(message: model.formError, isOffline: model.formErrorIsOffline, retry: submit)

        StudentHubField(
            label: nil,
            error: model.emailError,
            isFocused: isEmailFocused,
            focus: { isEmailFocused = true }
        ) {
            TextField(text: $model.email, prompt: Text(String(localized: "auth.email", defaultValue: "Email"))) {
                Text(String(localized: "auth.email", defaultValue: "Email"))
            }
            .textContentType(.emailAddress)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.send)
            .focused($isEmailFocused)
            .onSubmit(submit)
        }

        StudentHubPrimaryButton(
            title: model.isSending
                ? String(localized: "auth.forgot.sending", defaultValue: "Отправляем…")
                : String(localized: "auth.forgotSubmit", defaultValue: "Прислать ссылку"),
            isLoading: model.isSending,
            action: submit
        )

        AuthTextLink(title: String(localized: "auth.backToLogin", defaultValue: "Вернуться ко входу")) {
            dismiss()
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func sent(_ email: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Image(systemName: "envelope.badge")
                .font(.system(size: 34))
                .foregroundStyle(Palette.primary)
                .symbolRenderingMode(.hierarchical)
                .accessibilityHidden(true)
            AuthPanelTitle(
                title: String(localized: "auth.forgotSentTitle", defaultValue: "Проверьте почту"),
                subtitle: String(
                    localized: "auth.forgotSentText",
                    defaultValue: "Если \(email) зарегистрирован на платформе, мы отправили на него ссылку. Она действует час."
                )
            )
        }

        AuthFormError(message: model.formError, isOffline: model.formErrorIsOffline) {
            Task { await model.send() }
        }

        TimelineView(.periodic(from: .now, by: 1)) { context in
            let left = max(0, Int((model.resendAvailableAt ?? .distantPast).timeIntervalSince(context.date).rounded(.up)))
            StudentHubSecondaryButton(
                title: left > 0
                    ? String(localized: "auth.forgot.resendIn", defaultValue: "Отправить ещё раз через \(DisplayFormat.minutesSeconds(left))")
                    : String(localized: "auth.forgot.resend", defaultValue: "Отправить ещё раз"),
                systemImage: "arrow.clockwise"
            ) {
                Task { await model.send() }
            }
            .disabled(left > 0 || model.isSending)
        }

        HStack {
            AuthTextLink(title: String(localized: "auth.forgot.otherEmail", defaultValue: "Другой адрес")) {
                model.editAddress()
            }
            Spacer(minLength: Spacing.md)
            AuthTextLink(title: String(localized: "auth.backToLogin", defaultValue: "Вернуться ко входу")) {
                dismiss()
            }
        }
    }

    private func submit() {
        isEmailFocused = false
        Task { await model.send() }
    }
}
