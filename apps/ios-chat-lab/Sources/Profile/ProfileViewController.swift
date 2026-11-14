import UIKit

// ЗАГЛУШКА: профиль — отдельный шаг.
final class ProfileViewController: UIViewController {
    let store: ChatStore
    var onSearch: (() -> Void)?
    var onOpenMessage: ((MessageID) -> Void)?

    init(store: ChatStore) {
        self.store = store
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
