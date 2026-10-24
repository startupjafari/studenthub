import Observation
import SwiftUI

/// Повторное согласие на обработку персональных данных (PERSONAL_DATA, PROJECT §7.2).
///
/// То же, что окно `ConsentGate` в вебе: если сервер говорит, что согласие больше не
/// подходит (новая редакция документов или сменилось основание по возрасту), приложение
/// закрывается этим экраном, пока согласие не примут заново или не выйдут.
@Observable
final class ConsentGateModel {
    private(set) var state: ConsentStateDTO?
    var consent = false
    var guardianConsent = false
    var birthDate = Calendar.current.date(byAdding: .year, value: -18, to: Date()) ?? Date()
    private(set) var isSaving = false
    private(set) var failure: String?

    private let api: ConsentChecking

    init(api: ConsentChecking = ConsentAPI()) {
        self.api = api
    }

    var isRequired: Bool { state?.required == true }

    /// Галочка представителя: по дате из профиля или по только что введённой.
    var needsGuardian: Bool {
        guard let state else { return false }
        return state.guardianRequired || (state.birthDateRequired && !Self.isAdult(birthDate))
    }

    /// Сбой проверки экрана не закрывает: не узнали — не мешаем, сервер всё равно
    /// проверит согласие сам там, где оно нужно.
    @MainActor
    func load() async {
        if let fresh = try? await api.state() { state = fresh }
    }

    @MainActor
    func accept() async {
        guard let state, !isSaving else { return }
        guard consent else {
            failure = String(localized: "consent.required", defaultValue: "Без согласия продолжить нельзя")
            return
        }
        let guardian = needsGuardian
        if guardian, !guardianConsent {
            failure = String(
                localized: "consent.guardianRequired",
                defaultValue: "Нужно согласие законного представителя"
            )
            return
        }
        isSaving = true
        defer { isSaving = false }
        do {
            self.state = try await api.accept(
                guardianConsent: guardian ? true : nil,
                birthDate: state.birthDateRequired ? Self.day(birthDate) : nil
            )
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }

    static func isAdult(_ birthDate: Date, now: Date = Date(), calendar: Calendar = .current) -> Bool {
        (calendar.dateComponents([.year], from: birthDate, to: now).year ?? 0) >= 18
    }

    /// «ГГГГ-ММ-ДД», как ждёт `AcceptConsentSchema`.
    static func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

/// Неотменяемый экран согласия: принять или выйти.
struct ConsentGateView: View {
    @Bindable var model: ConsentGateModel
    let session: AppSessionModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                Image(systemName: "checkmark.shield")
                    .font(.system(size: 36))
                    .foregroundStyle(Palette.primary)
                    .accessibilityHidden(true)

                Text(title)
                    .font(Typography.sectionTitle)
                    .foregroundStyle(Palette.foreground)

                Text(description)
                    .font(Typography.body)
                    .foregroundStyle(Palette.mutedForeground)

                if model.state?.birthDateRequired == true {
                    DatePicker(
                        selection: $model.birthDate,
                        in: ...Date(),
                        displayedComponents: .date
                    ) {
                        Text(String(localized: "consent.birthDate", defaultValue: "Дата рождения"))
                    }
                }

                Toggle(isOn: $model.consent) {
                    Text(String(
                        localized: "consent.agree",
                        defaultValue: "Я принимаю политику конфиденциальности и пользовательское соглашение"
                    ))
                    .font(Typography.body)
                }

                if model.needsGuardian {
                    Toggle(isOn: $model.guardianConsent) {
                        Text(String(
                            localized: "consent.guardian",
                            defaultValue: """
                                Мне нет 18 лет, и мой законный представитель дал согласие на \
                                обработку моих персональных данных
                                """
                        ))
                        .font(Typography.body)
                    }
                }

                if let failure = model.failure {
                    FormAlert(message: failure)
                }

                Button {
                    Task { await model.accept() }
                } label: {
                    Text(String(localized: "consent.accept", defaultValue: "Принять"))
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.isSaving)

                Button {
                    Task { await session.signOut() }
                } label: {
                    Text(String(localized: "session.signOut", defaultValue: "Выйти"))
                }
                .buttonStyle(QuietButtonStyle())
                .disabled(model.isSaving)
            }
            .padding(Spacing.xl)
        }
        .background(Palette.background)
        .interactiveDismissDisabled()
    }

    private var title: String {
        model.state?.reason == "VERSION"
            ? String(localized: "consent.versionTitle", defaultValue: "Обновились правовые документы")
            : String(localized: "consent.ageTitle", defaultValue: "Подтвердите согласие")
    }

    private var description: String {
        if model.state?.reason == "VERSION" {
            return String(
                localized: "consent.versionText",
                defaultValue: """
                    Мы обновили политику конфиденциальности и пользовательское соглашение. \
                    Чтобы продолжить работу на платформе, ознакомьтесь с новой редакцией и примите её.
                    """
            )
        }
        if model.state?.guardianRequired == true {
            return String(
                localized: "consent.minorText",
                defaultValue: """
                    По дате рождения в профиле вам нет 18 лет. За несовершеннолетнего согласие \
                    на обработку персональных данных даёт законный представитель — подтвердите его.
                    """
            )
        }
        return String(
            localized: "consent.adultText",
            defaultValue: """
                По дате рождения в профиле вам уже исполнилось 18, а согласие на обработку \
                персональных данных давал законный представитель. Подтвердите его от своего имени.
                """
        )
    }
}
