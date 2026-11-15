import UIKit

/// Категории панели эмодзи. Наборы — обычные символы Unicode (не анимированные эмодзи Telegram).
enum EmojiCatalog {
    struct Category {
        var title: String
        var symbol: String
        var emoji: [String]
    }

    private static func list(_ string: String) -> [String] {
        string.split(separator: " ").map(String.init)
    }

    static let categories: [Category] = [
        Category(title: "Смайлы", symbol: "face.smiling", emoji: list("😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖")),
        Category(title: "Люди", symbol: "hand.wave", emoji: list("👋 🤚 🖐 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 💪 🦾 👀 👁 👅 👄 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 👮 🕵️ 💂 👷 🤴 👸 👳 🧕 🤵 👰 🤰 🤱 👼 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜 🧝 💃 🕺 👯 🧘 🏃 🚶")),
        Category(title: "Животные", symbol: "pawprint", emoji: list("🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🐢 🐍 🦎 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦒 🐪 🐫 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🐐 🦌 🐕 🐈 🐓 🦃 🕊 🐇 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍁 🍂 🍃 🌷 🌹 🌺 🌸 🌼 🌻")),
        Category(title: "Еда", symbol: "fork.knife", emoji: list("🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🥙 🧆 🌮 🌯 🥗 🥘 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 ☕️ 🍵 🧃 🥤 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉")),
        Category(title: "Активности", symbol: "figure.run", emoji: list("⚽️ 🏀 🏈 ⚾️ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🏒 🏑 🥍 🏏 🥅 ⛳️ 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸ 🥌 🎿 ⛷ 🏂 🏋️ 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧗 🚴 🚵 🏆 🥇 🥈 🥉 🏅 🎖 🎗 🎫 🎟 🎪 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 ♟ 🎯 🎳 🎮 🎰 🧩")),
        Category(title: "Путешествия", symbol: "car", emoji: list("🚗 🚕 🚙 🚌 🚎 🏎 🚓 🚑 🚒 🚐 🚚 🚛 🚜 🛴 🚲 🛵 🏍 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩 💺 🛰 🚀 🛸 🚁 🛶 ⛵️ 🚤 🛥 🛳 ⛴ 🚢 ⚓️ ⛽️ 🚧 🚦 🚥 🗺 🗿 🗽 🗼 🏰 🏯 🏟 🎡 🎢 🎠 ⛲️ ⛱ 🏖 🏝 🏜 🌋 ⛰ 🏔 🗻 🏕 ⛺️ 🏠 🏡 🏘 🏗 🏭 🏢 🏬 🏣 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛 ⛪️ 🕌 🕍 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙 🌃 🌌 🌉 🌁")),
        Category(title: "Предметы", symbol: "lightbulb", emoji: list("⌚️ 📱 💻 ⌨️ 🖥 🖨 🖱 🕹 💽 💾 💿 📀 📷 📸 📹 🎥 📞 ☎️ 📺 📻 🎙 ⏱ ⏰ ⌛️ ⏳ 📡 🔋 🔌 💡 🔦 🕯 🧯 💸 💵 💳 💎 ⚖️ 🧰 🔧 🔨 🛠 ⛏ 🔩 ⚙️ 🧱 🧲 🔫 💣 🔪 🗡 🛡 🚬 🔮 📿 💈 🔭 🔬 💊 💉 🧬 🦠 🧪 🌡 🧹 🧺 🧻 🚽 🚿 🛁 🧼 🧽 🔑 🗝 🚪 🛋 🛏 🧸 🖼 🛍 🛒 🎁 🎈 🎏 🎀 🎊 🎉 🎎 🏮 ✉️ 📩 📨 📧 💌 📦 🏷 📪 📫 📮 📜 📃 📄 📑 📊 📈 📉 🗒 🗓 📆 📅 📇 🗃 🗳 🗄 📋 📁 📂 🗂 🗞 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🔗 📎 🖇 📐 📏 📌 📍 ✂️ 🖊 🖋 ✒️ 🖌 🖍 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓")),
        Category(title: "Символы", symbol: "heart", emoji: list("❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ ☢️ ☣️ 📴 📳 ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🚹 🚺 🚼 🚻 🚮 🎦 📶 🆗 🆙 🆒 🆕 🆓 🔟 🔢 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ 🔀 🔁 🔂 ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ 🔄 ➕ ➖ ➗ ✖️ ♾ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 🔜 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛️ ⬜️ 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛")),
        Category(title: "Флаги", symbol: "flag", emoji: list("🏳️ 🏴 🏁 🚩 🏳️‍🌈 🇰🇿 🇷🇺 🇺🇦 🇧🇾 🇺🇿 🇰🇬 🇹🇯 🇹🇲 🇦🇿 🇦🇲 🇬🇪 🇹🇷 🇨🇳 🇯🇵 🇰🇷 🇮🇳 🇦🇪 🇮🇱 🇪🇬 🇺🇸 🇨🇦 🇲🇽 🇧🇷 🇦🇷 🇬🇧 🇮🇪 🇫🇷 🇩🇪 🇮🇹 🇪🇸 🇵🇹 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇵🇱 🇨🇿 🇸🇪 🇳🇴 🇫🇮 🇩🇰 🇬🇷 🇦🇺 🇳🇿 🇿🇦 🇹🇭 🇻🇳 🇮🇩 🇸🇬 🇲🇾 🇵🇭 🇪🇺 🇺🇳")),
    ]

