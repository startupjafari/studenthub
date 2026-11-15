import UIKit

// MARK: - Навигация

/// Навигация приложения: «Чаты» → переписка → профиль. Переходы — системные, чтобы на iOS 26
/// работал свайп назад с любого места экрана (`interactiveContentPopGestureRecognizer`),
/// как в Telegram. Крупный заголовок — только у списка чатов.
final class ChatNavigationController: UINavigationController, UINavigationControllerDelegate {
    override init(rootViewController: UIViewController) {
        super.init(rootViewController: rootViewController)
        configure()
    }

    override init(nibName nibNameOrNil: String?, bundle nibBundleOrNil: Bundle?) {
        super.init(nibName: nibNameOrNil, bundle: nibBundleOrNil)
        configure()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func configure() {
        delegate = self
        navigationBar.prefersLargeTitles = true
        navigationBar.tintColor = Palette.accent
        view.accessibilityIdentifier = "navigation"
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.isEnabled = true
        interactiveContentPopGestureRecognizer?.isEnabled = true
    }

    override func pushViewController(_ viewController: UIViewController, animated: Bool) {
        if !(viewController is ChatListViewController) {
            viewController.navigationItem.largeTitleDisplayMode = .never
        }
        super.pushViewController(viewController, animated: animated)
    }

    func navigationController(_ navigationController: UINavigationController, willShow viewController: UIViewController, animated: Bool) {
        if !(viewController is ChatListViewController) {
            viewController.navigationItem.largeTitleDisplayMode = .never
        }
    }

    override var childForStatusBarStyle: UIViewController? { topViewController }
}

// MARK: - Список чатов

/// «Чаты» в стиле Telegram: живая строка переписки с Алиной (последнее сообщение, время,
/// галочки, непрочитанные, «печатает…», без звука, закреп) и демонстрационные чаты —
/// получатели пересылки.
final class ChatListViewController: UIViewController {
    /// Демонстрационные чаты: те же получатели, что в «Переслать». Счётчик пересланного
    /// хранится в `ChatState.forwardedCounts` по этим id.
    static let demoChats: [ForwardTarget] = [
        ForwardTarget(id: 1001, name: "Избранное", subtitle: "Сохранённые сообщения", isCurrentChat: false),
        ForwardTarget(id: 1002, name: "Мама", subtitle: "Позвони, как освободишься ❤️", isCurrentChat: false),
        ForwardTarget(id: 1003, name: "Илья Петров", subtitle: "Ок, тогда в пятницу", isCurrentChat: false),
        ForwardTarget(id: 1004, name: "Команда проекта", subtitle: "Андрей: макеты обновил, гляньте", isCurrentChat: false),
        ForwardTarget(id: 1005, name: "Городские новости", subtitle: "Завтра в городе до +18, без осадков", isCurrentChat: false),
    ]

    private enum Row: Hashable {
        case peer
        case demo(Int64)
    }

    private let store: ChatStore
    private let tableView = UITableView(frame: .zero, style: .plain)
    private let searchController = UISearchController(searchResultsController: nil)
    private var rows: [Row] = []
    private var query = ""
    private var storeToken: ObservationToken?
    private var presenceToken: ObservationToken?
    private var presence: PeerPresence = .online

    private let defaults = UserDefaults.standard
    private var lastReadId: MessageID {
        get { MessageID(defaults.integer(forKey: "chatList.lastReadId")) }
        set { defaults.set(Int(newValue), forKey: "chatList.lastReadId") }
    }

    private var isPeerPinned: Bool {
        get { defaults.object(forKey: "chatList.peerPinned") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "chatList.peerPinned") }
    }

    /// Демо-даты последнего сообщения в демо-чатах (вчера и раньше).
    private static let demoDates: [Int64: TimeInterval] = [1001: -3 * 86_400, 1002: -26 * 3_600, 1003: -2 * 86_400, 1004: -5 * 3_600, 1005: -9 * 3_600]

    init(store: ChatStore) {
        self.store = store
        super.init(nibName: nil, bundle: nil)
    }

