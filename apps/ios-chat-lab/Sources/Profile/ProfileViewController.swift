import UIKit
import SafariServices

/// Профиль собеседника по образцу экрана Peer Info в Telegram iOS: шапка с аватаром,
/// кнопки действий, сведения, уведомления, блокировка и общие медиа по вкладкам.
final class ProfileViewController: UIViewController {
    let store: ChatStore
    /// Поиск по чату: профиль закрывается, чат открывает поиск.
    var onSearch: (() -> Void)?
    /// Переход к сообщению из общих медиа/файлов/ссылок.
    var onOpenMessage: ((MessageID) -> Void)?

    private enum Section: Int, CaseIterable {
        case info
        case settings
        case shared
    }

    private enum InfoRow {
        case phone
        case username
        case bio
    }

    let header = ProfileHeaderView()
    private lazy var tableView = UITableView(frame: .zero, style: .insetGrouped)
    private let titleLabel = UILabel()
    private let tabsControl = UISegmentedControl()
    private var index = SharedMediaIndex()
    private var selectedTab: SharedMediaTab = .media
    private var storeToken: ObservationToken?
    private var presenceToken: ObservationToken?
    private var playbackObserver: NSObjectProtocol?
    private var presence: PeerPresence = .online

    /// Перелёт аватара из шапки чата идёт поверх перехода, пока он не закончится.
    var avatarTransition: ProfileAvatarTransition?

