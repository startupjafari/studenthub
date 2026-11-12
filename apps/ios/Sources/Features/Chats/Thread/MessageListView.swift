import SwiftUI
import UIKit

/// Лента сообщений.
///
/// `UICollectionView` под SwiftUI-содержимым — решение плана: на тысячах ячеек с
/// удержанием позиции SwiftUI-список проседает, а ячейки всё равно рисует SwiftUI
/// через `UIHostingConfiguration`, так что пузыри остаются обычными вьюхами.
struct MessageListView: UIViewControllerRepresentable {
    let days: [MessageTimeline.Day]
    /// Куда прокрутить при первом показе (первое непрочитанное).
    let anchor: String?
    var bubbleContext = BubbleContext()
    /// Просьба прокрутить к сообщению (закреплённое, ответ, найденное).
    var focus: MessageFocus?
    var capabilities: (MessageRecord) -> MessageCapabilities = { _ in MessageCapabilities() }
    /// Выбранные сообщения; `nil` — режим выбора выключен.
    var selection: Set<String>?
    /// Просьба прокрутить к последнему сообщению: каждое новое значение — одна прокрутка
    /// (кнопка «вниз», своя отправка).
    var scrollToBottomToken = 0
    /// Лента дошла до низа или ушла от него — для кнопки «вниз».
    var onBottomChange: (Bool) -> Void = { _ in }
    /// Новое сообщение у нижнего края подматывает ленту за собой. В окне истории — нет:
    /// снизу доезжают страницы догрузки, и лента уезжала бы сама через всю историю.
    var followsBottom = true
    /// Запас под последним сообщением. В окне истории кнопка «вниз» видна и у его низа,
    /// и без запаса закрывала бы время последнего пузыря.
    var bottomInset: CGFloat = 0
    /// Нажатие на дату дня — календарь «Перейти к дате».
    var onDayTap: (Date) -> Void = { _ in }
    let onReachTop: () -> Void
    /// Лента подъехала к низу загруженного — догрузка из окна истории.
    var onReachBottom: () -> Void = {}
    let onAction: (MessageAction, MessageRecord) -> Void
    /// Долгое нажатие на пузырь — меню с реакциями.
    var onMenu: (MessageTimeline.Item) -> Void = { _ in }

    func makeUIViewController(context: Context) -> MessageListViewController {
        let controller = MessageListViewController()
        bind(controller)
        return controller
    }

    func updateUIViewController(_ controller: MessageListViewController, context: Context) {
        bind(controller)
        controller.setBottomInset(bottomInset)
        controller.apply(days: days, anchor: anchor, context: bubbleContext, selection: selection)
        controller.focus(focus)
        controller.scrollToBottom(token: scrollToBottomToken)
    }

    private func bind(_ controller: MessageListViewController) {
        controller.onReachTop = onReachTop
        controller.onReachBottom = onReachBottom
        controller.onAction = onAction
        controller.onMenu = onMenu
        controller.capabilities = capabilities
        controller.onBottomChange = onBottomChange
        controller.onDayTap = onDayTap
        controller.followsBottom = followsBottom
    }
}

final class MessageListViewController: UIViewController {
    var onReachTop: (() -> Void)?
    var onReachBottom: (() -> Void)?
    var onDayTap: ((Date) -> Void)?
    var followsBottom = true
    var onAction: ((MessageAction, MessageRecord) -> Void)?
    var onMenu: ((MessageTimeline.Item) -> Void)?
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
    private var hasContent = false
    private var lastBoundsHeight: CGFloat = 0

