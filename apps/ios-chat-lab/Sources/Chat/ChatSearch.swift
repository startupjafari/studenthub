import UIKit

/// Поиск по переписке, как в Telegram: поле в шапке, внизу вместо панели ввода — «N из M»
/// и стрелки. Первым показывается самое свежее совпадение, стрелка вверх — к более старому.
/// Совпадения подсвечиваются в тексте пузырей.
@MainActor
final class ChatSearchController: NSObject, UISearchTextFieldDelegate {
    private weak var chat: ChatViewController?
    let field = UISearchTextField()
    let bar = ChatSearchResultsBar()
    private(set) var query = ""
    private(set) var results: [MessageID] = []
    /// Индекс в `results` (0 — самое свежее).
    private(set) var index = 0
    private var debounce: DispatchWorkItem?

    init(chat: ChatViewController) {
        self.chat = chat
        super.init()
        field.placeholder = "Поиск"
        field.returnKeyType = .search
        field.autocorrectionType = .no
        field.delegate = self
        field.accessibilityIdentifier = "search.field"
        field.addTarget(self, action: #selector(textChanged), for: .editingChanged)
        bar.upButton.addAction(UIAction { [weak self] _ in self?.step(older: true) }, for: .touchUpInside)
        bar.downButton.addAction(UIAction { [weak self] _ in self?.step(older: false) }, for: .touchUpInside)
        bar.update(index: 0, count: 0, query: "")
    }

    var currentId: MessageID? { results.indices.contains(index) ? results[index] : nil }

    @objc private func textChanged() {
        debounce?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated { self?.run(query: self?.field.text ?? "", jump: true) }
        }
        debounce = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        debounce?.cancel()
        run(query: textField.text ?? "", jump: true)
        textField.resignFirstResponder()
        return true
    }

    private func run(query newQuery: String, jump: Bool) {
        guard let chat else { return }
        let trimmed = newQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        query = trimmed
        results = chat.store.search(trimmed)
        index = 0
        applyHighlight()
        bar.update(index: index, count: results.count, query: trimmed)
        if jump, let id = currentId { chat.scrollToMessage(id, highlight: true) }
    }

    /// Хранилище изменилось: пересчитать, оставаясь на том же сообщении, если оно живо.
    func storeDidChange() {
        guard let chat, !query.isEmpty else { return }
        let current = currentId
        results = chat.store.search(query)
        if let current, let newIndex = results.firstIndex(of: current) {
            index = newIndex
        } else {
            index = min(index, max(0, results.count - 1))
        }
        bar.update(index: index, count: results.count, query: query)
    }

    func step(older: Bool) {
        guard let chat, !results.isEmpty else { return }
        let next = older ? index + 1 : index - 1
        guard results.indices.contains(next) else {
            Haptics.error()
            return
        }
        index = next
        Haptics.selection()
        bar.update(index: index, count: results.count, query: query)
        chat.scrollToMessage(results[index], highlight: true)
    }

    private func applyHighlight() {
        guard let chat else { return }
        chat.cellContext.highlightQuery = query.isEmpty ? nil : query
        chat.reconfigureVisibleCells(animated: false)
    }
}

// MARK: - Панель результатов

final class ChatSearchResultsBar: UIView {
    static let height: CGFloat = 52

    let upButton = UIButton(type: .system)
    let downButton = UIButton(type: .system)
    let counterLabel = UILabel()
    private let background = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
    private let separator = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        clipsToBounds = false
        addSubview(background)
        separator.backgroundColor = .separator
        addSubview(separator)
        let configuration = UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold)
        upButton.setImage(UIImage(systemName: "chevron.up", withConfiguration: configuration), for: .normal)
        upButton.accessibilityLabel = "Предыдущий результат"
        upButton.accessibilityIdentifier = "search.up"
        downButton.setImage(UIImage(systemName: "chevron.down", withConfiguration: configuration), for: .normal)
        downButton.accessibilityLabel = "Следующий результат"
        downButton.accessibilityIdentifier = "search.down"
        counterLabel.font = .monospacedDigitSystemFont(ofSize: 15, weight: .medium)
        counterLabel.textColor = .secondaryLabel
        counterLabel.accessibilityIdentifier = "search.counter"
        [upButton, downButton, counterLabel].forEach(addSubview)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func update(index: Int, count: Int, query: String) {
        if query.isEmpty {
            counterLabel.text = ""
        } else if count == 0 {
            counterLabel.text = "Не найдено"
        } else {
            counterLabel.text = "\(index + 1) из \(count)"
        }
        counterLabel.accessibilityValue = counterLabel.text
        upButton.isEnabled = count > 0 && index + 1 < count
        downButton.isEnabled = count > 0 && index > 0
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Фон уходит под индикатор «домой», как у панели ввода.
        background.frame = CGRect(x: 0, y: 0, width: bounds.width, height: bounds.height + 200)
        separator.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 1 / max(1, traitCollection.displayScale))
        counterLabel.frame = CGRect(x: 16, y: 4, width: bounds.width - 140, height: 44)
        downButton.frame = CGRect(x: bounds.width - 52, y: 4, width: 44, height: 44)
        upButton.frame = CGRect(x: bounds.width - 100, y: 4, width: 44, height: 44)
    }
}

