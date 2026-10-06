import SwiftUI

/// Корневая сцена.
///
/// Настоящая оболочка — пять вкладок с составом по роли — появится в задаче 0.6,
/// экран входа перед ней — в 0.5. Пока в Debug показываем витрину токенов: так
/// дизайн-ядро видно на устройстве с первого дня, как витрина `/_dev/design-system`
/// в вебе.
struct RootView: View {
    var body: some View {
        #if DEBUG
            TokenGalleryView()
        #else
            ScaffoldPlaceholderView()
        #endif
    }
}

private struct ScaffoldPlaceholderView: View {
    var body: some View {
        VStack(spacing: Spacing.md) {
            Text(verbatim: "StudentHub")
                .font(Typography.pageTitle)
                .foregroundStyle(Palette.foreground)
            Text(verbatim: AppConfiguration.clientVersion)
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
    }
}