    /// Первая позиция (низ или первое непрочитанное) ещё не выставлена. Её нельзя
    /// ставить, пока у ленты нет высоты: прокрутка «к низу» при нулевой высоте уводила
    /// ленту за конец, и первым кадром у верха пустого экрана висело одно сообщение.
    /// До неё лента прозрачна — промежуточных положений человек не видит.
    private var needsInitialPosition = false
    private var initialAnchor: String?
    /// Лента приклеена к низу: туда её привела сама программа (открытие, кнопка «вниз»,
    /// своя отправка, подмотка за новым сообщением), и человек с тех пор её не трогал.
    /// Решать «у низа ли лента» по смещению нельзя: пока едет анимация прокрутки, смещение
    /// посередине, и следующий срез (своё сообщение) оставался бы за краем экрана.
    private var sticksToBottom = false
    /// Когда содержимое ленты в последний раз сменилось целиком (окно истории заменено
    /// последней страницей и наоборот). Прокрутка по такой ленте — без анимации: ехать
    /// от случайного места по ячейкам с оценочной высотой — значит промахнуться.
    private var replacedAt: Date?
    /// Переход к сообщению ждёт конца прокрутки, чтобы довести её и подсветить цель.
    private var pendingFocus: MessageFocus?
    /// Новые сообщения в хвосте ленты, ещё не показанные: их ячейки въезжают при первом
    /// показе. Ключ — id сообщения.
    private var entrances: [String: Entrance] = [:]
    /// Дни, впервые появившиеся вместе с новым сообщением: их дата въезжает так же.
    private var enteringDays: [Date: Date] = [:]
    /// Плавающая дата у верха ленты прячется, когда лента стоит, — как в Telegram.
    private var headerHideTask: Task<Void, Never>?
    private var headersHidden = false

    private struct Entrance {
        let own: Bool
        let noticed: Date
    }

    /// Сколько живёт отметка о входе: не показавшееся за это время (человек далеко от
    /// низа) потом въезжать не должно — это уже не «только что пришло».
    private static let entranceLifetime: TimeInterval = 1

