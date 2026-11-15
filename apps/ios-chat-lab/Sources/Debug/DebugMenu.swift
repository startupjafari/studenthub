import UIKit

/// Скрываемое меню управления моковыми событиями.
///
/// Как открыть:
/// - «Ещё» (⋯) в шапке чата → «Debug Menu»;
/// - долгое нажатие тремя пальцами в любом месте (0,6 с).
///
/// Встряхивание не используется намеренно: событие встряски уходит первому ответчику и по
/// цепочке до `UIApplication`, перехватить его без подкласса окна нельзя, а окно создаёт
/// `SceneDelegate` (обычный `UIWindow`). Жест тремя пальцами не конфликтует ни с лентой,
/// ни со свайпами.
@MainActor
enum DebugMenu {
    private static weak var presented: UIViewController?

    static func present(from controller: UIViewController) {
        guard presented == nil else { return }
        let menu = DebugMenuViewController()
        let navigation = UINavigationController(rootViewController: menu)
        navigation.modalPresentationStyle = .pageSheet
        if let sheet = navigation.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        navigation.view.accessibilityIdentifier = "debug.sheet"
        presented = navigation
        topmost(from: controller).present(navigation, animated: true)
    }

    static func installShakeTrigger(in window: UIWindow) {
        let recognizer = UILongPressGestureRecognizer(target: TriggerTarget.shared, action: #selector(TriggerTarget.handle(_:)))
        recognizer.numberOfTouchesRequired = 3
        recognizer.minimumPressDuration = 0.6
        recognizer.cancelsTouchesInView = false
        recognizer.delaysTouchesBegan = false
        window.addGestureRecognizer(recognizer)
    }

    fileprivate static func topmost(from controller: UIViewController) -> UIViewController {
        var top = controller
        while let presented = top.presentedViewController, !presented.isBeingDismissed { top = presented }
        return top
    }

    private final class TriggerTarget: NSObject {
        static let shared = TriggerTarget()

        @objc func handle(_ recognizer: UILongPressGestureRecognizer) {
            MainActor.assumeIsolated {
                guard recognizer.state == .began, let root = recognizer.view?.window?.rootViewController ?? (recognizer.view as? UIWindow)?.rootViewController else { return }
                Haptics.impactMedium()
                DebugMenu.present(from: root)
            }
        }
    }
}

/// Таблица действий. Разовые действия закрывают меню, чтобы результат сразу был виден в ленте;
/// переключатели меню не закрывают.
final class DebugMenuViewController: UITableViewController {
    private enum Row {
        case action(key: String, title: String, icon: String, destructive: Bool, closes: Bool, run: @MainActor () -> Void)
        case toggle(key: String, title: String, icon: String, get: @MainActor () -> Bool, set: @MainActor (Bool) -> Void)
    }

    private struct Section {
        var title: String
        var footer: String?
        var rows: [Row]
    }

    private var sections: [Section] = []
    private var mock: MockChatService { .shared }
    private var store: ChatStore { .shared }

