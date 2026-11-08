import SwiftUI

// StudentHub Native — экраны до входа: вход, QR-вход, восстановление пароля.
//
// Компоновка одна на все три: сверху — фирменная шапка на тёмно-синем фоне, снизу —
// панель с формой, как лист iOS. Форма у нижнего края ближе к большому пальцу, а шапка
// без картинок оставляет экрану воздух. Стекло — только у кнопок (Glass.swift): поля и
// тексты лежат на непрозрачной панели и читаются в любой теме.

// MARK: - Цвета

/// Фирменные цвета экранов до входа. Шапка тёмно-синяя в обеих темах — это лицо продукта,
/// как у веба; панель с формой следует теме системы.
enum AuthPalette {
    /// Midnight Navy `#07152F` — верх фона.
    static let navy = Color(red: 7 / 255, green: 21 / 255, blue: 47 / 255)
    /// `#0D1117` — низ фона.
    static let night = Color(red: 13 / 255, green: 17 / 255, blue: 23 / 255)
    /// Primary Blue `#2D73E5` — плашка знака.
    static let brandBlue = Color(red: 45 / 255, green: 115 / 255, blue: 229 / 255)
    /// Accent Blue `#1677FF` — едва заметный отсвет в углу фона.
    static let accentBlue = Color(red: 22 / 255, green: 119 / 255, blue: 255 / 255)
    /// Text Secondary `#A9BCD6` — подзаголовок на тёмно-синем.
    static let headerSecondary = Color(red: 169 / 255, green: 188 / 255, blue: 214 / 255)
    static let headerPrimary = Color.white

    /// Панель с формой: в светлой теме — системный белый, в тёмной — Surface `#151B27`,
    /// на тон светлее фона, чтобы панель отделялась без рамки и тени.
    static let panel = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 21 / 255, green: 27 / 255, blue: 39 / 255, alpha: 1)
            : .systemBackground
    })

    /// Заливка поля ввода на панели.
    static let field = Color(uiColor: .tertiarySystemFill)
}

// MARK: - Фон

/// Тёмно-синий фон с одним мягким отсветом. Без картинок и неона: отсвет — радиальный
/// градиент, а не размытие, и занимает угол, а не центр.
struct AuthBackdrop: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [AuthPalette.navy, AuthPalette.night], startPoint: .top, endPoint: .bottom)
            RadialGradient(
                colors: [AuthPalette.accentBlue.opacity(0.28), .clear],
                center: .topTrailing,
                startRadius: 0,
                endRadius: 420
            )
            // Под полосой «Домой» — цвет панели: панель продолжается до края, без тёмной
            // щели. Полоса ниже любой панели — иначе она закрыла бы её верхние скругления.
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                AuthPalette.panel.frame(height: 60)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

// MARK: - Знак

/// Знак StudentHub — академическая шапочка, тот же рисунок, что в QR и документах
/// сервера (`common/brand/brand-mark.ts`): ромб, тулья, кисточка в сетке 24×24.
struct StudentHubGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        let ox = rect.midX - 12 * s
        let oy = rect.midY - 12 * s
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }

        var path = Path()
        // Ромб-верх.
        path.move(to: p(12, 3.4))
        path.addLine(to: p(22.6, 8.6))
        path.addLine(to: p(12, 13.8))
        path.addLine(to: p(1.4, 8.6))
        path.closeSubpath()
        // Тулья.
        path.move(to: p(6.4, 11.4))
        path.addLine(to: p(6.4, 15.3))
        path.addCurve(to: p(12, 18.1), control1: p(6.4, 16.9), control2: p(8.9, 18.1))
        path.addCurve(to: p(17.6, 15.3), control1: p(15.1, 18.1), control2: p(17.6, 16.9))
        path.addLine(to: p(17.6, 11.4))
        path.addLine(to: p(12, 14.2))
        path.closeSubpath()
        // Кисточка.
        path.addRoundedRect(
            in: CGRect(origin: p(20.4, 9.4), size: CGSize(width: 1.5 * s, height: 5 * s)),
            cornerSize: CGSize(width: 0.75 * s, height: 0.75 * s)
        )
        path.addEllipse(in: CGRect(origin: p(21.15 - 1.35, 15.4 - 1.35), size: CGSize(width: 2.7 * s, height: 2.7 * s)))
        return path
    }
}

