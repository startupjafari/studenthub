import SwiftUI
import UIKit

/// Лента сообщений.
///
/// `UICollectionView` под SwiftUI-содержимым — решение плана: на тысячах ячеек с
/// удержанием позиции SwiftUI-список проседает, а ячейки всё равно рисует SwiftUI
/// через `UIHostingConfiguration`, так что пузыри остаются обычными вьюхами.
struct MessageListView: UIViewControllerRepresentable {
    let days: [MessageTimeline.Day]
    /// Куда прокрутить после применения среза.
    let anchor: String?
    var bubbleContext = BubbleContext()
    /// Просьба прокрутить к сообщению (закреплённое, ответ, найденное).
    var focus: MessageFocus?
    var capabilities: (MessageRecord) -> MessageCapabilities = { _ in MessageCapabilities() }
    /// Выбранные сообщения; `nil` — режим выбора выключен.
    var selection: Set<String>?
    /// Просьба прокрутить к последнему сообщению: каждое новое значение — одна прокрутка
    /// (кнопка «вниз»).
    var scrollToBottomToken = 0
    /// Лента дошла до низа или ушла от него — для кнопки «вниз».
    var onBottomChange: (Bool) -> Void = { _ in }
    let onReachTop: () -> Void
    let onAction: (MessageAction, MessageRecord) -> Void

    func makeUIViewController(context: Context) -> MessageListViewController {
        let controller = MessageListViewController()
        controller.onReachTop = onReachTop
        controller.onAction = onAction
        controller.capabilities = capabilities
        controller.onBottomChange = onBottomChange
        return controller
    }

    func updateUIViewController(_ controller: MessageListViewController, context: Context) {
        controller.onReachTop = onReachTop
        controller.onAction = onAction
        controller.capabilities = capabilities
        controller.onBottomChange = onBottomChange
        controller.apply(days: days, anchor: anchor, context: bubbleContext, selection: selection)
        controller.focus(focus)
        controller.scrollToBottom(token: scrollToBottomToken)
    }
}

final class MessageListViewController: UIViewController {
    var onReachTop: (() -> Void)?
    var onAction: ((MessageAction, MessageRecord) -> Void)?
    var capabilities: ((MessageRecord) -> MessageCapabilities)?
    var onBottomChange: ((Bool) -> Void)?
    private var bubbleContext = BubbleContext()
    private var selection: Set<String>?
    private var appliedBottomToken = 0
    private var reportedAtBottom = true
    private var appliedFocus: MessageFocus?

    private var collectionView: UICollectionView!
    private var dataSource: UICollectionViewDiffableDataSource<Date, String>!
    private var itemsByID: [String: MessageTimeline.Item] = [:]
    private var appliedAnchor: String?
    private var hasContent = false
    private var lastBoundsHeight: CGFloat = 0

    override func viewDidLoad() {
        super.viewDidLoad()
        configureCollectionView()
        configureDataSource()
    }