    private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

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
        if needsInitialPosition {
            positionInitiallyIfPossible()
            return
        }
        guard hasContent, lastBoundsHeight > 0, abs(height - lastBoundsHeight) > 0.5,
            reportedAtBottom || sticksToBottom
        else { return }
        scrollToBottom(animated: false)
    }

    /// Запас снизу под кнопку «вниз». Стояла лента у низа — остаётся у нового низа.
    func setBottomInset(_ inset: CGFloat) {
        loadViewIfNeeded()
        guard abs(collectionView.contentInset.bottom - inset) > 0.5 else { return }
        let keepsBottom = hasContent && !needsInitialPosition && (isNearBottom || sticksToBottom)
        collectionView.contentInset.bottom = inset
        collectionView.verticalScrollIndicatorInsets.bottom = inset
        if keepsBottom { scrollToBottom(animated: false) }
    }

    /// Применить срез.
    ///
    /// Два правила, ради которых всё и написано руками. Первое: если человек стоит у
    /// нижнего края, новое сообщение подматывает ленту за ним. Второе: если сверху
    /// доехала страница старых сообщений, позиция не должна шевельнуться — поэтому
    /// верхнее видимое сообщение после применения возвращается на то же место экрана.
    /// По нему, а не по выросшей высоте: в окне истории страницы доезжают и снизу, и
    /// сдвиг на их высоту унёс бы ленту прочь от того, что человек читает.
    func apply(days: [MessageTimeline.Day], anchor: String?, context: BubbleContext, selection: Set<String>? = nil) {
        let previous = itemsByID
        let previousSnapshot = dataSource.snapshot()
        let previousOrder = previousSnapshot.itemIdentifiers
        let previousDays = Set(previousSnapshot.sectionIdentifiers)
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
        let pinned = topVisibleItem()
        let isFirstFill = !hasContent && !days.isEmpty
        // Прежний низ ленты пропал — значит, сменилось всё окно, а не пришло новое.
        let replaced = previousOrder.last.map { itemsByID[$0] == nil } ?? false
        // Первое наполнение — тоже «новая лента»: переход, пришедший вместе с ним, встаёт
        // к цели сразу, без пробега от низа.
        if replaced || isFirstFill { replacedAt = Date() }
        if !isFirstFill {
            noteEntrances(order: snapshot.itemIdentifiers, previousOrder: previousOrder, previous: previous, previousDays: previousDays, days: days)
        }
        hasContent = hasContent || !days.isEmpty
        // До применения, а не в его завершении: переход, пришедший тем же обновлением
        // (`focus` сразу после `apply`), должен застать ленту ещё не расставленной и
        // стать её первой позицией.
        if isFirstFill {
            initialAnchor = anchor
            needsInitialPosition = true
        }

        dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
            guard let self else { return }
            defer { self.requestOlderIfScreenNotFilled() }

            if self.needsInitialPosition {
                self.positionInitiallyIfPossible()
                return
            }
            if self.sticksToBottom || (wasAtBottom && self.followsBottom) {
                self.sticksToBottom = true
                self.scrollToBottom(animated: !replaced && !self.reduceMotion)
                return
            }
            if let pinned, self.restore(pinned) { return }
            let grown = self.collectionView.contentSize.height - oldHeight
            if grown > 0, oldOffset < grown {
                // Выросло сверху — компенсируем, иначе лента прыгнет под пальцем.
                self.collectionView.contentOffset.y = oldOffset + grown
            }
        }
    }

    /// Короткая история помещается на экран целиком — прокрутки нет, и подгрузка
    /// по прокрутке не случится никогда. Просим соседние страницы сами.
    private func requestOlderIfScreenNotFilled() {
        guard hasContent, collectionView.contentSize.height < collectionView.bounds.height else { return }
        DispatchQueue.main.async { [weak self] in
            self?.onReachTop?()
            self?.onReachBottom?()
        }
    }

    /// Первый показ: сразу на месте — у низа или у первого непрочитанного.
    private func positionInitiallyIfPossible() {
        guard needsInitialPosition, hasContent, collectionView.bounds.height > 0,
            dataSource.snapshot().numberOfItems > 0
        else { return }
        needsInitialPosition = false
        let target = initialAnchor.flatMap { dataSource.indexPath(for: $0) }
        // Ячейки считают высоту сами: первый проход ставит ленту по оценкам, второй — по
        // настоящим размерам ячеек, попавших на экран. С одним проходом лента вставала
        // мимо и доезжала на глазах.
        for _ in 0..<2 {
            collectionView.layoutIfNeeded()
            if let target {
                collectionView.scrollToItem(at: target, at: .top, animated: false)
            } else {
                scrollToBottom(animated: false)
            }
        }
        sticksToBottom = target == nil
        reportBottom()
        reveal()
        scheduleHeaderHide()
    }

    /// Показать ленту после первой расстановки.
    private func reveal() {
        guard collectionView.alpha < 1 else { return }
        guard !reduceMotion else {
            collectionView.alpha = 1
            return
        }
        UIView.animate(withDuration: Motion.Duration.feedback, delay: 0, options: [.allowUserInteraction]) {
            self.collectionView.alpha = 1
        }
    }

    /// Верхнее видимое сообщение и его расстояние от верха видимой области.
    private func topVisibleItem() -> (id: String, distance: CGFloat)? {
        guard let indexPath = collectionView.indexPathsForVisibleItems.min(),
            let id = dataSource.itemIdentifier(for: indexPath),
            let frame = collectionView.layoutAttributesForItem(at: indexPath)?.frame
        else { return nil }
        return (id, frame.minY - collectionView.contentOffset.y)
    }

    /// Вернуть сообщение на прежнее место экрана. `false` — его больше нет в ленте.
    private func restore(_ pinned: (id: String, distance: CGFloat)) -> Bool {
        guard let indexPath = dataSource.indexPath(for: pinned.id) else { return false }
        collectionView.layoutIfNeeded()
        guard let frame = collectionView.layoutAttributesForItem(at: indexPath)?.frame else { return false }
        let inset = collectionView.adjustedContentInset
        let lowest = -inset.top
        let highest = max(lowest, collectionView.contentSize.height - collectionView.bounds.height + inset.bottom)
        let target = min(max(frame.minY - pinned.distance, lowest), highest)
        if abs(target - collectionView.contentOffset.y) > 0.5 {
            collectionView.contentOffset.y = target
        }
        return true
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
        // До первой расстановки лента прозрачна (`needsInitialPosition`).
        collectionView.alpha = 0

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
                    if case .menu = action {
                        self?.onMenu?(item)
                    } else {
                        self?.onAction?(action, item.message)
                    }
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
            guard let day = self?.dataSource.sectionIdentifier(for: indexPath.section) else { return }
            view.contentConfiguration = UIHostingConfiguration {
                DaySeparatorView(day: day) { [weak self] in self?.onDayTap?(day) }
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
        sticksToBottom = false
        pendingFocus = request
        if needsInitialPosition {
            // Ленту ещё не расставили: цель и станет первой позицией.
            initialAnchor = request.id
            scheduleFocusFinish(for: request, after: .milliseconds(300))
            return
        }
        // Окно только что сменилось целиком — к цели сразу, без пробега по чужой ленте:
        // так переход и выглядит в Telegram.
        let recentlyReplaced = replacedAt.map { Date().timeIntervalSince($0) < 0.5 } ?? false
        let animated = !recentlyReplaced && !reduceMotion
        collectionView.layoutIfNeeded()
        collectionView.scrollToItem(at: indexPath, at: Self.position(for: request), animated: animated)
        // Сообщение могло уже стоять на месте — тогда конца прокрутки не будет, и
        // подсветку запускает таймер.
        scheduleFocusFinish(for: request, after: .milliseconds(animated ? 450 : 30))
    }

    private static func position(for request: MessageFocus) -> UICollectionView.ScrollPosition {
        request.atTop ? .top : .centeredVertically
    }

    private func scheduleFocusFinish(for request: MessageFocus, after delay: Swift.Duration) {
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard let self, self.pendingFocus == request else { return }
            self.finishFocus()
        }
    }

    /// Прокрутка к цели закончилась: довести её по настоящим высотам ячеек (ехала она по
    /// оценочным) и подсветить сообщение.
    private func finishFocus() {
        guard let request = pendingFocus else { return }
        pendingFocus = nil
        guard let indexPath = dataSource.indexPath(for: request.id) else { return }
        collectionView.layoutIfNeeded()
        collectionView.scrollToItem(at: indexPath, at: Self.position(for: request), animated: false)
        collectionView.layoutIfNeeded()
        flash(at: indexPath)
    }

    /// Короткая подсветка строки цели: тон фирменного цвета вспыхивает и гаснет.
    private func flash(at indexPath: IndexPath) {
        guard let cell = collectionView.cellForItem(at: indexPath) else { return }
        let view = cell.contentView
        let tint = UIColor(Palette.primary).withAlphaComponent(0.16)
        // Без движения — без нарастания и затухания: подсветка просто есть и пропадает.
        let still = reduceMotion
        UIView.animate(
            withDuration: still ? 0 : Motion.Duration.feedback,
            delay: 0,
            options: [.allowUserInteraction, .beginFromCurrentState]
        ) {
            view.backgroundColor = tint
        } completion: { _ in
            UIView.animate(
                withDuration: still ? 0 : Motion.Duration.data,
                delay: 0.8,
                options: [.allowUserInteraction]
            ) {
                view.backgroundColor = .clear
            }
        }
    }

    /// Кнопка «вниз» и своя отправка: прокрутить к последнему сообщению и держаться
    /// низа, пока человек не возьмёт ленту пальцем, — следующий срез (своё сообщение)
    /// тоже окажется на экране.
    func scrollToBottom(token: Int) {
        guard token != appliedBottomToken else { return }
        appliedBottomToken = token
        sticksToBottom = true
        pendingFocus = nil
        if needsInitialPosition { initialAnchor = nil }
        guard hasContent, !needsInitialPosition else { return }
        showHeaders()
        collectionView.layoutIfNeeded()
        let recentlyReplaced = replacedAt.map { Date().timeIntervalSince($0) < 0.5 } ?? false
        scrollToBottom(animated: !recentlyReplaced && !reduceMotion)
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

    /// Сколько осталось до самого низа с учётом запаса снизу.
    private var distanceToBottom: CGFloat {
        collectionView.contentSize.height
            + collectionView.adjustedContentInset.bottom
            - collectionView.bounds.height
            - collectionView.contentOffset.y
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

    // MARK: - Появление нового

    /// Отметить сообщения, дописанные в хвост ленты, — их ячейки въедут при показе.
    ///
    /// Только хвост и только поштучно: страница истории (сверху, из окна снизу, догон
    /// после обрыва) приходит пачкой и должна встать молча. В окне истории снизу
    /// доезжает история, а живое там — только своё неотправленное.
    private func noteEntrances(
        order: [String],
        previousOrder: [String],
        previous: [String: MessageTimeline.Item],
        previousDays: Set<Date>,
        days: [MessageTimeline.Day]
    ) {
        guard let last = previousOrder.last, let lastIndex = order.lastIndex(of: last) else { return }
        let tail = order[(lastIndex + 1)...].filter { previous[$0] == nil }
        guard !tail.isEmpty, tail.count <= 3 else { return }
        let now = Date()
        for id in tail {
            guard let item = itemsByID[id], item.isOwn || followsBottom else { continue }
            entrances[id] = Entrance(own: item.isOwn, noticed: now)
            if let day = days.last(where: { $0.items.contains { $0.id == id } })?.id, !previousDays.contains(day) {
                enteringDays[day] = now
            }
        }
    }

    /// Въезд ячейки. Своё сообщение поднимается от поля ввода и чуть подрастает — с
    /// опорой на правый нижний угол, где была кнопка «отправить»; чужое проявляется,
    /// приподнимаясь. Без движения — только проявление.
    private func animateEntrance(of view: UIView, own: Bool) {
        view.alpha = 0
        if !reduceMotion {
            if own {
                let half = CGPoint(x: view.bounds.width / 2, y: view.bounds.height / 2)
                view.transform = CGAffineTransform(translationX: half.x, y: half.y + 28)
                    .scaledBy(x: 0.9, y: 0.9)
                    .translatedBy(x: -half.x, y: -half.y)
            } else {
                view.transform = CGAffineTransform(translationX: 0, y: 14)
            }
        }
        UIView.animate(
            withDuration: own ? 0.4 : Motion.Duration.surface,
            delay: 0,
            usingSpringWithDamping: own ? 0.82 : 1,
            initialSpringVelocity: 0,
            options: [.allowUserInteraction, .beginFromCurrentState]
        ) {
            view.alpha = 1
            view.transform = .identity
        }
    }

    // MARK: - Плавающая дата

    /// Дата, прилипшая к верху, гаснет через полторы секунды покоя и возвращается с
    /// первым движением ленты — как в Telegram. Даты на своих местах не трогаем.
    private func scheduleHeaderHide() {
        headerHideTask?.cancel()
        headerHideTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(1500))
            guard !Task.isCancelled else { return }
            self?.hideFloatingHeaders()
        }
    }

    private func hideFloatingHeaders() {
        // VoiceOver читает дату по заголовку: прятать его незачем.
        guard !UIAccessibility.isVoiceOverRunning,
            !collectionView.isTracking, !collectionView.isDragging, !collectionView.isDecelerating
        else { return }
        let kind = UICollectionView.elementKindSectionHeader
        for indexPath in collectionView.indexPathsForVisibleSupplementaryElements(ofKind: kind) {
            guard let header = collectionView.supplementaryView(forElementKind: kind, at: indexPath) as? UICollectionViewListCell,
                isFloating(header, section: indexPath.section)
            else { continue }
            headersHidden = true
            // Погасшая дата не ловит касания: под ней — пузыри.
            header.isUserInteractionEnabled = false
            let content = header.contentView
            let scales = !reduceMotion
            UIView.animate(
                withDuration: Motion.Duration.surface,
                delay: 0,
                options: [.allowUserInteraction, .beginFromCurrentState]
            ) {
                content.alpha = 0
                if scales { content.transform = CGAffineTransform(scaleX: 0.85, y: 0.85) }
            }
        }
    }

    private func showHeaders() {
        guard headersHidden else { return }
        headersHidden = false
        let kind = UICollectionView.elementKindSectionHeader
        for indexPath in collectionView.indexPathsForVisibleSupplementaryElements(ofKind: kind) {
            guard let header = collectionView.supplementaryView(forElementKind: kind, at: indexPath) as? UICollectionViewListCell
            else { continue }
            header.isUserInteractionEnabled = true
            let content = header.contentView
            UIView.animate(
                withDuration: Motion.Duration.layer,
                delay: 0,
                options: [.allowUserInteraction, .beginFromCurrentState]
            ) {
                content.alpha = 1
                content.transform = .identity
            }
        }
        // Лента сдвинулась не пальцем (подмотка, догрузка) — конца движения не будет,
        // и погасить дату снова должен таймер.
        scheduleHeaderHide()
    }

    /// Прилипшая дата висит поверх сообщений своего дня; на своём месте она стоит
    /// ровно над первым из них.
    private func isFloating(_ header: UICollectionReusableView, section: Int) -> Bool {
        guard section < collectionView.numberOfSections, collectionView.numberOfItems(inSection: section) > 0,
            let first = collectionView.layoutAttributesForItem(at: IndexPath(item: 0, section: section))
        else { return false }
        return header.frame.maxY > first.frame.minY + 1
    }
}

