import SwiftUI
import UIKit

/// Вставка из буфера — иконкой внутри поля, справа: одна на все поля, куда вставляют
/// ссылку или код.
///
/// Системная `UIPasteControl`, а не своя кнопка с `UIPasteboard`: чтение буфера по
/// касанию системного элемента не спрашивает разрешения («Разрешить вставку?»). В отличие
/// от SwiftUI `PasteButton` у неё настраиваются цвета — значок фирменного цвета на лёгкой
/// подложке, а не белый на синей капсуле.
struct ClipboardPasteButton: UIViewRepresentable {
    let paste: @MainActor (String) -> Void

    /// Сторона значка; цель касания — 44 pt вокруг (`frame` у места использования).
    static let size: CGFloat = 34

    func makeCoordinator() -> Target { Target(paste: paste) }

    func makeUIView(context: Context) -> UIPasteControl {
        let configuration = UIPasteControl.Configuration()
        configuration.displayMode = .iconOnly
        configuration.cornerStyle = .capsule
        configuration.baseForegroundColor = UIColor(Palette.primary)
        configuration.baseBackgroundColor = UIColor(Palette.primary).withAlphaComponent(0.12)
        let control = UIPasteControl(configuration: configuration)
        control.target = context.coordinator
        return control
    }

    func updateUIView(_ control: UIPasteControl, context: Context) {
        context.coordinator.paste = paste
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIPasteControl, context: Context) -> CGSize? {
        CGSize(width: Self.size, height: Self.size)
    }

    /// Получатель вставки: принимает текст и отдаёт его полю на главном потоке.
    final class Target: UIResponder {
        var paste: @MainActor (String) -> Void

        init(paste: @escaping @MainActor (String) -> Void) {
            self.paste = paste
            super.init()
            pasteConfiguration = UIPasteConfiguration(forAccepting: NSString.self)
        }

        override func paste(itemProviders: [NSItemProvider]) {
            guard let provider = itemProviders.first(where: { $0.canLoadObject(ofClass: NSString.self) }) else { return }
            let deliver: @MainActor @Sendable (String) -> Void = { [weak self] text in self?.paste(text) }
            _ = provider.loadObject(ofClass: NSString.self) { value, _ in
                guard let text = value as? String else { return }
                Task { @MainActor in deliver(text) }
            }
        }
    }
}