    convenience init() {
        self.init(store: .shared)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Чаты"
        navigationItem.largeTitleDisplayMode = .always
        navigationItem.backButtonDisplayMode = .minimal
        view.backgroundColor = .systemBackground
        view.accessibilityIdentifier = "chatList"

        searchController.searchResultsUpdater = self
        searchController.obscuresBackgroundDuringPresentation = false
        searchController.searchBar.placeholder = "Поиск"
        searchController.searchBar.searchTextField.accessibilityIdentifier = "chatList.search"
        navigationItem.searchController = searchController
        navigationItem.hidesSearchBarWhenScrolling = true

        tableView.dataSource = self
        tableView.delegate = self
        tableView.rowHeight = 76
        tableView.separatorInset = UIEdgeInsets(top: 0, left: 84, bottom: 0, right: 0)
        tableView.register(ChatListCell.self, forCellReuseIdentifier: ChatListCell.reuseId)
        tableView.accessibilityIdentifier = "chatList.table"
        tableView.keyboardDismissMode = .onDrag
        view.addSubview(tableView)

        if lastReadId == 0 { lastReadId = store.lastMessage?.id ?? 0 }
        rebuildRows()

        storeToken = store.observe { [weak self] change in self?.storeDidChange(change) }
        presenceToken = MockChatService.shared.observePresence { [weak self] presence in
            guard let self else { return }
            self.presence = presence
            self.reloadPeerRow()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        tableView.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Вернулись из переписки: всё, что в ней было, прочитано.
        markAllRead()
        rebuildRows()
        tableView.reloadData()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        markAllRead()
    }

    // MARK: Данные

    private var isChatOnTop: Bool {
        navigationController?.topViewController is ChatViewController
            || navigationController?.topViewController is ProfileViewController
    }

    private func markAllRead() {
        lastReadId = store.lastMessage?.id ?? 0
    }

    private var unreadCount: Int {
        let lastRead = lastReadId
        var count = 0
        for message in store.messages.reversed() {
            guard message.id > lastRead else { break }
            if message.author == .peer, !message.isService { count += 1 }
        }
        return count
    }

    private func storeDidChange(_ change: ChatChange) {
        if change.isReset { lastReadId = store.lastMessage?.id ?? 0 }
        if isChatOnTop { markAllRead() }
        guard isViewLoaded else { return }
        if change.reason == .forward {
            rebuildRows()
            tableView.reloadData()
        } else {
            reloadPeerRow()
        }
    }

    private func rebuildRows() {
        var all: [Row] = [.peer] + Self.demoChats.map { .demo($0.id) }
        if !isPeerPinned {
            // Без закрепа — по дате последнего сообщения (наш чат почти всегда самый свежий).
            all.sort { date(of: $0) > date(of: $1) }
        }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else {
            rows = all
            return
        }
        rows = all.filter { row in
            let (title, preview) = texts(for: row)
            return title.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil
                || preview.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil
        }
    }

    private func date(of row: Row) -> Date {
        switch row {
        case .peer: return store.lastMessage?.date ?? .distantPast
        case let .demo(id): return Date().addingTimeInterval(Self.demoDates[id] ?? -86_400)
        }
    }

    private func texts(for row: Row) -> (String, String) {
        switch row {
        case .peer:
            return (store.peer.displayName, peerPreview().text)
        case let .demo(id):
            let target = Self.demoChats.first { $0.id == id }
            return (target?.name ?? "", demoPreview(id))
        }
    }

    private func demoPreview(_ id: Int64) -> String {
        let forwarded = store.state.forwardedCounts[id] ?? 0
        if forwarded > 0 { return "Переслано сообщений: \(forwarded)" }
        return Self.demoChats.first { $0.id == id }?.subtitle ?? ""
    }

    /// Превью последнего сообщения: «Вы: …», тип медиа, «печатает…».
    private func peerPreview() -> (text: String, isActivity: Bool) {
        if !store.settings.isBlocked, presence.isActivity {
            switch presence {
            case .recordingVoice: return ("записывает аудио…", true)
            case .recordingVideo: return ("записывает видео…", true)
            case .choosingPhoto: return ("отправляет фото…", true)
            default: return ("печатает…", true)
            }
        }
        guard let last = store.messages.last(where: { !$0.isService }) ?? store.lastMessage else {
            return ("История очищена", false)
        }
        var text = last.previewText.replacingOccurrences(of: "\n", with: " ")
        if !last.text.isEmpty, last.kind.media != nil {
            text = "\(last.kind.shortDescription), \(text)"
        }
        if last.forward != nil { text = "Пересланное: \(text)" }
        return (last.isOutgoing ? "Вы: \(text)" : text, false)
    }

    private func reloadPeerRow() {
        guard isViewLoaded else { return }
        if !query.isEmpty || !isPeerPinned {
            rebuildRows()
            tableView.reloadData()
            return
        }
        guard let index = rows.firstIndex(of: .peer) else { return }
        let indexPath = IndexPath(row: index, section: 0)
        if let cell = tableView.cellForRow(at: indexPath) as? ChatListCell {
            configure(cell, row: .peer)
        }
    }

    private func configure(_ cell: ChatListCell, row: Row) {
        switch row {
        case .peer:
            let preview = peerPreview()
            let last = store.lastMessage
            cell.configure(
                avatar: store.peer, title: store.peer.displayName, preview: preview.text, previewIsAccent: preview.isActivity,
                time: last.map { Self.listTime($0.date) } ?? "", outgoingStatus: last?.isOutgoing == true ? last?.status : nil,
                unread: unreadCount, muted: store.settings.isMuted, pinned: isPeerPinned
            )
            cell.accessibilityIdentifier = "chatList.row.alina"
        case let .demo(id):
            let target = Self.demoChats.first { $0.id == id }!
            let peer = Peer(id: id, firstName: target.name, lastName: "", username: "", phone: "", bio: "", avatarFile: nil)
            cell.configure(
                avatar: peer, title: target.name, preview: demoPreview(id), previewIsAccent: false,
                time: Self.listTime(date(of: row)), outgoingStatus: (store.state.forwardedCounts[id] ?? 0) > 0 ? .read : nil,
                unread: 0, muted: false, pinned: false
            )
            cell.accessibilityIdentifier = "chatList.row.\(target.name)"
        }
    }

    private static let weekdayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "EE"
        return formatter
    }()