// MARK: - Подключение к экрану чата

extension ChatViewController {
    func beginSearch() {
        guard searchController == nil else {
            searchController?.field.becomeFirstResponder()
            return
        }
        if cellContext.isSelecting { endSelection() }
        // Из профиля: сначала вернуться в чат.
        if navigationController?.topViewController !== self {
            navigationController?.popToViewController(self, animated: true)
        }
        saveDraft()
        let search = ChatSearchController(chat: self)
        searchController = search
        updatePinnedPanel(animated: true)

        search.field.frame = CGRect(x: 0, y: 0, width: view.bounds.width - 120, height: 36)
        navigationItem.titleView = search.field
        navigationItem.hidesBackButton = true
        navigationItem.leftBarButtonItem = nil
        let cancel = UIBarButtonItem(title: "Отмена", style: .plain, target: self, action: #selector(searchCancelTapped))
        cancel.accessibilityIdentifier = "search.cancel"
        navigationItem.rightBarButtonItems = [cancel]

        // Панель результатов встаёт на место панели ввода (та же опора — клавиатура).
        let bar = search.bar
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(bar, aboveSubview: inputPanel)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: inputPanel.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: inputPanel.trailingAnchor),
            bar.topAnchor.constraint(equalTo: inputPanel.topAnchor),
            bar.bottomAnchor.constraint(equalTo: inputPanel.bottomAnchor),
        ])
        bar.alpha = 0
        inputPanel.textView.resignFirstResponder()
        inputPanel.isUserInteractionEnabled = false
        inputPanel.accessibilityElementsHidden = true
        Motion.layout {
            bar.alpha = 1
            self.inputPanel.alpha = 0
            self.inputHeightConstraint.constant = ChatSearchResultsBar.height
            self.view.layoutIfNeeded()
        }
        DispatchQueue.main.async { search.field.becomeFirstResponder() }
    }

    @objc func searchCancelTapped() { endSearch() }

    func endSearch() {
        guard let search = searchController else { return }
        search.field.resignFirstResponder()
        searchController = nil
        cellContext.highlightQuery = nil
        reconfigureVisibleCells(animated: false)
        restoreNavigationItems()
        inputPanel.isUserInteractionEnabled = true
        inputPanel.accessibilityElementsHidden = false
        Motion.layout({
            search.bar.alpha = 0
            self.inputPanel.alpha = 1
            self.inputHeightConstraint.constant = self.inputPanel.contentHeight
            self.view.layoutIfNeeded()
        }, completion: { _ in search.bar.removeFromSuperview() })
        updatePinnedPanel(animated: true)
    }

    // MARK: Обои и тема

    func presentWallpaperPicker() {
        let picker = WallpaperPickerViewController(store: store)
        let navigation = UINavigationController(rootViewController: picker)
        if let sheet = navigation.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        navigation.view.accessibilityIdentifier = "wallpaper.sheet"
        present(navigation, animated: true)
    }
}

// MARK: - Выбор обоев

final class WallpaperPickerViewController: UIViewController {
    private let store: ChatStore
    private let themeControl = UISegmentedControl(items: ThemeMode.allCases.map(\.title))
    private let scrollView = UIScrollView()
    private var options: [(preset: WallpaperPreset, button: UIControl, preview: WallpaperView, check: UIImageView)] = []

