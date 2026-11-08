import SwiftUI

/// Временная заглушка экрана области, пока его не сделали. Перед влитием ветки её не
/// должно остаться ни одной (`grep PendingScreen`).
struct PendingScreen: View {
    let title: String
    let symbol: String

    var body: some View {
        EmptyStateView(title: title, symbol: symbol)
            .navigationTitle(Text(title))
    }
}
