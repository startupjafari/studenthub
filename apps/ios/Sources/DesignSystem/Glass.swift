import SwiftUI

/// Liquid Glass и поведение панелей iOS 26 — с откатом на прежние системы.
///
/// Минимальная версия приложения — iOS 17, поэтому каждый вызов нового API стоит за
/// `#available`. Проверка компилятора — для сборки на Xcode старше 26 (Swift 6.2): там
/// этих символов нет вовсе, и `#available` не спасает от ошибки компиляции.
///
/// Стекло — только для навигации и плавающих контролов. Карточки контента остаются
/// непрозрачными: текст на стекле над пёстрой лентой читается хуже.
extension View {
    /// Плавающий контрол над контентом: кнопка создания, панель действий просмотрщика.
    ///
    /// Касание принимает вся форма: такое стекло часто стоит в подписи `Button`, а само
    /// по себе касаний не ловит (см. `glassSurface`).
    @ViewBuilder
    func floatingGlass<S: Shape>(in shape: S) -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                glassEffect(.regular.interactive(), in: shape)
                    .contentShape(shape)
            } else {
                background(.regularMaterial, in: shape)
                    .contentShape(shape)
            }
        #else
            background(.regularMaterial, in: shape)
                .contentShape(shape)
        #endif
    }
}

// MARK: - Кнопки

extension View {
    /// Главное действие экрана: на iOS 26 — тонированное стекло (`.glassProminent`),
    /// раньше — системная заливка.
    @ViewBuilder
    func glassProminentButton() -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                buttonStyle(.glassProminent)
            } else {
                buttonStyle(.borderedProminent)
            }
        #else
            buttonStyle(.borderedProminent)
        #endif
    }

    /// Второстепенное действие: на iOS 26 — прозрачное стекло (`.glass`).
    @ViewBuilder
    func glassButton() -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                buttonStyle(.glass)
            } else {
                buttonStyle(.bordered)
            }
        #else
            buttonStyle(.bordered)
        #endif
    }

    /// Стекло под произвольной формой: тонированное (выбранная капсула) или прозрачное.
    /// До iOS 26 — заливка той же формы.
    ///
    /// Касание принимает вся форма (`contentShape`): стекло само по себе касаний не
    /// ловит, и у кнопки со стилем `.plain` нажимался только значок — синие «+» и
    /// «Отправить» на круге казались мёртвыми.
    @ViewBuilder
    func glassSurface<S: Shape>(tint: Color? = nil, interactive: Bool = true, in shape: S) -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                let base: Glass = tint.map { Glass.regular.tint($0) } ?? .regular
                glassEffect(interactive ? base.interactive() : base, in: shape)
                    .contentShape(shape)
            } else {
                background(tint ?? Palette.muted, in: shape)
                    .contentShape(shape)
            }
        #else
            background(tint ?? Palette.muted, in: shape)
                .contentShape(shape)
        #endif
    }

    /// Непрозрачная карточка контента с радиусом iOS 26. Стекло для карточек не годится
    /// (Glass.swift, вступление): это слой контента, а не навигации.
    func cardSurface(padding: CGFloat = Spacing.xl) -> some View {
        self
            .padding(padding)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }
}

/// Группа стеклянных элементов: на iOS 26 они сливаются и перетекают друг в друга
/// (`GlassEffectContainer`), раньше — просто стек.
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = Spacing.md
    @ViewBuilder let content: () -> Content

    var body: some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                GlassEffectContainer(spacing: spacing, content: content)
            } else {
                content()
            }
        #else
            content()
        #endif
    }
}

// MARK: - Панель листа

/// Кнопка «закрыть» листа: на iOS 26 — системный крестик в стекле (`role: .close`), как
/// в приложениях Apple; раньше — слово «Отмена».
struct SheetCloseButton: View {
    let action: () -> Void

    var body: some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                Button(role: .close, action: action)
                    .accessibilityIdentifier("sheet.close")
            } else {
                legacy
            }
        #else
            legacy
        #endif
    }

    private var legacy: some View {
        Button(String(localized: "common.cancel", defaultValue: "Отмена"), action: action)
            .accessibilityIdentifier("sheet.close")
    }
}

/// Крестик в стеклянном круге для своей шапки листа — вне панели навигации, как в
/// листе вложений Telegram. `Button(role: .close)` крестиком рисуется только в панели
/// навигации, а в обычной шапке система пишет слово «Закрыть».
struct GlassCloseButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.body.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                .floatingGlass(in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("sheet.close")
        .accessibilityLabel(Text(String(localized: "common.close", defaultValue: "Закрыть")))
    }
}

// MARK: - Верхний край

extension View {
    /// Верхний край экрана как в iOS 26 (и в Instagram, «Фото», App Store): без полосы и
    /// линии — контент под статус-баром и кнопками панели плавно размывается и тает.
    /// Это системный эффект края прокрутки (`.soft`); фон панели при этом не задаётся
    /// вовсе — любой фон (`toolbarBackground`, `UINavigationBarAppearance`) возвращает
    /// старую матовую полосу с краем и выключает стеклянные кнопки в панели.
    /// До iOS 26 — поведение системы по умолчанию.
    @ViewBuilder
    func softTopEdge() -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                scrollEdgeEffectStyle(.soft, for: .top)
            } else {
                self
            }
        #else
            self
        #endif
    }

    /// Верхний край для плотных списков и форм (настройки, правка профиля): чёткая
    /// граница под панелью вместо мягкого размытия. Строки с текстом и полями, уходя под
    /// заголовок и кнопки панели, иначе просвечивают сквозь них и спорят с заголовком.
    @ViewBuilder
    func hardTopEdge() -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                scrollEdgeEffectStyle(.hard, for: .top)
            } else {
                self
            }
        #else
            self
        #endif
    }
}

// MARK: - «Назад» для своих сценариев

/// «Назад» там, где системную кнопку приходится заменить: шаг внутри экрана (код 2FA)
/// или выход, который сначала спрашивает про несохранённое. Выглядит как системная: на
/// iOS 26 — шеврон в стекле, раньше — шеврон со словом «Назад».
struct NavigationBackButton: View {
    /// Что именно делает кнопка — для VoiceOver: «Назад ко входу», а не просто «Назад».
    var accessibilityLabel = String(localized: "common.back", defaultValue: "Назад")
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            #if compiler(>=6.2)
                if #available(iOS 26, *) {
                    Image(systemName: "chevron.backward")
                } else {
                    legacyLabel
                }
            #else
                legacyLabel
            #endif
        }
        .accessibilityLabel(Text(accessibilityLabel))
    }

    private var legacyLabel: some View {
        HStack(spacing: Spacing.xs) {
            Image(systemName: "chevron.backward")
                .fontWeight(.semibold)
            Text(String(localized: "common.back", defaultValue: "Назад"))
        }
    }
}
