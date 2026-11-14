import SwiftUI
import UIKit

/// Где на экране пузырь — для меню по долгому нажатию.
///
/// Пузырь живёт в ячейке `UICollectionView` под `UIHostingConfiguration`, и координаты
/// SwiftUI `.global` там не обновляются при прокрутке UIKit. Поэтому под пузырём лежит
/// пустой `UIView`: у него настоящая рамка UIKit, и в окно он переводится точно в
/// момент нажатия, где бы ни стояла лента.
@MainActor
final class BubbleAnchors {
    static let shared = BubbleAnchors()

    enum Part: Hashable { case row, bubble }

    private struct Key: Hashable {
        let id: String
        let part: Part
    }

    private final class Weak {
        weak var view: AnchorView?
        init(_ view: AnchorView) { self.view = view }
    }

    private var views: [Key: Weak] = [:]

    fileprivate func register(_ view: AnchorView) {
        guard let id = view.messageID else { return }
        views[Key(id: id, part: view.part)] = Weak(view)
        // Ячейки переиспользуются: отвалившиеся ссылки чистим заодно.
        if views.count > 400 { views = views.filter { $0.value.view != nil } }
    }

    /// Рамка в координатах окна; `nil` — пузыря на экране нет.
    func rect(for id: String, part: Part) -> CGRect? {
        // Вид мог уйти под другое сообщение при переиспользовании ячейки.
        guard let view = views[Key(id: id, part: part)]?.view, view.messageID == id, view.window != nil else {
            return nil
        }
        return view.convert(view.bounds, to: nil)
    }
}

final class AnchorView: UIView {
    var messageID: String?
    var part: BubbleAnchors.Part = .bubble

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }
}

private struct BubbleAnchorView: UIViewRepresentable {
    let id: String
    let part: BubbleAnchors.Part

    func makeUIView(context: Context) -> AnchorView { AnchorView() }

    func updateUIView(_ view: AnchorView, context: Context) {
        view.messageID = id
        view.part = part
        BubbleAnchors.shared.register(view)
    }
}

extension View {
    /// Отметить место пузыря (или всей строки) для меню по долгому нажатию.
    func bubbleAnchor(_ id: String, part: BubbleAnchors.Part, enabled: Bool = true) -> some View {
        background {
            if enabled {
                BubbleAnchorView(id: id, part: part).accessibilityHidden(true)
            }
        }
    }
}

/// Живой элемент внутри пузыря: вариант опроса, пункт чек-листа, вложение, цитата,
/// реакции. Двойной тап по нему реакцию не ставит (правило «двойной тап — по
/// неинтерактивной части»): лента ищет такие виды под пальцем в ячейке.
final class BubbleControlZone: UIView {
    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    /// Лежит ли точка (в координатах `view`) на живом элементе внутри `view`.
    static func contains(_ point: CGPoint, in view: UIView) -> Bool {
        for sub in view.subviews where !sub.isHidden {
            if let zone = sub as? BubbleControlZone, zone.window != nil,
                zone.bounds.contains(zone.convert(point, from: view))
            {
                return true
            }
            if contains(sub.convert(point, from: view), in: sub) { return true }
        }
        return false
    }
}

private struct BubbleControlZoneView: UIViewRepresentable {
    func makeUIView(context: Context) -> BubbleControlZone { BubbleControlZone() }
    func updateUIView(_ view: BubbleControlZone, context: Context) {}
}

extension View {
    /// Отметить живой элемент пузыря: двойной тап по нему не ставит реакцию. На `Group`
    /// метка ложится на каждый элемент отдельно.
    func bubbleControl(enabled: Bool = true) -> some View {
        background {
            if enabled {
                BubbleControlZoneView().accessibilityHidden(true)
            }
        }
    }
}