extension MessageListViewController: UICollectionViewDelegate {
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard hasContent else { return }
        reportBottom()
        if headersHidden { showHeaders() }
        // Подгружаем заранее: к моменту, когда человек долистает, страница уже тут.
        if scrollView.contentOffset.y < scrollView.bounds.height {
            onReachTop?()
        }
        let distance = scrollView.contentSize.height - scrollView.contentOffset.y - scrollView.bounds.height
        if distance < scrollView.bounds.height {
            onReachBottom?()
        }
    }

    /// Человек взял ленту пальцем — программа больше не ведёт её к низу и к цели.
    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        sticksToBottom = false
        pendingFocus = nil
        headerHideTask?.cancel()
        showHeaders()
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate { scheduleHeaderHide() }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        scheduleHeaderHide()
    }

    /// Касание строки состояния уводит к началу — тоже решение человека.
    func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool {
        sticksToBottom = false
        return true
    }

    func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
        if pendingFocus != nil {
            finishFocus()
        } else if sticksToBottom, distanceToBottom > 1 {
            // Анимация ехала к низу по оценочным высотам, а ячейки по пути посчитали
            // настоящие — досаживаем ленту на настоящий низ.
            scrollToBottom(animated: false)
        }
        reportBottom()
        scheduleHeaderHide()
    }

    func collectionView(_ collectionView: UICollectionView, willDisplay cell: UICollectionViewCell, forItemAt indexPath: IndexPath) {
        // Ячейка могла прийти из переиспользования посреди подсветки другого сообщения.
        cell.contentView.backgroundColor = .clear
        guard let id = dataSource.itemIdentifier(for: indexPath),
            let entrance = entrances.removeValue(forKey: id),
            Date().timeIntervalSince(entrance.noticed) < Self.entranceLifetime
        else { return }
        animateEntrance(of: cell.contentView, own: entrance.own)
    }

    func collectionView(
        _ collectionView: UICollectionView,
        willDisplaySupplementaryView view: UICollectionReusableView,
        forElementKind elementKind: String,
        at indexPath: IndexPath
    ) {
        guard let header = view as? UICollectionViewListCell else { return }
        // Заголовок мог прийти из переиспользования погашенным.
        header.isUserInteractionEnabled = true
        header.contentView.alpha = 1
        header.contentView.transform = .identity
        guard let day = dataSource.sectionIdentifier(for: indexPath.section),
            let noticed = enteringDays.removeValue(forKey: day),
            Date().timeIntervalSince(noticed) < Self.entranceLifetime
        else { return }
        // Новый день пришёл вместе с сообщением — дата появляется, вырастая.
        let content = header.contentView
        content.alpha = 0
        if !reduceMotion { content.transform = CGAffineTransform(scaleX: 0.8, y: 0.8) }
        UIView.animate(
            withDuration: Motion.Duration.surface,
            delay: 0,
            usingSpringWithDamping: 0.8,
            initialSpringVelocity: 0,
            options: [.allowUserInteraction]
        ) {
            content.alpha = 1
            content.transform = .identity
        }
    }
}

/// Разделитель дня — капсула по центру, на iOS 26 в стекле. Прилипает к верху ленты.
/// Нажатие открывает календарь, как в Telegram.
private struct DaySeparatorView: View {
    let day: Date
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.xs)
                .chatCapsuleSurface()
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.sm)
        .accessibilityAddTraits(.isHeader)
        .accessibilityHint(Text(String(localized: "chats.calendar.title", defaultValue: "Перейти к дате")))
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
