import SwiftUI

/// Выбор вкладки скольжением по полосе, как у панели вкладок iOS 26 и в Telegram:
/// палец лёг на полосу — подсветка встаёт под ним и едет за ним вдоль полосы,
/// отпустил — выбрана вкладка под пальцем. Касание без движения — обычный выбор.
///
/// Каждая вкладка отмечает свою рамку (`slideItemFrame`), полоса целиком ловит палец
/// (`slideSelection`) и находит вкладку по горизонтали — палец, ушедший чуть выше или
/// ниже полосы, выбора не теряет.
extension View {
    /// Рамка вкладки с номером `index` в системе координат полосы `space`.
    func slideItemFrame(_ index: Int, in space: String) -> some View {
        background {
            GeometryReader { proxy in
                Color.clear.preference(key: SlideItemFrames.self, value: [index: proxy.frame(in: .named(space))])
            }
        }
    }

    /// Полоса вкладок: `hovered` — вкладка под пальцем, пока он на полосе; `onSelect` —
    /// выбор, когда палец отпустили.
    func slideSelection(space: String, hovered: Binding<Int?>, onSelect: @escaping (Int) -> Void) -> some View {
        modifier(SlideSelection(space: space, hovered: hovered, onSelect: onSelect))
    }
}

private struct SlideItemFrames: PreferenceKey {
    static let defaultValue: [Int: CGRect] = [:]

    static func reduce(value: inout [Int: CGRect], nextValue: () -> [Int: CGRect]) {
        value.merge(nextValue()) { $1 }
    }
}

private struct SlideSelection: ViewModifier {
    let space: String
    @Binding var hovered: Int?
    let onSelect: (Int) -> Void

    @State private var frames: [Int: CGRect] = [:]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .coordinateSpace(.named(space))
            .onPreferenceChange(SlideItemFrames.self) { frames = $0 }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .named(space))
                    .onChanged { drag in
                        let index = index(at: drag.location.x)
                        guard index != hovered else { return }
                        withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) { hovered = index }
                    }
                    .onEnded { drag in
                        let index = index(at: drag.location.x)
                        withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) { hovered = nil }
                        if let index { onSelect(index) }
                    }
            )
            // Толчок — при переходе пальца на соседнюю вкладку, не при первом касании.
            .sensoryFeedback(.selection, trigger: hovered) { old, new in old != nil && new != nil }
    }

    /// Вкладка под пальцем по горизонтали; между вкладками и за краями — ближайшая.
    private func index(at x: CGFloat) -> Int? {
        if let hit = frames.first(where: { $0.value.minX <= x && x <= $0.value.maxX }) { return hit.key }
        return frames.min { abs($0.value.midX - x) < abs($1.value.midX - x) }?.key
    }
}