    private static let rowDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.setLocalizedDateFormatFromTemplate("d MMM yyyy")
        return formatter
    }()

    init(store: ChatStore) {
        self.store = store
        super.init(nibName: nil, bundle: nil)
        hidesBottomBarWhenPushed = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit {
        if let playbackObserver { NotificationCenter.default.removeObserver(playbackObserver) }
    }

    // MARK: Жизненный цикл

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        view.accessibilityIdentifier = "profile.screen"
        navigationItem.largeTitleDisplayMode = .never

        titleLabel.text = store.peer.displayName
        titleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        titleLabel.alpha = 0
        titleLabel.accessibilityIdentifier = "profile.navTitle"
        navigationItem.titleView = titleLabel

        tableView.dataSource = self
        tableView.delegate = self
        tableView.backgroundColor = .clear
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "row")
        tableView.register(MediaGridRowCell.self, forCellReuseIdentifier: MediaGridRowCell.reuseId)
        tableView.register(VoiceRowCell.self, forCellReuseIdentifier: VoiceRowCell.reuseId)
        tableView.register(SwitchRowCell.self, forCellReuseIdentifier: SwitchRowCell.reuseId)
        tableView.sectionHeaderTopPadding = 0
        tableView.accessibilityIdentifier = "profile.table"
        view.addSubview(tableView)

        header.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: ProfileHeaderView.preferredHeight)
        header.nameLabel.text = store.peer.displayName
        header.avatarView.configure(peer: store.peer)
        tableView.tableHeaderView = header
        configureActions()

        for tab in SharedMediaTab.allCases {
            tabsControl.insertSegment(withTitle: tab.title, at: tab.rawValue, animated: false)
        }
        tabsControl.selectedSegmentIndex = selectedTab.rawValue
        tabsControl.addAction(UIAction { [weak self] _ in self?.tabChanged() }, for: .valueChanged)
        tabsControl.accessibilityIdentifier = "profile.tabs"

        reloadIndex()
        updateSettingsUI()
        storeToken = store.observe { [weak self] change in self?.storeDidChange(change) }
        presenceToken = MockChatService.shared.observePresence { [weak self] presence in
            self?.presence = presence
            self?.updateStatus()
        }
        playbackObserver = NotificationCenter.default.addObserver(forName: .audioPlaybackChanged, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshVoiceRows() }
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        tableView.frame = view.bounds
        if abs(header.frame.width - view.bounds.width) > 0.5 {
            header.frame.size.width = view.bounds.width
            tableView.tableHeaderView = header
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if isMovingToParent { ProfileAvatarTransition.runPush(for: self) }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if isMovingFromParent { ProfileAvatarTransition.runPop(for: self) }
    }

    // MARK: Данные

    private func reloadIndex() {
        index = SharedMediaIndex(messages: store.messages)
        for tab in SharedMediaTab.allCases {
            let count = index.count(for: selectedTab)
            tabsControl.setTitle(count > 0 ? "\(tab.title) \(count)" : tab.title, forSegmentAt: tab.rawValue)
        }
    }

    private func storeDidChange(_ change: ChatChange) {
        // Статусы доставки и реакции общие медиа не меняют.
        guard change.reason != .status, change.reason != .reaction, change.reason != .consume else { return }
        reloadIndex()
        UIView.performWithoutAnimation {
            tableView.reloadSections(IndexSet(integer: Section.shared.rawValue), with: .none)
        }
    }

    private func updateStatus() {
        let text: String
        var accent = false
        if store.settings.isBlocked {
            text = "был(а) давно"
        } else {
            switch presence {
            case .online: text = "в сети"; accent = true
            case .recently: text = "был(а) недавно"
            case let .lastSeen(date): text = "был(а) в \(MessageLayoutEngine.timeFormatter.string(from: date))"
            case .typing: text = "печатает…"; accent = true
            case .recordingVoice: text = "записывает аудио…"; accent = true
            case .recordingVideo: text = "записывает видео…"; accent = true
            case .choosingPhoto: text = "отправляет фото…"; accent = true
            }
        }
        header.setStatus(text, accent: accent)
    }

    private func updateSettingsUI() {
        header.setMuted(store.settings.isMuted)
        updateStatus()
        header.moreButton.menu = makeMoreMenu()
        header.moreButton.showsMenuAsPrimaryAction = true
    }

    // MARK: Действия

    private func configureActions() {
        header.messageButton.addAction(UIAction { [weak self] _ in
            self?.navigationController?.popViewController(animated: true)
        }, for: .touchUpInside)
        header.muteButton.addAction(UIAction { [weak self] _ in self?.toggleMute() }, for: .touchUpInside)
        header.searchButton.addAction(UIAction { [weak self] _ in self?.searchTapped() }, for: .touchUpInside)
    }

    private func toggleMute() {
        store.updateSettings { $0.isMuted.toggle() }
        Haptics.selection()
        updateSettingsUI()
        reloadSettingsSection()
        Toast.show(
            store.settings.isMuted ? "Уведомления выключены" : "Уведомления включены",
            icon: store.settings.isMuted ? "bell.slash" : "bell", in: view, bottomInset: view.safeAreaInsets.bottom + 8
        )
    }

    private func searchTapped() {
        let onSearch = self.onSearch
        popToChat { onSearch?() }
    }

    /// Вернуться в чат и выполнить действие, когда переход закончится.
    private func popToChat(then action: @escaping () -> Void) {
        guard let navigation = navigationController else { return action() }
        navigation.popViewController(animated: true)
        if let coordinator = navigation.transitionCoordinator {
            coordinator.animate(alongsideTransition: nil) { context in
                if !context.isCancelled { action() }
            }
        } else {
            action()
        }
    }

    private func setBlocked(_ blocked: Bool) {
        store.updateSettings { $0.isBlocked = blocked }
        if blocked { MockChatService.shared.stopTyping() }
        Haptics.success()
        updateSettingsUI()
        reloadSettingsSection()
        Toast.show(
            blocked ? "\(store.peer.firstName) заблокирован(а)" : "\(store.peer.firstName) разблокирован(а)",
            icon: blocked ? "hand.raised.fill" : "hand.raised.slash", in: view, bottomInset: view.safeAreaInsets.bottom + 8
        )
    }

    private func confirmBlock() {
        if store.settings.isBlocked {
            setBlocked(false)
            return
        }
        let alert = UIAlertController(
            title: "Заблокировать \(store.peer.firstName)?",
            message: "\(store.peer.firstName) не сможет писать вам и не увидит, когда вы в сети.",
            preferredStyle: .actionSheet
        )
        alert.addAction(UIAlertAction(title: "Заблокировать", style: .destructive) { [weak self] _ in self?.setBlocked(true) })
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        alert.popoverPresentationController?.sourceView = header.moreButton
        present(alert, animated: true)
    }

    private func makeMoreMenu() -> UIMenu {
        let blocked = store.settings.isBlocked
        return UIMenu(children: [
            UIAction(title: "Поделиться контактом", image: UIImage(systemName: "square.and.arrow.up")) { [weak self] _ in
                guard let self else { return }
                let peer = self.store.peer
                let share = UIActivityViewController(activityItems: ["\(peer.displayName)\n\(peer.phone)\n@\(peer.username)"], applicationActivities: nil)
                share.popoverPresentationController?.sourceView = self.header.moreButton
                self.present(share, animated: true)
            },
            UIAction(title: "Очистить историю", image: UIImage(systemName: "trash")) { [weak self] _ in self?.confirmClearHistory() },
            UIAction(
                title: blocked ? "Разблокировать" : "Заблокировать",
                image: UIImage(systemName: blocked ? "hand.raised.slash" : "hand.raised"),
                attributes: blocked ? [] : .destructive
            ) { [weak self] _ in self?.confirmBlock() },
        ])
    }

    private func confirmClearHistory() {
        let alert = UIAlertController(
            title: "Очистить историю?", message: "Все сообщения в этом чате будут удалены. Это действие нельзя отменить.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        alert.addAction(UIAlertAction(title: "Очистить", style: .destructive) { [weak self] _ in
            AudioPlayerService.shared.stop()
            self?.store.clearHistory()
            Haptics.success()
        })
        present(alert, animated: true)
    }

    private func copy(_ text: String, toast: String) {
        UIPasteboard.general.string = text
        Haptics.selection()
        Toast.show(toast, icon: "doc.on.doc", in: view, bottomInset: view.safeAreaInsets.bottom + 8)
    }

    private func tabChanged() {
        guard let tab = SharedMediaTab(rawValue: tabsControl.selectedSegmentIndex) else { return }
        selectedTab = tab
        Haptics.selection()
        UIView.transition(with: tableView, duration: Motion.reduceMotion ? 0 : 0.2, options: [.transitionCrossDissolve, .allowUserInteraction]) {
            self.tableView.reloadSections(IndexSet(integer: Section.shared.rawValue), with: .none)
        }
    }

    private func reloadSettingsSection() {
        UIView.performWithoutAnimation {
            tableView.reloadSections(IndexSet(integer: Section.settings.rawValue), with: .none)
        }
    }

    private func refreshVoiceRows() {
        guard selectedTab == .voice else { return }
        for case let cell as VoiceRowCell in tableView.visibleCells { cell.updatePlayback() }
    }

    private func openMessage(_ id: MessageID) {
        let onOpenMessage = self.onOpenMessage
        popToChat { onOpenMessage?(id) }
    }

    private var infoRows: [InfoRow] {
        var rows: [InfoRow] = [.phone, .username]
        if !store.peer.bio.isEmpty { rows.append(.bio) }
        return rows
    }

    private var mediaColumns: Int { 3 }

    private func sharedRowCount() -> Int {
        let count = index.count(for: selectedTab)
        guard count > 0 else { return 1 }
        if selectedTab == .media { return (count + mediaColumns - 1) / mediaColumns }
        return count
    }
}