    init() {
        super.init(style: .insetGrouped)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Debug Menu"
        navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in
            self?.dismiss(animated: true)
        })
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "debug.close"
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        tableView.accessibilityIdentifier = "debug.table"
        buildSections()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        buildSections()
        tableView.reloadData()
    }

    private func buildSections() {
        sections = [
            Section(title: "Собеседник", footer: nil, rows: [
                .action(key: "receiveOne", title: "Получить сообщение", icon: "envelope", destructive: false, closes: true) { MockChatService.shared.receiveOne() },
                .action(key: "receive10", title: "Получить 10 сообщений", icon: "tray.full", destructive: false, closes: true) { MockChatService.shared.receive(count: 10) },
                .action(key: "typing", title: mock.isTyping ? "Остановить печать" : "Начать печать", icon: "ellipsis.bubble", destructive: false, closes: true) {
                    MockChatService.shared.toggleTyping()
                },
                .action(key: "receivePhoto", title: "Получить фото", icon: "photo", destructive: false, closes: true) { MockChatService.shared.receivePhoto() },
                .action(key: "receiveVoice", title: "Получить голосовое", icon: "waveform", destructive: false, closes: true) { MockChatService.shared.receiveVoice() },
                .action(key: "receiveVideoNote", title: "Получить кружок", icon: "video.circle", destructive: false, closes: true) { MockChatService.shared.receiveVideoNote() },
            ]),
            Section(title: "Я", footer: nil, rows: [
                .action(key: "sendPhoto", title: "Отправить фото", icon: "photo.badge.plus", destructive: false, closes: true) {
                    let spec = MediaCatalog.photos.randomElement()!
                    ChatStore.shared.sendMedia([spec.messageKind], caption: "", replyTo: nil)
                },
                .action(key: "sendVoice", title: "Отправить голосовое", icon: "mic", destructive: false, closes: true) {
                    let spec = MediaCatalog.voices.randomElement()!
                    ChatStore.shared.sendMedia([spec.messageKind], caption: "", replyTo: nil)
                },
            ]),
            Section(title: "Сеть", footer: "Медленная сеть растягивает отправку в 6–8 раз. Ошибка срабатывает на одну следующую отправку.", rows: [
                .toggle(key: "slowNetwork", title: "Медленная загрузка", icon: "tortoise", get: { MockChatService.shared.slowNetwork }, set: { MockChatService.shared.slowNetwork = $0 }),
                .toggle(key: "failNext", title: "Ошибка следующей отправки", icon: "exclamationmark.triangle", get: { MockChatService.shared.failNextSend }, set: { MockChatService.shared.failNextSend = $0 }),
                .toggle(key: "autoReplies", title: "Автоответы собеседника", icon: "arrowshape.turn.up.left.2", get: { MockChatService.shared.autoReplies }, set: { MockChatService.shared.autoReplies = $0 }),
                .toggle(key: "peerReads", title: "Собеседник читает", icon: "checkmark.message", get: { MockChatService.shared.peerReadsMessages }, set: { MockChatService.shared.peerReadsMessages = $0 }),
            ]),
            Section(title: "Уведомления", footer: "Нажмите и сразу сверните приложение: через 5 с придёт баннер, а сообщение появится в ленте при возврате.", rows: [
                .action(key: "delayedIncoming", title: "Входящее через 5 с", icon: "bell.badge", destructive: false, closes: true) {
                    LocalNotifications.shared.scheduleDelayedIncoming(after: 5)
                },
            ]),
            Section(title: "Производительность", footer: "Счётчики считают кадры главного потока во время прокрутки и анимаций. Порог рывка — 1,5 длительности кадра.", rows: [
                .toggle(key: "fpsOverlay", title: "Показать монитор кадров", icon: "speedometer", get: { PerformanceMonitor.shared.isOverlayVisible }, set: { PerformanceMonitor.shared.setOverlayVisible($0) }),
                .action(key: "perfReset", title: "Сбросить счётчики кадров", icon: "arrow.counterclockwise", destructive: false, closes: false) {
                    PerformanceMonitor.shared.reset()
                },
            ]),
            Section(title: "Данные", footer: "Вернёт исходную историю (340 сообщений), закрепы и настройки.", rows: [
                .action(key: "reset", title: "Сбросить данные", icon: "trash", destructive: true, closes: false) {},
            ]),
        ]
    }

    // MARK: Таблица

    override func numberOfSections(in tableView: UITableView) -> Int { sections.count }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { sections[section].rows.count }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { sections[section].title }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? { sections[section].footer }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        var content = cell.defaultContentConfiguration()
        cell.accessoryView = nil
        cell.accessoryType = .none
        cell.selectionStyle = .default
        switch sections[indexPath.section].rows[indexPath.row] {
        case let .action(key, title, icon, destructive, _, _):
            content.text = title
            content.image = UIImage(systemName: icon)
            content.textProperties.color = destructive ? .systemRed : .label
            content.imageProperties.tintColor = destructive ? .systemRed : Palette.accent
            cell.accessibilityIdentifier = "debug.\(key)"
            cell.accessibilityTraits = .button
        case let .toggle(key, title, icon, get, _):
            content.text = title
            content.image = UIImage(systemName: icon)
            content.imageProperties.tintColor = Palette.accent
            let toggle = UISwitch()
            toggle.isOn = get()
            toggle.tag = indexPath.section * 1000 + indexPath.row
            toggle.accessibilityIdentifier = "debug.\(key)"
            toggle.accessibilityLabel = title
            toggle.addTarget(self, action: #selector(toggleChanged(_:)), for: .valueChanged)
            cell.accessoryView = toggle
            cell.selectionStyle = .none
            cell.accessibilityIdentifier = "debug.\(key).row"
        }
        cell.contentConfiguration = content
        return cell
    }

    @objc private func toggleChanged(_ sender: UISwitch) {
        let section = sender.tag / 1000
        let row = sender.tag % 1000
        guard section < sections.count, row < sections[section].rows.count,
              case let .toggle(_, _, _, _, set) = sections[section].rows[row] else { return }
        set(sender.isOn)
        Haptics.selection()
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard case let .action(key, _, _, _, closes, run) = sections[indexPath.section].rows[indexPath.row] else { return }
        if key == "reset" {
            confirmReset(sourceView: tableView.cellForRow(at: indexPath))
            return
        }
        Haptics.impact()
        if closes {
            dismiss(animated: true) { run() }
        } else {
            run()
            if key == "perfReset" {
                Toast.show("Счётчики сброшены", icon: "speedometer", in: view, bottomInset: view.safeAreaInsets.bottom + 8)
            }
        }
    }

    private func confirmReset(sourceView: UIView?) {
        let alert = UIAlertController(
            title: "Сбросить данные?", message: "История, закрепы, черновик и настройки чата вернутся к исходным.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        alert.addAction(UIAlertAction(title: "Сбросить", style: .destructive) { [weak self] _ in
            AudioPlayerService.shared.stop()
            self?.dismiss(animated: true) {
                MockChatService.shared.reset()
                Haptics.success()
            }
        })
        present(alert, animated: true)
    }
}