    static var totalCount: Int { categories.reduce(0) { $0 + $1.emoji.count } }

    // MARK: Недавние

    private static let recentKey = "emoji.recent"
    static let recentLimit = 32

    static var recent: [String] {
        UserDefaults.standard.stringArray(forKey: recentKey) ?? ["👍", "❤️", "😂", "🔥", "😍", "🙏", "😊", "🎉"]
    }

    static func noteUsed(_ emoji: String) {
        var list = recent.filter { $0 != emoji }
        list.insert(emoji, at: 0)
        UserDefaults.standard.set(Array(list.prefix(recentLimit)), forKey: recentKey)
    }
}

/// Панель эмодзи вместо клавиатуры: сетка по 8 в ряд, разделы по категориям, внизу —
/// вкладки категорий и «стереть». Ставится как `inputView` поля — значит, едет вместе с
/// `keyboardLayoutGuide`, как системная клавиатура.
final class EmojiKeyboardView: UIInputView, UICollectionViewDataSource, UICollectionViewDelegate {
    var onInsert: ((String) -> Void)?
    var onBackspace: (() -> Void)?

    private var sections: [EmojiCatalog.Category] = []
    private let collectionView: UICollectionView
    private let tabBar = UIStackView()
    private var tabButtons: [UIButton] = []
    private let backspaceButton = UIButton(type: .system)
    private var backspaceTimer: Timer?
    private static let tabHeight: CGFloat = 40