/// Знак на синей скруглённой плашке — как иконка приложения.
struct StudentHubLogo: View {
    var size: CGFloat = 44

    var body: some View {
        StudentHubGlyph()
            .fill(.white)
            .padding(size * 0.2)
            .frame(width: size, height: size)
            .background(AuthPalette.brandBlue, in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
            .accessibilityHidden(true)
    }
}

// MARK: - Шапка

/// Фирменная шапка экранов до входа: знак и название, затем заголовок и подзаголовок.
/// Заголовок — крупный и жирный, как большие заголовки iOS; растёт с Dynamic Type.
struct StudentHubBrandHeader: View {
    var title: String
    var subtitle: String?
    /// На вложенных экранах (QR, восстановление) знак без названия: название уже было.
    var showsWordmark = true
    /// Подзаголовок — инструкция, без которой экран непонятен: на низком экране он
    /// остаётся, а прячется знак.
    var subtitleIsEssential = false
    /// Знак над заголовком. На экране QR его нет: место отдано коду.
    var showsLogo = true

    @Environment(\.authIsCompact) private var isCompact

    var body: some View {
        VStack(alignment: .leading, spacing: isCompact ? Spacing.md : Spacing.xl) {
            if showsLogo && !(isCompact && subtitleIsEssential) {
            HStack(spacing: Spacing.md) {
                StudentHubLogo(size: isCompact ? 32 : 40)
                if showsWordmark {
                    Text(verbatim: "StudentHub")
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .foregroundStyle(AuthPalette.headerPrimary)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: "StudentHub"))
            }

            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(title)
                    .font(.system(isCompact ? .title2 : .title, weight: .bold))
                    .foregroundStyle(AuthPalette.headerPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                // На низком экране подзаголовок уступает место форме.
                if let subtitle, !isCompact || subtitleIsEssential {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(AuthPalette.headerSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Каркас экрана

private struct AuthCompactKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Экран низкий (iPhone SE, mini, клавиатура открыта): шапка сжимается, чтобы форма
    /// помещалась без прокрутки.
    var authIsCompact: Bool {
        get { self[AuthCompactKey.self] }
        set { self[AuthCompactKey.self] = newValue }
    }
}

/// Шапка сверху, панель с формой снизу. Высота не задаётся: на высоком экране между
/// ними свободное место, на низком (или с клавиатурой) экран прокручивается, и поле в
/// фокусе остаётся видимым. Ширина ограничена — на iPhone Pro Max форма не растягивается.
struct AuthScaffold<Header: View, Panel: View>: View {
    @ViewBuilder var header: () -> Header
    @ViewBuilder var panel: () -> Panel

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    header()
                        .padding(.horizontal, Spacing.xxl)
                        .padding(.top, Spacing.md)
                        .padding(.bottom, Spacing.xl)
                    Spacer(minLength: 0)
                    AuthBottomPanel(content: panel)
                }
                .environment(\.authIsCompact, proxy.size.height < 650)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .top)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
        .background(AuthBackdrop())
        // Белый статус-бар и стрелка «назад» на тёмно-синем фоне — в обеих темах; у верхнего
        // края шапка при прокрутке мягко размывается (iOS 26).
        .toolbarColorScheme(.dark, for: .navigationBar)
        .softTopEdge()
    }
}

/// Нижняя панель с формой: крупные скругления сверху, как у листа iOS 26, низ уходит
/// под полосу «Домой» (её закрывает фон того же цвета, `AuthBackdrop`).
struct AuthBottomPanel<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg, content: content)
            .padding(.horizontal, Spacing.xxl)
            .padding(.top, Spacing.xxl)
            .padding(.bottom, Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                AuthPalette.panel,
                in: UnevenRoundedRectangle(topLeadingRadius: 34, topTrailingRadius: 34, style: .continuous)
            )
    }
}