    init(store: ChatStore) {
        self.store = store
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Оформление"
        view.backgroundColor = .systemGroupedBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in
            self?.dismiss(animated: true)
        })
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "wallpaper.close"

        themeControl.selectedSegmentIndex = ThemeMode.allCases.firstIndex(of: ThemeManager.shared.mode) ?? 0
        themeControl.accessibilityIdentifier = "theme.segment"
        themeControl.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            let mode = ThemeMode.allCases[self.themeControl.selectedSegmentIndex]
            ThemeManager.shared.setMode(mode, animated: true)
            Haptics.selection()
        }, for: .valueChanged)
        view.addSubview(themeControl)
        view.addSubview(scrollView)

        for preset in WallpaperPreset.all {
            let button = UIControl()
            button.layer.cornerRadius = 12
            button.layer.cornerCurve = .continuous
            button.clipsToBounds = true
            button.accessibilityIdentifier = "wallpaper.option.\(preset.id)"
            button.accessibilityLabel = preset.title
            button.isAccessibilityElement = true
            button.accessibilityTraits = .button
            let preview = WallpaperView()
            preview.apply(preset)
            preview.isUserInteractionEnabled = false
            button.addSubview(preview)
            // Образец пузырей поверх обоев.
            for outgoing in [false, true] {
                let bubble = UIView()
                bubble.backgroundColor = Palette.bubble(outgoing: outgoing)
                bubble.layer.cornerRadius = 8
                bubble.tag = outgoing ? 2 : 1
                bubble.isUserInteractionEnabled = false
                button.addSubview(bubble)
            }
            let check = UIImageView(image: UIImage(systemName: "checkmark.circle.fill"))
            check.tintColor = .white
            check.backgroundColor = Palette.accent
            check.layer.cornerRadius = 11
            check.clipsToBounds = true
            button.addSubview(check)
            let title = UILabel()
            title.text = preset.title
            title.font = .systemFont(ofSize: 12, weight: .semibold)
            title.textColor = .white
            title.shadowColor = UIColor.black.withAlphaComponent(0.4)
            title.shadowOffset = CGSize(width: 0, height: 1)
            title.tag = 3
            button.addSubview(title)
            button.addAction(UIAction { [weak self] _ in self?.select(preset) }, for: .touchUpInside)
            scrollView.addSubview(button)
            options.append((preset, button, preview, check))
        }
        updateChecks()
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (controller: WallpaperPickerViewController, _) in
            controller.updateChecks()
        }
    }

    private func select(_ preset: WallpaperPreset) {
        store.updateSettings { $0.wallpaperId = preset.id }
        NotificationCenter.default.post(name: .chatWallpaperDidChange, object: nil)
        Haptics.selection()
        updateChecks()
    }

    private func updateChecks() {
        for option in options {
            let selected = option.preset.id == store.settings.wallpaperId
            option.check.isHidden = !selected
            option.button.accessibilityValue = selected ? "выбрано" : nil
            option.button.layer.borderWidth = selected ? 3 : 0
            option.button.layer.borderColor = Palette.accent.resolvedColor(with: traitCollection).cgColor
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let inset: CGFloat = 16
        let top = view.safeAreaInsets.top + 12
        themeControl.frame = CGRect(x: inset, y: top, width: view.bounds.width - inset * 2, height: 32)
        scrollView.frame = CGRect(x: 0, y: themeControl.frame.maxY + 12, width: view.bounds.width, height: view.bounds.height - themeControl.frame.maxY - 12)
        let columns: CGFloat = 3
        let spacing: CGFloat = 10
        let width = floor((view.bounds.width - inset * 2 - spacing * (columns - 1)) / columns)
        let height = floor(width * 1.6)
        for (offset, option) in options.enumerated() {
            let column = CGFloat(offset % Int(columns))
            let row = CGFloat(offset / Int(columns))
            option.button.frame = CGRect(x: inset + column * (width + spacing), y: row * (height + spacing), width: width, height: height)
            option.preview.frame = option.button.bounds
            option.check.frame = CGRect(x: width - 28, y: 6, width: 22, height: 22)
            for subview in option.button.subviews {
                switch subview.tag {
                case 1: subview.frame = CGRect(x: 8, y: height * 0.45, width: width * 0.55, height: 18)
                case 2: subview.frame = CGRect(x: width * 0.4 - 8, y: height * 0.45 + 24, width: width * 0.6, height: 18)
                case 3: subview.frame = CGRect(x: 8, y: height - 24, width: width - 16, height: 18)
                default: break
                }
            }
        }
        let rows = ceil(CGFloat(options.count) / columns)
        scrollView.contentSize = CGSize(width: view.bounds.width, height: rows * (height + spacing) + view.safeAreaInsets.bottom)
    }
}