// MARK: - Таблица

extension ProfileViewController: UITableViewDataSource, UITableViewDelegate {
    func numberOfSections(in tableView: UITableView) -> Int { Section.allCases.count }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch Section(rawValue: section)! {
        case .info: return infoRows.count
        case .settings: return 2
        case .shared: return sharedRowCount()
        }
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        switch Section(rawValue: indexPath.section)! {
        case .info:
            return infoCell(infoRows[indexPath.row], indexPath: indexPath)
        case .settings:
            return settingsCell(indexPath)
        case .shared:
            return sharedCell(indexPath)
        }
    }

    private func infoCell(_ row: InfoRow, indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
        var content = UIListContentConfiguration.subtitleCell()
        content.textProperties.font = .systemFont(ofSize: 13)
        content.textProperties.color = .secondaryLabel
        content.secondaryTextProperties.font = .systemFont(ofSize: 17)
        content.secondaryTextProperties.color = .label
        content.textToSecondaryTextVerticalPadding = 2
        switch row {
        case .phone:
            content.text = "мобильный"
            content.secondaryText = store.peer.phone
            content.secondaryTextProperties.color = Palette.accent
            cell.accessibilityIdentifier = "profile.phone"
        case .username:
            content.text = "имя пользователя"
            content.secondaryText = "@\(store.peer.username)"
            content.secondaryTextProperties.color = Palette.accent
            cell.accessibilityIdentifier = "profile.username"
        case .bio:
            content.text = "о себе"
            content.secondaryText = store.peer.bio
            content.secondaryTextProperties.numberOfLines = 0
            cell.accessibilityIdentifier = "profile.bio"
        }
        cell.contentConfiguration = content
        cell.selectionStyle = row == .bio ? .none : .default
        cell.accessoryType = .none
        cell.accessoryView = nil
        return cell
    }

    private func settingsCell(_ indexPath: IndexPath) -> UITableViewCell {
        if indexPath.row == 0 {
            let cell = tableView.dequeueReusableCell(withIdentifier: SwitchRowCell.reuseId, for: indexPath) as! SwitchRowCell
            cell.configure(title: "Уведомления", isOn: !store.settings.isMuted) { [weak self] isOn in
                guard let self, self.store.settings.isMuted == isOn else { return }
                self.store.updateSettings { $0.isMuted = !isOn }
                self.updateSettingsUI()
                Haptics.selection()
            }
            cell.toggle.accessibilityIdentifier = "profile.notifications"
            return cell
        }
        let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
        var content = cell.defaultContentConfiguration()
        let blocked = store.settings.isBlocked
        content.text = blocked ? "Разблокировать" : "Заблокировать"
        content.textProperties.color = blocked ? Palette.accent : Palette.destructive
        cell.contentConfiguration = content
        cell.accessibilityIdentifier = "profile.block"
        cell.accessibilityValue = blocked ? "заблокирован" : nil
        cell.accessoryView = nil
        cell.accessoryType = .none
        cell.selectionStyle = .default
        return cell
    }

    private func sharedCell(_ indexPath: IndexPath) -> UITableViewCell {
        guard index.count(for: selectedTab) > 0 else {
            let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
            var content = cell.defaultContentConfiguration()
            content.text = selectedTab.emptyText
            content.textProperties.color = .secondaryLabel
            content.textProperties.font = .systemFont(ofSize: 15)
            content.textProperties.alignment = .center
            cell.contentConfiguration = content
            cell.selectionStyle = .none
            cell.accessoryView = nil
            cell.accessoryType = .none
            cell.accessibilityIdentifier = "profile.shared.empty"
            return cell
        }
        switch selectedTab {
        case .media:
            let cell = tableView.dequeueReusableCell(withIdentifier: MediaGridRowCell.reuseId, for: indexPath) as! MediaGridRowCell
            let start = indexPath.row * mediaColumns
            let items = Array(index.media[start..<min(index.media.count, start + mediaColumns)])
            cell.configure(items, columns: mediaColumns) { [weak self] id in self?.openMessage(id) }
            return cell
        case .files:
            let message = index.files[indexPath.row]
            let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
            var content = cell.defaultContentConfiguration()
            let media = message.kind.media
            content.image = UIImage(systemName: "doc.fill")
            content.imageProperties.tintColor = Palette.accent
            content.text = media?.fileName ?? "Файл"
            content.textProperties.lineBreakMode = .byTruncatingMiddle
            content.secondaryText = "\(MessageLayoutEngine.formatFileSize(media?.fileSize ?? 0)) · \(Self.rowDateFormatter.string(from: message.date))"
            content.secondaryTextProperties.color = .secondaryLabel
            cell.contentConfiguration = content
            cell.accessoryType = .none
            cell.accessoryView = nil
            cell.selectionStyle = .default
            cell.accessibilityIdentifier = "profile.file.\(message.id)"
            return cell
        case .links:
            let link = index.links[indexPath.row]
            let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
            var content = cell.defaultContentConfiguration()
            content.image = UIImage(systemName: "link")
            content.imageProperties.tintColor = Palette.accent
            content.text = link.url.host() ?? link.url.absoluteString
            content.secondaryText = link.url.absoluteString
            content.secondaryTextProperties.color = Palette.accent
            content.secondaryTextProperties.numberOfLines = 1
            cell.contentConfiguration = content
            cell.accessoryType = .none
            cell.accessoryView = nil
            cell.selectionStyle = .default
            cell.accessibilityIdentifier = "profile.link.\(indexPath.row)"
            return cell
        case .voice:
            let message = index.voice[indexPath.row]
            let cell = tableView.dequeueReusableCell(withIdentifier: VoiceRowCell.reuseId, for: indexPath) as! VoiceRowCell
            cell.configure(
                message: message, authorName: message.isOutgoing ? "Вы" : store.peer.firstName,
                date: Self.rowDateFormatter.string(from: message.date)
            ) { id, file in AudioPlayerService.shared.toggle(messageId: id, file: file) }
            return cell
        }
    }

    func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat {
        guard Section(rawValue: indexPath.section) == .shared, selectedTab == .media, index.count(for: .media) > 0 else {
            return UITableView.automaticDimension
        }
        return MediaGridRowCell.height(forWidth: tableView.bounds.width - tableView.layoutMargins.left - tableView.layoutMargins.right, columns: mediaColumns)
    }

    func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
        guard Section(rawValue: section) == .shared else { return nil }
        let container = UIView()
        container.addSubview(tabsControl)
        tabsControl.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            tabsControl.leadingAnchor.constraint(equalTo: container.layoutMarginsGuide.leadingAnchor),
            tabsControl.trailingAnchor.constraint(equalTo: container.layoutMarginsGuide.trailingAnchor),
            tabsControl.topAnchor.constraint(equalTo: container.topAnchor, constant: 8),
            tabsControl.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -8),
        ])
        return container
    }

    func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat {
        Section(rawValue: section) == .shared ? 48 : (section == 0 ? 8 : 20)
    }

    func tableView(_ tableView: UITableView, shouldHighlightRowAt indexPath: IndexPath) -> Bool {
        switch Section(rawValue: indexPath.section)! {
        case .info: return infoRows[indexPath.row] != .bio
        case .settings: return indexPath.row == 1
        case .shared: return index.count(for: selectedTab) > 0 && selectedTab != .media && selectedTab != .voice
        }
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch Section(rawValue: indexPath.section)! {
        case .info:
            switch infoRows[indexPath.row] {
            case .phone: presentPhoneActions(from: tableView.cellForRow(at: indexPath))
            case .username: copy("@\(store.peer.username)", toast: "Имя пользователя скопировано")
            case .bio: break
            }
        case .settings:
            if indexPath.row == 1 { confirmBlock() }
        case .shared:
            guard index.count(for: selectedTab) > 0 else { return }
            switch selectedTab {
            case .files:
                let message = index.files[indexPath.row]
                guard let media = message.kind.media, MediaStorage.exists(media.file) else {
                    Toast.show("Файл ещё готовится", icon: "hourglass", in: view, bottomInset: view.safeAreaInsets.bottom + 8)
                    return
                }
                present(FilePreviewController(url: MediaStorage.url(for: media.file), title: media.fileName).controller, animated: true)
            case .links:
                let safari = SFSafariViewController(url: index.links[indexPath.row].url)
                present(safari, animated: true)
            case .media, .voice:
                break
            }
        }
    }

    /// Долгое нажатие на телефон/имя — «Копировать».
    func tableView(_ tableView: UITableView, contextMenuConfigurationForRowAt indexPath: IndexPath, point: CGPoint) -> UIContextMenuConfiguration? {
        switch Section(rawValue: indexPath.section)! {
        case .info:
            let row = infoRows[indexPath.row]
            let value: String
            switch row {
            case .phone: value = store.peer.phone
            case .username: value = "@\(store.peer.username)"
            case .bio: value = store.peer.bio
            }
            return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
                UIMenu(children: [UIAction(title: "Копировать", image: UIImage(systemName: "doc.on.doc")) { [weak self] _ in
                    self?.copy(value, toast: row == .phone ? "Номер скопирован" : "Скопировано")
                }])
            }
        case .shared where selectedTab == .links && index.count(for: .links) > 0:
            let link = index.links[indexPath.row]
            return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
                UIMenu(children: [
                    UIAction(title: "Копировать ссылку", image: UIImage(systemName: "doc.on.doc")) { [weak self] _ in
                        self?.copy(link.url.absoluteString, toast: "Ссылка скопирована")
                    },
                    UIAction(title: "Показать в чате", image: UIImage(systemName: "bubble.left")) { [weak self] _ in
                        self?.openMessage(link.messageId)
                    },
                ])
            }
        case .shared where selectedTab == .files && index.count(for: .files) > 0:
            let message = index.files[indexPath.row]
            return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
                UIMenu(children: [UIAction(title: "Показать в чате", image: UIImage(systemName: "bubble.left")) { [weak self] _ in
                    self?.openMessage(message.id)
                }])
            }
        default:
            return nil
        }
    }

    private func presentPhoneActions(from cell: UITableViewCell?) {
        let phone = store.peer.phone
        let sheet = UIAlertController(title: phone, message: "Номер вымышленный: звонок и SMS в демо недоступны.", preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "Копировать номер", style: .default) { [weak self] _ in
            self?.copy(phone, toast: "Номер скопирован")
        })
        sheet.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        sheet.popoverPresentationController?.sourceView = cell ?? view
        present(sheet, animated: true)
    }

    // MARK: Сжатие шапки

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        let offset = scrollView.contentOffset.y + scrollView.adjustedContentInset.top
        // Аватар уходит под панель за первые ~110 pt прокрутки.
        let progress = offset / (ProfileHeaderView.avatarSize + 10)
        if avatarTransition == nil { header.setCollapse(progress: progress) }
        let titleShown = offset > ProfileHeaderView.avatarSize + 50
        if (titleLabel.alpha > 0.5) != titleShown {
            Motion.fade(duration: 0.2) { self.titleLabel.alpha = titleShown ? 1 : 0 }
        }
    }
}