    /// Высота ленты меняется под клавиатуру, растущее поле ввода, полосы ответа и
    /// записи. Стоял человек у последнего сообщения — остаётся у него: иначе свежие
    /// сообщения уезжают под клавиатуру ровно тогда, когда на них отвечают.
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let height = collectionView.bounds.height
        defer { lastBoundsHeight = height }
        guard hasContent, lastBoundsHeight > 0, abs(height - lastBoundsHeight) > 0.5, reportedAtBottom else { return }
        scrollToBottom(animated: false)
    }

    /// Применить срез.
    ///
    /// Два правила, ради которых всё и написано руками. Первое: если человек стоит у
    /// нижнего края, новое сообщение подматывает ленту за ним. Второе: если сверху
    /// доехала страница старых сообщений, позиция не должна шевельнуться — поэтому
    /// после применения смещаем `contentOffset` ровно на выросшую высоту.
    func apply(days: [MessageTimeline.Day], anchor: String?, context: BubbleContext, selection: Set<String>? = nil) {
        let previous = itemsByID
        let contextChanged = context != bubbleContext
        bubbleContext = context
        // Вход в режим выбора и выход перерисовывают все ячейки (кружки слева), а
        // касание в режиме — только те, чья отметка сменилась.
        let selectionModeChanged = (selection == nil) != (self.selection == nil)
        let toggled = (selection ?? []).symmetricDifference(self.selection ?? [])
        self.selection = selection
        itemsByID = Dictionary(
            uniqueKeysWithValues: days.flatMap(\.items).map { ($0.id, $0) }
        )

        var snapshot = NSDiffableDataSourceSnapshot<Date, String>()
        snapshot.appendSections(days.map(\.id))
        for day in days {
            snapshot.appendItems(day.items.map(\.id), toSection: day.id)
        }
        // Снимок сравнивает только идентификаторы: правка, удаление, реакция или
        // прочтение без этого не перерисовали бы уже показанную ячейку.
        let changed = snapshot.itemIdentifiers.filter { id in
            guard let old = previous[id] else { return false }
            return contextChanged || selectionModeChanged || toggled.contains(id) || old != itemsByID[id]
        }
        if !changed.isEmpty { snapshot.reconfigureItems(changed) }

        let wasAtBottom = isNearBottom
        let oldHeight = collectionView.contentSize.height
        let oldOffset = collectionView.contentOffset.y
        let isFirstFill = !hasContent && !days.isEmpty
        hasContent = hasContent || !days.isEmpty

        dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
            guard let self else { return }
            defer { self.requestOlderIfScreenNotFilled() }

            if isFirstFill, let anchor, anchor != self.appliedAnchor {
                self.appliedAnchor = anchor
                self.scroll(to: anchor)
                return
            }
            if isFirstFill || wasAtBottom {
                self.scrollToBottom(animated: !isFirstFill)
                return
            }
            let grown = self.collectionView.contentSize.height - oldHeight
            if grown > 0, oldOffset < grown {
                // Выросло сверху — компенсируем, иначе лента прыгнет под пальцем.
                self.collectionView.contentOffset.y = oldOffset + grown
            }
        }
    }

    /// Короткая история помещается на экран целиком — прокрутки нет, и подгрузка
    /// вверх по прокрутке не случится никогда. Просим следующую страницу сами.
    private func requestOlderIfScreenNotFilled() {
        guard hasContent, collectionView.contentSize.height < collectionView.bounds.height else { return }
        DispatchQueue.main.async { [weak self] in self?.onReachTop?() }
    }

    // MARK: - Сборка

    private func configureCollectionView() {
        var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
        configuration.showsSeparators = false
        configuration.backgroundColor = .clear
        configuration.headerMode = .supplementary
        configuration.headerTopPadding = 0

        // Дата дня прилипает к верху, пока листаешь этот день, — как в Telegram.
        let layout = UICollectionViewCompositionalLayout { _, environment in
            let section = NSCollectionLayoutSection.list(using: configuration, layoutEnvironment: environment)
            for header in section.boundarySupplementaryItems {
                header.pinToVisibleBounds = true
                header.zIndex = 2
            }
            return section
        }

        collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collectionView.backgroundColor = .clear
        collectionView.keyboardDismissMode = .interactive
        // Короткая переписка тоже тянется: жест к началу ленты есть всегда.
        collectionView.alwaysBounceVertical = true
        collectionView.delegate = self
        collectionView.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(collectionView)
        NSLayoutConstraint.activate([
            collectionView.topAnchor.constraint(equalTo: view.topAnchor),
            collectionView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    private func configureDataSource() {
        let cell = UICollectionView.CellRegistration<UICollectionViewListCell, String> {
            [weak self] cell, _, id in
            guard let item = self?.itemsByID[id] else { return }
            cell.contentConfiguration = UIHostingConfiguration {
                MessageBubbleView(
                    item: item,
                    context: self?.bubbleContext ?? BubbleContext(),
                    capabilities: self?.capabilities?(item.message) ?? MessageCapabilities(),
                    selecting: self?.selection != nil,
                    isSelected: self?.selection?.contains(id) ?? false
                ) { [weak self] action in
                    self?.onAction?(action, item.message)
                }
            }
            // Как в Telegram: пузыри почти у краёв экрана, внутри группы — вплотную.
            .margins(.horizontal, Spacing.md)
            .margins(.vertical, item.isLastInGroup ? 5 : 1)
            cell.backgroundConfiguration = .clear()
        }

        let header = UICollectionView.SupplementaryRegistration<UICollectionViewListCell>(
            elementKind: UICollectionView.elementKindSectionHeader
        ) { [weak self] view, _, indexPath in
            guard let day = self?.dataSource.snapshot().sectionIdentifiers[indexPath.section] else { return }
            view.contentConfiguration = UIHostingConfiguration {
                DaySeparatorView(day: day)
            }
            view.backgroundConfiguration = .clear()
        }

        dataSource = UICollectionViewDiffableDataSource<Date, String>(collectionView: collectionView) {
            view, indexPath, id in
            view.dequeueConfiguredReusableCell(using: cell, for: indexPath, item: id)
        }
        dataSource.supplementaryViewProvider = { view, _, indexPath in
            view.dequeueConfiguredReusableSupplementary(using: header, for: indexPath)
        }
    }

    // MARK: - Прокрутка

    /// Прокрутить к сообщению и коротко подсветить его. Сообщение могло ещё не
    /// доехать до ленты (окно истории только скачано) — тогда ждём следующего среза.
    func focus(_ request: MessageFocus?) {
        guard let request, request != appliedFocus else { return }
        guard let indexPath = dataSource.indexPath(for: request.id) else { return }
        appliedFocus = request
        collectionView.scrollToItem(at: indexPath, at: .centeredVertically, animated: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let cell = self?.collectionView.cellForItem(at: indexPath) else { return }
            UIView.animate(withDuration: 0.25, animations: {
                cell.contentView.backgroundColor = UIColor.tintColor.withAlphaComponent(0.15)
            }, completion: { _ in
                UIView.animate(withDuration: 0.6, delay: 0.6) {
                    cell.contentView.backgroundColor = .clear
                }
            })
        }
    }

    /// Кнопка «вниз»: прокрутить к последнему сообщению.
    func scrollToBottom(token: Int) {
        guard token != appliedBottomToken else { return }
        appliedBottomToken = token
        scrollToBottom(animated: !UIAccessibility.isReduceMotionEnabled)
    }

    /// Сообщить SwiftUI, у низа ли лента. Только при смене и вне текущего прохода
    /// обновления: прокрутка случается и внутри `updateUIViewController`.
    private func reportBottom() {
        let atBottom = isNearBottom
        guard atBottom != reportedAtBottom else { return }
        reportedAtBottom = atBottom
        DispatchQueue.main.async { [weak self] in
            self?.onBottomChange?(atBottom)
        }
    }

    private var isNearBottom: Bool {
        let distance = collectionView.contentSize.height
            - collectionView.contentOffset.y
            - collectionView.bounds.height
        return distance < 80
    }

    private func scrollToBottom(animated: Bool) {
        let bottom = max(
            -collectionView.adjustedContentInset.top,
            collectionView.contentSize.height
                - collectionView.bounds.height
                + collectionView.adjustedContentInset.bottom
        )
        collectionView.setContentOffset(CGPoint(x: 0, y: bottom), animated: animated)
    }

    private func scroll(to id: String) {
        guard let indexPath = dataSource.indexPath(for: id) else {
            scrollToBottom(animated: false)
            return
        }
        collectionView.scrollToItem(at: indexPath, at: .top, animated: false)
    }
}

extension MessageListViewController: UICollectionViewDelegate {
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard hasContent else { return }
        reportBottom()
        // Подгружаем заранее: к моменту, когда человек долистает, страница уже тут.
        guard scrollView.contentOffset.y < scrollView.bounds.height else { return }
        onReachTop?()
    }
}

/// Разделитель дня — капсула по центру, на iOS 26 в стекле. Прилипает к верху ленты.
private struct DaySeparatorView: View {
    let day: Date

    var body: some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Palette.foreground)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.xs)
            .chatCapsuleSurface()
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.sm)
            .accessibilityAddTraits(.isHeader)
    }

    private var title: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) {
            return String(localized: "chats.today", defaultValue: "Сегодня")
        }
        if calendar.isDateInYesterday(day) {
            return String(localized: "chats.yesterday", defaultValue: "Вчера")
        }
        if calendar.isDate(day, equalTo: Date(), toGranularity: .year) {
            return day.formatted(.dateTime.day().month(.wide))
        }
        return day.formatted(.dateTime.day().month(.wide).year())
    }
}
