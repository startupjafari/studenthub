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
    @ViewBuilder
    func floatingGlass<S: Shape>(in shape: S) -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                glassEffect(.regular.interactive(), in: shape)
            } else {
                background(.regularMaterial, in: shape)
            }
        #else
            background(.regularMaterial, in: shape)
        #endif
    }

    /// Панель вкладок сворачивается, пока ленту листают вниз, и возвращается при
    /// прокрутке вверх — контенту достаётся весь экран, навигация в одном жесте.
    @ViewBuilder
    func minimizesTabBarOnScroll() -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                tabBarMinimizeBehavior(.onScrollDown)
            } else {
                self
            }
        #else
            self
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
    @ViewBuilder
    func glassSurface<S: Shape>(tint: Color? = nil, interactive: Bool = true, in shape: S) -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                let base: Glass = tint.map { Glass.regular.tint($0) } ?? .regular
                glassEffect(interactive ? base.interactive() : base, in: shape)
            } else {
                background(tint ?? Palette.muted, in: shape)
            }
        #else
            background(tint ?? Palette.muted, in: shape)
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