/// Заголовок панели: «Вход в аккаунт» и подпись под ним.
struct AuthPanelTitle: View {
    let title: String
    var subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(title)
                .font(.system(.title2, weight: .bold))
                .foregroundStyle(Palette.foreground)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Поля

/// Поле формы: подпись, само поле на мягкой заливке и ошибка под ним. Рамки нет —
/// только у поля в фокусе (тонкая, фирменного цвета) и у поля с ошибкой (красная).
struct StudentHubField<Field: View, Accessory: View>: View {
    /// Подпись над полем. `nil` — без подписи: смысл поля несёт подсказка внутри, а
    /// VoiceOver читает ярлык самого поля.
    let label: String?
    var error: String?
    var isFocused = false
    @ViewBuilder var field: () -> Field
    @ViewBuilder var accessory: () -> Accessory

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let label {
                Text(label)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Palette.mutedForeground)
                    .accessibilityHidden(true)
            }
            HStack(spacing: Spacing.md) {
                field()
                    .font(.body)
                    .foregroundStyle(Palette.foreground)
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                accessory()
            }
            .padding(.horizontal, Spacing.xl)
            .background(AuthPalette.field, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(borderColor, lineWidth: error == nil && !isFocused ? 0 : 1.5)
            )
            FieldError(message: error)
        }
    }

    private var borderColor: Color {
        if error != nil { return Palette.destructive }
        return isFocused ? Palette.primary : .clear
    }
}

extension StudentHubField where Accessory == EmptyView {
    init(label: String?, error: String? = nil, isFocused: Bool = false, @ViewBuilder field: @escaping () -> Field) {
        self.init(label: label, error: error, isFocused: isFocused, field: field, accessory: { EmptyView() })
    }
}

/// Кнопка «показать пароль» внутри поля: 44×44 — цель касания HIG.
struct PasswordVisibilityToggle: View {
    @Binding var isVisible: Bool

    var body: some View {
        Button {
            isVisible.toggle()
        } label: {
            Image(systemName: isVisible ? "eye.slash" : "eye")
                .font(.body)
                .foregroundStyle(Palette.mutedForeground)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(isVisible
            ? String(localized: "auth.hidePassword", defaultValue: "Скрыть пароль")
            : String(localized: "auth.showPassword", defaultValue: "Показать пароль")))
    }
}

// MARK: - Кнопки

/// Главное действие: на iOS 26 — капсула тонированного стекла (`PrimaryButtonStyle`),
/// во время запроса — индикатор, повторное нажатие не уходит.
struct StudentHubPrimaryButton: View {
    let title: String
    var isLoading = false
    let action: () -> Void

    var body: some View {
        Button(action: { if !isLoading { action() } }) {
            Text(title)
        }
        .buttonStyle(PrimaryButtonStyle(isLoading: isLoading))
        .accessibilityAddTraits(isLoading ? .updatesFrequently : [])
    }
}

/// Второстепенное действие с иконкой: прозрачное стекло на iOS 26.
struct StudentHubSecondaryButton: View {
    let title: String
    var systemImage: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if let systemImage {
                Label(title, systemImage: systemImage)
            } else {
                Text(title)
            }
        }
        .buttonStyle(QuietButtonStyle())
    }
}

/// Текстовая ссылка формы: «Забыли пароль?», «Вернуться ко входу».
struct AuthTextLink: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.primary)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Разделитель «или» между способами входа.
struct AuthOrDivider: View {
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        HStack(spacing: Spacing.lg) {
            line
            Text(String(localized: "auth.or", defaultValue: "или"))
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
            line
        }
        .accessibilityHidden(true)
    }

    private var line: some View {
        Rectangle()
            .fill(Palette.border)
            .frame(height: 1 / displayScale)
            .frame(maxWidth: .infinity)
    }
}

// MARK: - Юридические ссылки

/// Куда ведут экраны до входа.
enum AuthRoute: Hashable {
    case qrSignIn
    case forgotPassword
    case legal(LegalDocument)
}