// MARK: - Ячейки

/// Строка сетки медиа: 3 квадратные плитки через 2 pt.
final class MediaGridRowCell: UITableViewCell {
    static let reuseId = "MediaGridRowCell"
    static let spacing: CGFloat = 2

    private var tiles: [UIImageView] = []
    private var badges: [UILabel] = []
    private var ids: [MessageID] = []
    private var files: [String?] = []
    private var onTap: ((MessageID) -> Void)?
    private var columns = 3

    static func height(forWidth width: CGFloat, columns: Int) -> CGFloat {
        floor((width - spacing * CGFloat(columns - 1)) / CGFloat(columns)) + spacing
    }

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        backgroundColor = .clear
        contentView.backgroundColor = .clear
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(_ messages: [Message], columns: Int, onTap: @escaping (MessageID) -> Void) {
        self.columns = columns
        self.onTap = onTap
        while tiles.count < columns {
            let tile = UIImageView()
            tile.contentMode = .scaleAspectFill
            tile.clipsToBounds = true
            tile.backgroundColor = .secondarySystemFill
            tile.isUserInteractionEnabled = true
            tile.isAccessibilityElement = true
            tile.accessibilityTraits = .button
            tile.accessibilityIdentifier = "profile.media.cell"
            tile.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tileTapped(_:))))
            contentView.addSubview(tile)
            tiles.append(tile)
            let badge = UILabel()
            badge.font = .systemFont(ofSize: 11, weight: .semibold)
            badge.textColor = .white
            badge.backgroundColor = UIColor.black.withAlphaComponent(0.45)
            badge.textAlignment = .center
            badge.layer.cornerRadius = 8
            badge.layer.masksToBounds = true
            tile.addSubview(badge)
            badges.append(badge)
        }
        ids = messages.map(\.id)
        files = messages.map { $0.kind.media?.file }
        for (index, tile) in tiles.enumerated() {
            guard index < messages.count, let media = messages[index].kind.media else {
                tile.isHidden = true
                continue
            }
            tile.isHidden = false
            tile.tag = index
            let kind = messages[index].kind
            let badge = badges[index]
            switch kind {
            case .video:
                badge.text = MessageLayoutEngine.formatDuration(media.duration)
                badge.isHidden = false
                tile.accessibilityLabel = "Видео"
            case .gif:
                badge.text = "GIF"
                badge.isHidden = false
                tile.accessibilityLabel = "GIF"
            default:
                badge.isHidden = true
                tile.accessibilityLabel = "Фотография"
            }
            tile.image = nil
            guard MediaStorage.exists(media.file) else { continue }
            let source: ImagePipeline.Source
            switch kind {
            case .video: source = .videoFrame(media.file)
            case .gif: source = .gifPoster(media.file)
            default: source = .photo(media.file)
            }
            let file = media.file
            let size = CGSize(width: 130, height: 130)
            if let image = ImagePipeline.shared.load(source, pointSize: size, completion: { [weak self, weak tile] image in
                guard let self, let tile, index < self.files.count, self.files[index] == file else { return }
                tile.image = image
            }) {
                tile.image = image
            }
        }
        setNeedsLayout()
    }

    @objc private func tileTapped(_ gesture: UITapGestureRecognizer) {
        guard let tile = gesture.view, tile.tag < ids.count else { return }
        Haptics.selection()
        onTap?(ids[tile.tag])
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let spacing = Self.spacing
        let side = floor((contentView.bounds.width - spacing * CGFloat(columns - 1)) / CGFloat(columns))
        for (index, tile) in tiles.enumerated() {
            tile.frame = CGRect(x: CGFloat(index) * (side + spacing), y: 0, width: side, height: side)
            let badge = badges[index]
            let width = ((badge.text ?? "") as NSString).size(withAttributes: [.font: badge.font!]).width + 10
            badge.frame = CGRect(x: side - width - 4, y: side - 20, width: width, height: 16)
        }
    }
}