    private static let shortDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "dd.MM.yy"
        return formatter
    }()

    /// Время в списке: сегодня — «14:05», на этой неделе — «пн», раньше — «03.11.26».
    static func listTime(_ date: Date, now: Date = Date()) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return MessageLayoutEngine.timeFormatter.string(from: date) }
        if let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day, days < 7 {
            return weekdayFormatter.string(from: date)
        }
        return shortDateFormatter.string(from: date)
    }

    // MARK: Действия

    private func openPeerChat() {
        markAllRead()
        let chat = ChatViewController(store: store)
        navigationController?.pushViewController(chat, animated: true)
    }

    private func confirmClearHistory() {
        let alert = UIAlertController(
            title: "Удалить историю?", message: "Все сообщения в чате с \(store.peer.firstName) будут удалены.", preferredStyle: .actionSheet
        )
        alert.addAction(UIAlertAction(title: "Удалить историю", style: .destructive) { [weak self] _ in
            AudioPlayerService.shared.stop()
            self?.store.clearHistory()
            Haptics.success()
        })
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        alert.popoverPresentationController?.sourceView = tableView
        present(alert, animated: true)
    }
}

extension ChatListViewController: UITableViewDataSource, UITableViewDelegate, UISearchResultsUpdating {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: ChatListCell.reuseId, for: indexPath) as! ChatListCell
        configure(cell, row: rows[indexPath.row])
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch rows[indexPath.row] {
        case .peer:
            openPeerChat()
        case .demo:
            Toast.show("Демо-чат: доступна только переписка с \(store.peer.firstName)", icon: "info.circle", in: view, bottomInset: view.safeAreaInsets.bottom + 8)
        }
    }

    func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard rows[indexPath.row] == .peer else { return nil }
        let muted = store.settings.isMuted
        let delete = UIContextualAction(style: .destructive, title: "Удалить") { [weak self] _, _, done in
            self?.confirmClearHistory()
            done(true)
        }
        delete.image = UIImage(systemName: "trash.fill")
        let mute = UIContextualAction(style: .normal, title: muted ? "Звук" : "Без звука") { [weak self] _, _, done in
            guard let self else { return done(false) }
            self.store.updateSettings { $0.isMuted.toggle() }
            Haptics.selection()
            self.reloadPeerRow()
            done(true)
        }
        mute.image = UIImage(systemName: muted ? "bell.fill" : "bell.slash.fill")
        mute.backgroundColor = .systemOrange
        return UISwipeActionsConfiguration(actions: [delete, mute])
    }

    func tableView(_ tableView: UITableView, leadingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard rows[indexPath.row] == .peer else { return nil }
        let pinned = isPeerPinned
        let pin = UIContextualAction(style: .normal, title: pinned ? "Открепить" : "Закрепить") { [weak self] _, _, done in
            guard let self else { return done(false) }
            self.isPeerPinned.toggle()
            Haptics.selection()
            self.rebuildRows()
            self.tableView.reloadData()
            done(true)
        }
        pin.image = UIImage(systemName: pinned ? "pin.slash.fill" : "pin.fill")
        pin.backgroundColor = .systemGreen
        return UISwipeActionsConfiguration(actions: [pin])
    }

    func updateSearchResults(for searchController: UISearchController) {
        query = searchController.searchBar.text ?? ""
        rebuildRows()
        tableView.reloadData()
    }
}

// MARK: - Ячейка