    init() {
        let layout = UICollectionViewFlowLayout()
        layout.minimumInteritemSpacing = 0
        layout.minimumLineSpacing = 2
        layout.sectionInset = UIEdgeInsets(top: 4, left: 8, bottom: 8, right: 8)
        layout.headerReferenceSize = CGSize(width: 100, height: 28)
        layout.sectionHeadersPinToVisibleBounds = true
        collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(frame: CGRect(x: 0, y: 0, width: 390, height: 300), inputViewStyle: .keyboard)
        allowsSelfSizing = false
        autoresizingMask = [.flexibleWidth]
        accessibilityIdentifier = "input.emoji.panel"

        reloadSections()
        collectionView.backgroundColor = .clear
        collectionView.dataSource = self
        collectionView.delegate = self
        collectionView.register(EmojiCell.self, forCellWithReuseIdentifier: "emoji")
        collectionView.register(EmojiHeader.self, forSupplementaryViewOfKind: UICollectionView.elementKindSectionHeader, withReuseIdentifier: "header")
        collectionView.showsVerticalScrollIndicator = false
        addSubview(collectionView)

        tabBar.axis = .horizontal
        tabBar.distribution = .fillEqually
        addSubview(tabBar)
        let all = [EmojiCatalog.Category(title: "Недавние", symbol: "clock", emoji: [])] + EmojiCatalog.categories
        for (index, category) in all.enumerated() {
            let button = UIButton(type: .system)
            button.setImage(UIImage(systemName: category.symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 15)), for: .normal)
            button.tintColor = .secondaryLabel
            button.accessibilityLabel = category.title
            button.accessibilityIdentifier = "emoji.tab.\(index)"
            button.tag = index
            button.addAction(UIAction { [weak self] _ in self?.scrollToSection(index) }, for: .touchUpInside)
            tabBar.addArrangedSubview(button)
            tabButtons.append(button)
        }
        backspaceButton.setImage(UIImage(systemName: "delete.left", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18)), for: .normal)
        backspaceButton.tintColor = .label
        backspaceButton.accessibilityLabel = "Стереть"
        backspaceButton.accessibilityIdentifier = "emoji.backspace"
        backspaceButton.addTarget(self, action: #selector(backspaceDown), for: .touchDown)
        backspaceButton.addTarget(self, action: #selector(backspaceUp), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        addSubview(backspaceButton)
        highlightTab(0)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func reloadSections() {
        sections = [EmojiCatalog.Category(title: "Недавние", symbol: "clock", emoji: EmojiCatalog.recent)] + EmojiCatalog.categories
        collectionView.reloadData()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let bottom = safeAreaInsets.bottom
        collectionView.frame = CGRect(x: 0, y: 0, width: bounds.width, height: bounds.height - Self.tabHeight - bottom)
        tabBar.frame = CGRect(x: 4, y: bounds.height - Self.tabHeight - bottom, width: bounds.width - 56, height: Self.tabHeight)
        backspaceButton.frame = CGRect(x: bounds.width - 50, y: tabBar.frame.minY, width: 46, height: Self.tabHeight)
        if let layout = collectionView.collectionViewLayout as? UICollectionViewFlowLayout {
            let side = floor((bounds.width - 16) / 8)
            if layout.itemSize.width != side {
                layout.itemSize = CGSize(width: side, height: side)
                layout.invalidateLayout()
            }
        }
    }

    private func scrollToSection(_ index: Int) {
        guard index < sections.count, !sections[index].emoji.isEmpty else { return }
        Haptics.selection()
        if let attributes = collectionView.layoutAttributesForSupplementaryElement(ofKind: UICollectionView.elementKindSectionHeader, at: IndexPath(item: 0, section: index)) {
            collectionView.setContentOffset(CGPoint(x: 0, y: min(attributes.frame.minY, max(0, collectionView.contentSize.height - collectionView.bounds.height))), animated: true)
        }
        highlightTab(index)
    }

    private func highlightTab(_ index: Int) {
        for button in tabButtons {
            button.tintColor = button.tag == index ? Palette.accent : .secondaryLabel
        }
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView.isDragging || scrollView.isDecelerating else { return }
        let point = CGPoint(x: 20, y: scrollView.contentOffset.y + 40)
        if let indexPath = collectionView.indexPathForItem(at: point) { highlightTab(indexPath.section) }
    }

    @objc private func backspaceDown() {
        onBackspace?()
        UIDevice.current.playInputClick()
        backspaceTimer?.invalidate()
        let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.onBackspace?() }
        }
        timer.fireDate = Date().addingTimeInterval(0.45)
        RunLoop.main.add(timer, forMode: .common)
        backspaceTimer = timer
    }

    @objc private func backspaceUp() {
        backspaceTimer?.invalidate()
        backspaceTimer = nil
    }

    // MARK: Сетка

    func numberOfSections(in collectionView: UICollectionView) -> Int { sections.count }

    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { sections[section].emoji.count }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "emoji", for: indexPath) as! EmojiCell
        cell.label.text = sections[indexPath.section].emoji[indexPath.item]
        return cell
    }

    func collectionView(_ collectionView: UICollectionView, viewForSupplementaryElementOfKind kind: String, at indexPath: IndexPath) -> UICollectionReusableView {
        let header = collectionView.dequeueReusableSupplementaryView(ofKind: kind, withReuseIdentifier: "header", for: indexPath) as! EmojiHeader
        header.label.text = sections[indexPath.section].title.uppercased()
        return header
    }

    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        let emoji = sections[indexPath.section].emoji[indexPath.item]
        UIDevice.current.playInputClick()
        EmojiCatalog.noteUsed(emoji)
        onInsert?(emoji)
        if let cell = collectionView.cellForItem(at: indexPath), !Motion.reduceMotion {
            let pop = CAKeyframeAnimation(keyPath: "transform.scale")
            pop.values = [1, 1.3, 1]
            pop.duration = 0.2
            cell.layer.add(pop, forKey: "pop")
        }
    }

    // MARK: Ячейки

    private final class EmojiCell: UICollectionViewCell {
        let label = UILabel()

        override init(frame: CGRect) {
            super.init(frame: frame)
            label.font = .systemFont(ofSize: 32)
            label.textAlignment = .center
            contentView.addSubview(label)
            isAccessibilityElement = true
            accessibilityIdentifier = "emojiPanel.cell"
            accessibilityTraits = .keyboardKey
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override var accessibilityLabel: String? {
            get { label.text }
            set {}
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            label.frame = contentView.bounds
        }
    }

    private final class EmojiHeader: UICollectionReusableView {
        let label = UILabel()

        override init(frame: CGRect) {
            super.init(frame: frame)
            label.font = .systemFont(ofSize: 12, weight: .semibold)
            label.textColor = .secondaryLabel
            addSubview(label)
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func layoutSubviews() {
            super.layoutSubviews()
            label.frame = bounds.insetBy(dx: 8, dy: 0)
        }
    }
}

extension EmojiKeyboardView: UIInputViewAudioFeedback {
    var enableInputClicksWhenVisible: Bool { true }
}