/// Ссылки на политику и соглашение внизу панели. Нативные экраны документа, а не
/// браузер: документ нужен до входа, и его должно быть удобно читать на телефоне.
struct StudentHubLegalLinks: View {
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Spacing.sm) { links(separator: true) }
            VStack(spacing: Spacing.xs) { links(separator: false) }
        }
        .font(.footnote)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func links(separator: Bool) -> some View {
        NavigationLink(value: AuthRoute.legal(.privacy)) {
            Text(LegalDocument.privacy.title).frame(minHeight: 36)
        }
        if separator {
            Text(verbatim: "·").foregroundStyle(Palette.mutedForeground).accessibilityHidden(true)
        }
        NavigationLink(value: AuthRoute.legal(.terms)) {
            Text(LegalDocument.terms.title).frame(minHeight: 36)
        }
    }
}

// MARK: - Состояния

/// Карточка состояния экранов до входа: нет связи, ошибка, код истёк, готово.
/// Одна на все экраны — человек узнаёт её сразу, а не разбирает каждый раз новую плашку.
struct AuthNotice: View {
    enum Kind {
        case offline
        case error
        case expired
        case success

        var symbol: String {
            switch self {
            case .offline: return "wifi.slash"
            case .error: return "exclamationmark.triangle.fill"
            case .expired: return "clock.arrow.circlepath"
            case .success: return "checkmark"
            }
        }

        var tint: Color {
            switch self {
            case .offline: return Palette.warning
            case .error: return Palette.destructive
            case .expired: return Palette.mutedForeground
            case .success: return Palette.success
            }
        }
    }

    let kind: Kind
    let title: String
    var message: String?
    var actionTitle: String?
    var action: (() -> Void)?
    /// В квадрате кода — по центру, над формой — в строку.
    var isCentered = false

    var body: some View {
        Group {
            if isCentered {
                VStack(spacing: Spacing.md) {
                    icon(size: 56)
                    texts(alignment: .center)
                    button
                }
                .padding(Spacing.xl)
            } else {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    icon(size: 36)
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        texts(alignment: .leading)
                        button
                    }
                    Spacer(minLength: 0)
                }
                .padding(Spacing.lg)
                .background(kind.tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func icon(size: CGFloat) -> some View {
        Image(systemName: kind.symbol)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(kind.tint)
            .frame(width: size, height: size)
            .background(kind.tint.opacity(0.14), in: Circle())
            .accessibilityHidden(true)
    }

    private func texts(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.foreground)
            if let message {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .multilineTextAlignment(alignment == .center ? .center : .leading)
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var button: some View {
        if let actionTitle, let action {
            Button(action: action) {
                Label(actionTitle, systemImage: "arrow.clockwise")
                    .font(.subheadline.weight(.semibold))
            }
            .glassProminentButton()
            .controlSize(isCentered ? .large : .regular)
        }
    }
}

extension AuthNotice {
    /// «Нет связи с сервером» — одним текстом на всех экранах.
    static func offline(retry: (() -> Void)? = nil, centered: Bool = false) -> AuthNotice {
        AuthNotice(
            kind: .offline,
            title: String(localized: "error.network", defaultValue: "Нет связи с сервером"),
            message: String(
                localized: "auth.offline.hint",
                defaultValue: "Проверьте интернет — как только связь появится, попробуйте ещё раз."
            ),
            actionTitle: retry == nil ? nil : String(localized: "common.retry", defaultValue: "Повторить"),
            action: retry,
            isCentered: centered
        )
    }
}

/// Ошибка формы: «нет связи» — карточкой с подсказкой и повтором, остальное — той же
/// карточкой с текстом сервера.
struct AuthFormError: View {
    let message: String?
    var isOffline = false
    var retry: (() -> Void)?

    var body: some View {
        if let message {
            if isOffline {
                AuthNotice.offline(retry: retry)
            } else {
                AuthNotice(kind: .error, title: message)
            }
        }
    }
}