final class ChatListCell: UITableViewCell {
    static let reuseId = "ChatListCell"

    private let avatarView = AvatarView()
    private let titleLabel = UILabel()
    private let previewLabel = UILabel()
    private let timeLabel = UILabel()
    private let statusView = MessageStatusView()
    private let badgeLabel = UILabel()
    private let mutedIcon = UIImageView(image: UIImage(systemName: "speaker.slash.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 11)))
    private let pinIcon = UIImageView(image: UIImage(systemName: "pin.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 12)))
    private var showsStatus = false
    private var isMuted = false

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        contentView.addSubview(avatarView)
        titleLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        previewLabel.font = .systemFont(ofSize: 15)
        previewLabel.numberOfLines = 2
        previewLabel.textColor = .secondaryLabel
        timeLabel.font = .systemFont(ofSize: 14)
        timeLabel.textColor = .secondaryLabel
        timeLabel.textAlignment = .right
        badgeLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        badgeLabel.textColor = .white
        badgeLabel.textAlignment = .center
        badgeLabel.layer.cornerRadius = 10
        badgeLabel.layer.masksToBounds = true
        mutedIcon.tintColor = .tertiaryLabel
        pinIcon.tintColor = .tertiaryLabel
        pinIcon.contentMode = .center
        [titleLabel, previewLabel, timeLabel, statusView, badgeLabel, mutedIcon, pinIcon].forEach(contentView.addSubview)
        isAccessibilityElement = true
        accessibilityTraits = .button
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(
        avatar: Peer, title: String, preview: String, previewIsAccent: Bool, time: String,
        outgoingStatus: DeliveryStatus?, unread: Int, muted: Bool, pinned: Bool
    ) {
        avatarView.configure(peer: avatar)
        titleLabel.text = title
        previewLabel.text = preview
        previewLabel.textColor = previewIsAccent ? Palette.accent : .secondaryLabel
        timeLabel.text = time
        showsStatus = outgoingStatus != nil && outgoingStatus != .failed
        statusView.isHidden = !showsStatus
        if let outgoingStatus {
            statusView.configure(text: "", status: outgoingStatus, outgoing: true, placement: .inline, animated: false)
        }
        isMuted = muted
        badgeLabel.isHidden = unread == 0
        badgeLabel.text = unread > 99 ? "99+" : "\(unread)"
        badgeLabel.backgroundColor = muted ? .systemGray2 : Palette.accent
        mutedIcon.isHidden = !muted
        pinIcon.isHidden = !pinned || unread > 0
        accessibilityLabel = title
        var value = [preview, time]
        if unread > 0 { value.append("непрочитанных: \(unread)") }
        if muted { value.append("без звука") }
        if pinned { value.append("закреплён") }
        accessibilityValue = value.joined(separator: ", ")
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let bounds = contentView.bounds
        avatarView.frame = CGRect(x: 12, y: (bounds.height - 60) / 2, width: 60, height: 60)
        let timeWidth = ceil(timeLabel.sizeThatFits(bounds.size).width)
        timeLabel.frame = CGRect(x: bounds.width - 16 - timeWidth, y: 10, width: timeWidth, height: 20)
        var right = timeLabel.frame.minX - 4
        if showsStatus {
            statusView.frame = CGRect(x: right - BubbleMetrics.checksWidth, y: 13, width: BubbleMetrics.checksWidth, height: 14)
            right = statusView.frame.minX - 4
        }
        let titleX: CGFloat = 84
        var titleWidth = right - titleX
        if !mutedIcon.isHidden {
            let natural = ceil(titleLabel.sizeThatFits(bounds.size).width)
            titleWidth = min(titleWidth - 18, natural)
            mutedIcon.frame = CGRect(x: titleX + titleWidth + 4, y: 14, width: 14, height: 13)
        }
        titleLabel.frame = CGRect(x: titleX, y: 9, width: max(0, titleWidth), height: 22)
        let badgeWidth: CGFloat = badgeLabel.isHidden ? 0 : max(20, ceil(badgeLabel.sizeThatFits(bounds.size).width) + 12)
        badgeLabel.frame = CGRect(x: bounds.width - 16 - badgeWidth, y: 40, width: badgeWidth, height: 20)
        pinIcon.frame = CGRect(x: bounds.width - 16 - 20, y: 40, width: 20, height: 20)
        let previewRight = !badgeLabel.isHidden ? badgeLabel.frame.minX - 8 : (!pinIcon.isHidden ? pinIcon.frame.minX - 8 : bounds.width - 16)
        previewLabel.frame = CGRect(x: titleX, y: 31, width: previewRight - titleX, height: 38)
    }
}
