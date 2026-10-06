import SwiftUI

/// Корневая сцена. Оболочка из пяти вкладок появится в задаче 0.6, экран входа
/// перед ней — в 0.5.
struct RootView: View {
    var body: some View {
        VStack {
            Text(verbatim: "StudentHub")
            Text(verbatim: AppConfiguration.clientVersion)
        }
    }
}
