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