/// Строка голосового/кружка во вкладке «Голосовые».
final class VoiceRowCell: UITableViewCell {
    static let reuseId = "VoiceRowCell"

    private let playButton = UIButton(type: .custom)
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let durationLabel = UILabel()
    private var messageId: MessageID = 0
    private var file = ""
    private var duration: Double = 0
    private var onToggle: ((MessageID, String) -> Void)?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        playButton.backgroundColor = Palette.accent
        playButton.tintColor = .white
        playButton.layer.cornerRadius = 20
        playButton.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.onToggle?(self.messageId, self.file)
        }, for: .touchUpInside)
        contentView.addSubview(playButton)
        titleLabel.font = .systemFont(ofSize: 16, weight: .medium)
        subtitleLabel.font = .systemFont(ofSize: 13)
        subtitleLabel.textColor = .secondaryLabel
        durationLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
        durationLabel.textColor = .secondaryLabel
        durationLabel.textAlignment = .right
        contentView.addSubview(titleLabel)
        contentView.addSubview(subtitleLabel)
        contentView.addSubview(durationLabel)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(message: Message, authorName: String, date: String, onToggle: @escaping (MessageID, String) -> Void) {
        messageId = message.id
        file = message.kind.media?.file ?? ""
        duration = message.kind.media?.duration ?? 0
        self.onToggle = onToggle
        if case .videoNote = message.kind {
            titleLabel.text = "Видеосообщение"
        } else {
            titleLabel.text = "Голосовое сообщение"
        }
        subtitleLabel.text = "\(authorName) · \(date)"
        playButton.accessibilityIdentifier = "profile.voice.play.\(message.id)"
        accessibilityIdentifier = "profile.voice.\(message.id)"
        updatePlayback()
    }

    func updatePlayback() {
        let player = AudioPlayerService.shared
        let playing = player.isPlaying(messageId)
        let configuration = UIImage.SymbolConfiguration(pointSize: 16, weight: .bold)
        playButton.setImage(UIImage(systemName: playing ? "pause.fill" : "play.fill", withConfiguration: configuration), for: .normal)
        playButton.accessibilityLabel = playing ? "Пауза" : "Воспроизвести"
        let shown = player.currentId == messageId ? player.currentTime : duration
        durationLabel.text = MessageLayoutEngine.formatDuration(shown)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let bounds = contentView.bounds
        playButton.frame = CGRect(x: 16, y: (bounds.height - 40) / 2, width: 40, height: 40)
        durationLabel.frame = CGRect(x: bounds.width - 66, y: 0, width: 50, height: bounds.height)
        titleLabel.frame = CGRect(x: 68, y: 10, width: bounds.width - 140, height: 20)
        subtitleLabel.frame = CGRect(x: 68, y: 31, width: bounds.width - 140, height: 18)
    }

    override func sizeThatFits(_ size: CGSize) -> CGSize { CGSize(width: size.width, height: 60) }

    override func systemLayoutSizeFitting(
        _ targetSize: CGSize, withHorizontalFittingPriority horizontalFittingPriority: UILayoutPriority,
        verticalFittingPriority: UILayoutPriority
    ) -> CGSize {
        CGSize(width: targetSize.width, height: 60)
    }
}

/// Строка с переключателем («Уведомления»).
final class SwitchRowCell: UITableViewCell {
    static let reuseId = "SwitchRowCell"

    let toggle = UISwitch()
    private var onChange: ((Bool) -> Void)?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        accessoryView = toggle
        toggle.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.onChange?(self.toggle.isOn)
        }, for: .valueChanged)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(title: String, isOn: Bool, onChange: @escaping (Bool) -> Void) {
        var content = defaultContentConfiguration()
        content.text = title
        contentConfiguration = content
        toggle.isOn = isOn
        toggle.accessibilityLabel = title
        self.onChange = onChange
    }
}
