import SwiftUI
import UIKit

/// Панель эмодзи на месте клавиатуры — `inputView` текстового поля. Поле остаётся первым
/// ответчиком, поэтому курсор, выделение и набранный текст никуда не деваются, а возврат
/// к клавиатуре — та же `reloadInputViews`. Поиска нет: поле поиска забрало бы фокус.
final class EmojiKeyboardInputView: UIInputView {
    private let host: UIHostingController<AnyView>

    init(onPick: @escaping (String) -> Void) {
        host = UIHostingController(rootView: AnyView(
            EmojiBrowser(columns: 8, showsSearch: false, onPick: onPick)
                .accessibilityIdentifier("emoji.keyboard")
        ))
        super.init(frame: CGRect(x: 0, y: 0, width: 390, height: 300), inputViewStyle: .keyboard)
        allowsSelfSizing = true
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: trailingAnchor),
            host.view.topAnchor.constraint(equalTo: topAnchor, constant: 6),
            host.view.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor),
            heightAnchor.constraint(equalToConstant: 300),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }
}

/// Многострочное поле с переключателем «клавиатура ↔ эмодзи»: комментарий к пересылке,
/// подписи. Растёт по строкам до `maxLines`, дальше прокручивается.
struct EmojiTextField: UIViewRepresentable {
    @Binding var text: String
    @Binding var showsEmoji: Bool
    let placeholder: String
    var maxLines = 4
    var maxLength = 4000
    var accessibilityID: String

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> PlaceholderTextView {
        let view = PlaceholderTextView()
        view.delegate = context.coordinator
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        view.textContainer.lineFragmentPadding = 0
        view.isScrollEnabled = false
        view.placeholder = placeholder
        view.accessibilityIdentifier = accessibilityID
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        context.coordinator.emojiInput = EmojiKeyboardInputView { [weak view] emoji in
            RecentEmoji.shared.use(emoji)
            view?.insertText(emoji)
        }
        return view
    }

    func updateUIView(_ view: PlaceholderTextView, context: Context) {
        context.coordinator.parent = self
        if view.text != text {
            view.text = text
            view.refreshPlaceholder()
        }
        let wantsEmoji = showsEmoji
        let hasEmoji = view.inputView != nil
        if wantsEmoji != hasEmoji {
            view.inputView = wantsEmoji ? context.coordinator.emojiInput : nil
            if view.isFirstResponder {
                view.reloadInputViews()
            } else {
                view.becomeFirstResponder()
            }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: PlaceholderTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 280
        let fitting = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let line = uiView.font?.lineHeight ?? 20
        let limit = line * CGFloat(maxLines) + uiView.textContainerInset.top + uiView.textContainerInset.bottom
        let scrolls = fitting.height > limit
        if uiView.isScrollEnabled != scrolls { uiView.isScrollEnabled = scrolls }
        return CGSize(width: width, height: min(fitting.height, limit))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: EmojiTextField
        var emojiInput: EmojiKeyboardInputView?

        init(_ parent: EmojiTextField) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            var value = textView.text ?? ""
            if value.count > parent.maxLength {
                value = String(value.prefix(parent.maxLength))
                textView.text = value
            }
            (textView as? PlaceholderTextView)?.refreshPlaceholder()
            parent.text = value
            textView.invalidateIntrinsicContentSize()
        }
    }
}

/// UITextView с серым заполнителем, пока пусто.
final class PlaceholderTextView: UITextView {
    private let placeholderLabel = UILabel()

    var placeholder: String = "" {
        didSet { placeholderLabel.text = placeholder }
    }

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        placeholderLabel.textColor = .placeholderText
        placeholderLabel.font = .preferredFont(forTextStyle: .body)
        placeholderLabel.adjustsFontForContentSizeCategory = true
        placeholderLabel.isAccessibilityElement = false
        addSubview(placeholderLabel)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    override func layoutSubviews() {
        super.layoutSubviews()
        placeholderLabel.frame = CGRect(
            x: textContainerInset.left,
            y: textContainerInset.top,
            width: bounds.width - textContainerInset.left - textContainerInset.right,
            height: placeholderLabel.font.lineHeight
        )
    }

    func refreshPlaceholder() {
        placeholderLabel.isHidden = !text.isEmpty
        accessibilityValue = text.isEmpty ? placeholder : text
    }
}
