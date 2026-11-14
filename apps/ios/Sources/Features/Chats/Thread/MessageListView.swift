import SwiftUI
import UIKit
import os

/// Лента сообщений.
///
/// `UICollectionView` под SwiftUI-содержимым — решение плана: на тысячах ячеек с
/// удержанием позиции SwiftUI-список проседает, а ячейки всё равно рисует SwiftUI
/// через `UIHostingConfiguration`, так что пузыри остаются обычными вьюхами.
struct MessageListView: UIViewControllerRepresentable {
    let days: [MessageTimeline.Day]
    /// Номер ленты (`ChatThreadModel.daysRevision`): тот же — лента не менялась.
    var revision = 0
    /// Куда прокрутить при первом показе (первое непрочитанное).
    let anchor: String?
    var bubbleContext = BubbleContext()
    /// Просьба прокрутить к сообщению (закреплённое, ответ, найденное).
    var focus: MessageFocus?
    var capabilities: (MessageRecord) -> MessageCapabilities = { _ in MessageCapabilities() }
    /// Выбранные сообщения; `nil` — режим выбора выключен.
    var selection: Set<String>?
    /// Строка, скрытая в ленте: источник открытого меню сообщения (правило 3.7.3).
    var hiddenID: String?
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
    /// Низ панелей над лентой (шапка, закреплённое) в координатах окна: лента уходит
    /// под них во весь экран, а первое сообщение встаёт ниже.
    var topObstruction: CGFloat = 0
    /// Нажатие на дату дня — календарь «Перейти к дате».
    var onDayTap: (Date) -> Void = { _ in }
    let onReachTop: () -> Void
    /// Лента подъехала к низу загруженного — догрузка из окна истории.
    var onReachBottom: () -> Void = {}
    let onAction: (MessageAction, MessageRecord) -> Void
    /// Долгое нажатие на пузырь — меню с реакциями.
    var onMenu: (MessageTimeline.Item) -> Void = { _ in }
    /// Лента впервые показана человеку (конец замера `ChatOpen`).
    var onFirstShown: () -> Void = {}
    /// Сменилась нижняя реально видимая строка — по ней отмечается прочтение.
    var onLowestVisible: (String?) -> Void = { _ in }

    func makeUIViewController(context: Context) -> MessageListViewController {
        let controller = MessageListViewController()
        bind(controller)
        return controller
    }

    func updateUIViewController(_ controller: MessageListViewController, context: Context) {
        bind(controller)
        controller.setBottomInset(bottomInset)
        controller.setTopObstruction(topObstruction)
        controller.apply(days: days, revision: revision, anchor: anchor, context: bubbleContext, selection: selection)
        controller.setHidden(hiddenID)
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
        controller.onFirstShown = onFirstShown
        controller.onLowestVisible = onLowestVisible
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
    var onFirstShown: (() -> Void)?
    var onLowestVisible: ((String?) -> Void)?
    private var bubbleContext = BubbleContext()
    private var selection: Set<String>?
    /// Скрытая строка (источник меню). Прячется `contentView`, а не ячейка: прозрачность
    /// и `isHidden` самой ячейки раскладка переписывает своими атрибутами.
    private var hiddenID: String?
    private var appliedBottomToken = 0
    /// Последнее сообщённое «у низа ли лента»; `nil` — ещё ни разу. Первое состояние
    /// сообщается всегда (с первой расстановки): чат, открытый сразу у низа, — уже
    /// увиденный до конца, и счётчик на кнопке «вниз» после прокрутки вверх не должен
    /// вспоминать старое непрочитанное.
    private var reportedAtBottom: Bool?
    /// Последняя сообщённая нижняя видимая строка — сообщаем только смену.
    private var reportedLowestVisible: String?
    private var appliedFocus: MessageFocus?
    /// Номер последней применённой ленты; `nil` — ещё ни одной.
    private var appliedRevision: Int?
    /// Вела ли лента за новыми сообщениями на прошлом срезе. Окно истории, сомкнувшееся
    /// со свежим, включает `followsBottom` тем же обновлением, что приносит последнюю
    /// страницу: решать по новому значению — значит считать низ окна низом переписки и
    /// уехать через всю догруженную страницу в самый конец.
    private var followedBottom = true

    private var collectionView: UICollectionView!
    private var dataSource: UICollectionViewDiffableDataSource<Date, String>!
    private var itemsByID: [String: MessageTimeline.Item] = [:]
    /// Порядок строк по дням — для ожидаемых высот в раскладке (её замыкание секции
    /// получает только номер секции).
    private var sectionItemIDs: [[String]] = []
    /// Датчик скачков (только Debug): прошлое смещение ленты.
    private var probeLastOffset: CGFloat = 0
    /// Замеренные высоты строк — общие для всех открытий переписки: второй раз та же
    /// история листается с точными высотами.
    private static let measuredHeights = MessageHeightCache()
    private var lastPageRequest: CFTimeInterval = 0
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
    /// Плавающая дата погашена. На открытии — тоже: она появляется с первым движением.
    private var headersHidden = true
    /// Дата дня, чьё начало уже ушло за верх ленты: висит у верха, пока листаешь этот
    /// день, и уступает место дате следующего, когда та подъезжает снизу.
    private let floatingDate = FloatingDateView()
    /// День, чья собственная строка даты спрятана под плавающей: иначе на подъезде к
    /// верху их было бы видно две, со сдвигом.
    private var coveredDay: Date?
    /// Плавная прокрутка к низу с живой целью: смена высоты ленты или содержимого на её
    /// ходу (новое сообщение досчитало высоту, вернулось поле ввода, выросла строка
    /// реакций) уводит её к новому низу без остановки и второго рывка.
    private let glide = MessageListGlide()
    private var animatingToBottom: Bool { glide.isRunning }
    /// Идёт применение среза: смену высоты содержимого в это время разбирает сам срез —
    /// догрузка снизу в окне истории не должна утаскивать ленту за собой.
    private var applyingSnapshot = false
    /// Снимки сообщений, к которым подъезжает лента, грузятся заранее (шаг 2.8 плана).
    private let mediaPrefetcher = ChatMediaPrefetcher()
    /// Ответ свайпом пузыря влево, как в Telegram.
    private let swipeToReply = SwipeToReply()
    /// Долгое нажатие на пузырь — меню; то же касание дальше выбирает в нём пункт.
    private let menuPress = UILongPressGestureRecognizer()
    private let menuFeedback = UIImpactFeedbackGenerator(style: .medium)
    /// Двойной тап по неинтерактивной части пузыря — реакция. Здесь, а не жестом SwiftUI
    /// на пузыре: тот висел на всём пузыре, ставил реакцию с варианта опроса и пункта
    /// чек-листа и заставлял одиночный тап по кнопке внутри ждать второго.
    private let reactionTap = UITapGestureRecognizer()
    private let reactionFeedback = UIImpactFeedbackGenerator(style: .light)

    private struct Entrance {
        let own: Bool
        let noticed: Date
    }

    /// Сколько живёт отметка о входе: не показавшееся за это время (человек далеко от
    /// низа) потом въезжать не должно — это уже не «только что пришло».
    private static let entranceLifetime: TimeInterval = 1

    private var reduceMotion: Bool { Motion.isReducedNow }

    override func viewDidLoad() {
        super.viewDidLoad()
        configureCollectionView()
        configureDataSource()
        glide.scrollView = collectionView
        glide.target = { [weak self] in self?.bottomOffset ?? 0 }
        glide.onFinish = { [weak self] in
            self?.reportBottom()
            self?.scheduleHeaderHide()
        }
    }

    /// Пружина к низу шла, когда экран начал уходить: если свайп назад отменят, она
    /// доедет.
    private var glideInterruptedByLeave = false

    /// Лента замирает с начала ухода, а не после него: во время свайпа назад она не
    /// должна ехать сама под пальцем.
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        glideInterruptedByLeave = glide.isRunning
        glide.stop()
    }

    /// Свайп назад отменён — экран остался: довести прерванную пружину.
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if glideInterruptedByLeave, sticksToBottom { glide.start() }
        glideInterruptedByLeave = false
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        glideInterruptedByLeave = false
        glide.stop()
    }

    /// Высота ленты меняется под клавиатуру, растущее поле ввода, полосы ответа и
    /// записи. Лента держится за нижний край, как в Telegram: стоял человек у последнего
    /// сообщения — остаётся у него, читал середину — нижнее видимое сообщение остаётся
    /// над полем ввода. Раньше середина держалась за верх: клавиатура закрывала то, что
    /// человек читал, а уход и возврат клавиатуры (меню, просмотр фото) уводили ленту
    /// к старым сообщениям.
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyTopInset()
        let height = collectionView.bounds.height
        defer { lastBoundsHeight = height }
        if needsInitialPosition {
            positionInitiallyIfPossible()
            return
        }
        guard hasContent, lastBoundsHeight > 0, abs(height - lastBoundsHeight) > 0.5 else { return }
        // У низа ли лента была до смены высоты: смещение пока прежнее, а высота уже новая.
        let wasNearBottom = collectionView.contentSize.height - collectionView.contentOffset.y - lastBoundsHeight < 80
        // Не по `reportedAtBottom`: он обновляется только прокруткой, и после догрузки
        // снизу без прокрутки оставался «у низа» — клавиатура уводила ленту в конец.
        if wasNearBottom || sticksToBottom {
            scrollToBottom(animated: animatingToBottom && !reduceMotion)
        } else {
            shiftKeepingBottom(by: lastBoundsHeight - height)
        }
        updateFloatingDate()
    }

    /// Сдвинуть ленту так, чтобы нижний край видимого остался на месте экрана.
    private func shiftKeepingBottom(by delta: CGFloat) {
        let inset = collectionView.adjustedContentInset
        let lowest = -inset.top
        let highest = max(lowest, collectionView.contentSize.height - collectionView.bounds.height + inset.bottom)
        let target = min(max(collectionView.contentOffset.y + delta, lowest), highest)
        guard abs(target - collectionView.contentOffset.y) > 0.5 else { return }
        collectionView.contentOffset.y = target
    }

    /// Запас снизу под кнопку «вниз». Стояла лента у низа — остаётся у нового низа.
    private var topObstruction: CGFloat = 0

    func setTopObstruction(_ y: CGFloat) {
        loadViewIfNeeded()
        topObstruction = y
        applyTopInset()
    }

    /// Отступ сверху — от верха ленты до низа панелей над ней. Считается в окне: где
    /// стоит сама лента, знает только UIKit.
    private func applyTopInset() {
        guard collectionView.window != nil, let host = collectionView.superview else { return }
        // Верх ленты на экране — по её рамке в родителе. Не `collectionView.convert(.zero)`:
        // у прокручиваемого списка точка (0, 0) — начало содержимого, она едет вместе с
        // прокруткой, и отступ сверху пересчитывался в тысячи точек посреди взмаха —
        // лента скакала (замер датчиком на устройстве: 98 → 2206, 29 445 → 29 466 pt).
        let top = host.convert(collectionView.frame.origin, to: nil).y
        let inset = max(0, topObstruction - top)
        guard abs(collectionView.contentInset.top - inset) > 0.5 else { return }
        let keepsBottom = hasContent && !needsInitialPosition && (isNearBottom || sticksToBottom)
        ScrollProbe.note("inset.top \(Int(collectionView.contentInset.top)) -> \(Int(inset)) keepsBottom=\(keepsBottom) offset=\(Int(collectionView.contentOffset.y))")
        collectionView.contentInset.top = inset
        collectionView.verticalScrollIndicatorInsets.top = inset
        if keepsBottom { scrollToBottom(animated: animatingToBottom && !reduceMotion) }
        updateFloatingDate()
    }

    func setBottomInset(_ inset: CGFloat) {
        loadViewIfNeeded()
        guard abs(collectionView.contentInset.bottom - inset) > 0.5 else { return }
        let keepsBottom = hasContent && !needsInitialPosition && (isNearBottom || sticksToBottom)
        ScrollProbe.note("inset.bottom \(Int(collectionView.contentInset.bottom)) -> \(Int(inset)) keepsBottom=\(keepsBottom)")
        collectionView.contentInset.bottom = inset
        collectionView.verticalScrollIndicatorInsets.bottom = inset
        if keepsBottom { scrollToBottom(animated: animatingToBottom && !reduceMotion) }
    }

    /// Применить срез.
    ///
    /// Два правила, ради которых всё и написано руками. Первое: если человек стоит у
    /// нижнего края, новое сообщение подматывает ленту за ним. Второе: если сверху
    /// доехала страница старых сообщений, позиция не должна шевельнуться — поэтому
    /// верхнее видимое сообщение после применения возвращается на то же место экрана.
    /// По нему, а не по выросшей высоте: в окне истории страницы доезжают и снизу, и
    /// сдвиг на их высоту унёс бы ленту прочь от того, что человек читает.
    func apply(
        days: [MessageTimeline.Day],
        revision: Int,
        anchor: String?,
        context: BubbleContext,
        selection: Set<String>? = nil
    ) {
        // Экран чата пересчитывается по многим причинам (кнопка «вниз», панели сверху,
        // закреплённое), а лента при этом та же: без раннего выхода каждый такой пересчёт
        // заново собирал и сравнивал снапшот из всех сообщений.
        let sameDays = revision == appliedRevision
        if sameDays, context == bubbleContext, selection == self.selection { return }
        appliedRevision = revision
        // Весь проход — от сборки снапшота до конца его применения (`SnapshotApply`).
        let signpost = Signposts.chats.beginInterval("SnapshotApply")
        let previous = itemsByID
        let previousSnapshot = dataSource.snapshot()
        let previousOrder = previousSnapshot.itemIdentifiers
        let previousDays = Set(previousSnapshot.sectionIdentifiers)
        // Прочтение меняет только галочки своих сообщений: перерисовываются те, чьё
        // состояние «прочитано» правда сменилось, а не вся лента. Остальное в контексте
        // (группа, поиск) касается каждой ячейки.
        let oldContext = bubbleContext
        let contextChanged = context.isGroup != oldContext.isGroup
            || context.viewerID != oldContext.viewerID
            || context.highlight != oldContext.highlight
        let readChanged = !contextChanged
            && (context.othersReadAt != oldContext.othersReadAt || context.readMarks != oldContext.readMarks)
        bubbleContext = context
        // Вход в режим выбора и выход перерисовывают все ячейки (кружки слева), а
        // касание в режиме — только те, чья отметка сменилась.
        let selectionModeChanged = (selection == nil) != (self.selection == nil)
        let toggled = (selection ?? []).symmetricDifference(self.selection ?? [])
        self.selection = selection
        itemsByID = Dictionary(
            uniqueKeysWithValues: days.flatMap(\.items).map { ($0.id, $0) }
        )
        sectionItemIDs = days.map { $0.items.map(\.id) }

        var snapshot = NSDiffableDataSourceSnapshot<Date, String>()
        snapshot.appendSections(days.map(\.id))
        for day in days {
            snapshot.appendItems(day.items.map(\.id), toSection: day.id)
        }
        // Снимок сравнивает только идентификаторы: правка, удаление, реакция или
        // прочтение без этого не перерисовали бы уже показанную ячейку.
        let changed = snapshot.itemIdentifiers.filter { id in
            guard let old = previous[id] else { return false }
            if contextChanged || selectionModeChanged || toggled.contains(id) { return true }
            if !sameDays, old != itemsByID[id] { return true }
            guard readChanged, let item = itemsByID[id] else { return false }
            return Self.readState(of: item, in: oldContext) != Self.readState(of: item, in: context)
        }
        if !changed.isEmpty { snapshot.reconfigureItems(changed) }

        let wasAtBottom = isNearBottom
        let followed = followedBottom && followsBottom
        followedBottom = followsBottom
        let oldHeight = collectionView.contentSize.height
        let oldOffset = collectionView.contentOffset.y
        let anchors = anchorCandidates(order: previousOrder)
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

        // Лента та же, сменилось содержимое пузырей (реакция, правка, подтверждение
        // отправки): высота может смениться только у них.
        let inPlace = !changed.isEmpty && snapshot.itemIdentifiers == previousOrder

        let itemCount = snapshot.numberOfItems
        ScrollProbe.note("apply items \(previousOrder.count) -> \(itemCount) firstChanged=\(previousOrder.first != snapshot.itemIdentifiers.first) lastChanged=\(previousOrder.last != snapshot.itemIdentifiers.last) reconfigured=\(changed.count) tracking=\(collectionView.isTracking) decelerating=\(collectionView.isDecelerating)")
        applyingSnapshot = true
        ScrollJankMonitor.shared.measure(.apply) {
            dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
                Signposts.chats.endInterval("SnapshotApply", signpost, "items: \(itemCount)")
                guard let self else { return }
                self.applyingSnapshot = false
                defer {
                    // Срез мог дописать ленту снизу без прокрутки — «у низа» пересчитываем.
                    self.reportBottom()
                    self.requestOlderIfScreenNotFilled()
                    self.updateFloatingDate()
                }

                if self.needsInitialPosition {
                    self.positionInitiallyIfPossible()
                    return
                }
                // Палец на ленте или она ещё катится по инерции — сама она никуда не едет:
                // иначе каждая страница, синхронизация и отметка о прочтении утягивали ленту
                // к низу из-под пальца, как только человек оказывался рядом с ним.
                let interacting = self.collectionView.isTracking || self.collectionView.isDecelerating
                // Пузырь сменил высоту на месте (строка реакций, правка) — соседи под ним
                // доезжают пружиной вместе с ним, а не прыгают на всю разницу разом.
                if inPlace, !interacting, !self.reduceMotion { self.animateLayout() }
                // Сменилась высота пузыря у низа — низ держим и в окне истории: новых
                // сообщений этот срез не принёс, уезжать некуда.
                let keepsBottom = wasAtBottom && (followed || inPlace)
                if !interacting, self.sticksToBottom || keepsBottom {
                    if followed { self.sticksToBottom = self.sticksToBottom || wasAtBottom }
                    // Плавно — новое сообщение в хвосте и смена высоты пузыря (реакция): строка
                    // реакций растёт в пузыре пружиной, и лента поднимается вместе с ней, а не
                    // прыгает. Остальное (прочтение, догрузка) держит низ без анимации. Идущую
                    // к низу прокрутку (своя отправка) срез не обрывает — она едет к новому низу.
                    let tailGrew = snapshot.itemIdentifiers.last != previousOrder.last
                    let animated = (tailGrew && !replaced) || inPlace || self.animatingToBottom
                    self.scrollToBottom(animated: animated && !self.reduceMotion)
                    return
                }
                // Держим верхнее видимое; удалено — ближайшее выжившее ниже, затем выше.
                if let anchor = anchors.first(where: { self.itemsByID[$0.id] != nil }), self.restore(anchor) {
                    return
                }
                let grown = self.collectionView.contentSize.height - oldHeight
                if grown > 0, oldOffset < grown {
                    // Выросло сверху — компенсируем, иначе лента прыгнет под пальцем.
                    ScrollProbe.note("grown compensation +\(Int(grown))")
                    self.collectionView.contentOffset.y = oldOffset + grown
                }
            }
        }
    }

    /// Галочки своего сообщения в этом контексте — как их рисует пузырь
    /// (`MessageBubbleView.isRead`, `readCount`).
    private static func readState(of item: MessageTimeline.Item, in context: BubbleContext) -> (read: Bool, count: Int) {
        guard item.isOwn else { return (false, 0) }
        let message = item.message
        let count = context.isGroup && message.sendState == .sent ? context.readCount(at: message.createdAt) : 0
        let read = (context.othersReadAt.map { $0 >= message.createdAt } ?? false) || count > 0
        return (read, count)
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
        // Досчёт высот на расстановке мог тронуть пружину к низу — первая позиция у
        // непрочитанного должна остаться на месте.
        glide.stop()
        sticksToBottom = target == nil
        reportBottom()
        // Переход к сообщению до первой расстановки: цель уже на месте — подсветить её,
        // когда лента проявится.
        let focus = pendingFocus
        reveal { [weak self] in
            if let focus { self?.finishFocusIfPending(focus) }
        }
        // Переписка показала первое содержимое — конец «открытия чата» для человека.
        // Число — заранее: строка метки — автозамыкание, и `self` в ней пришлось бы писать явно.
        let items = dataSource.snapshot().numberOfItems
        Signposts.chats.emitEvent("FirstContentFrame", "items: \(items)")
        scheduleHeaderHide()
        ScrollBenchmark.startIfRequested(on: collectionView)
    }

    /// Показать ленту после первой расстановки.
    private func reveal(completion: @escaping () -> Void = {}) {
        guard collectionView.alpha < 1 else {
            completion()
            return
        }
        onFirstShown?()
        guard !reduceMotion else {
            collectionView.alpha = 1
            completion()
            return
        }
        UIView.animate(withDuration: Motion.Duration.feedback, delay: 0, options: [.allowUserInteraction]) {
            self.collectionView.alpha = 1
        } completion: { _ in
            completion()
        }
    }

    /// Смещение ленты без оттяжки у верха: отскок не должен попадать в расстояния якорей.
    private var settledOffset: CGFloat {
        max(collectionView.contentOffset.y, -collectionView.adjustedContentInset.top)
    }

    /// Кого держать на месте при смене среза, по порядку: верхнее видимое сообщение,
    /// видимые под ним, затем несколько над ним — каждое с расстоянием от верха. Если
    /// верхнее удалят, держится ближайшее выжившее, а не грубая поправка по росту высоты.
    private func anchorCandidates(order: [String]) -> [(id: String, distance: CGFloat)] {
        let visible = collectionView.indexPathsForVisibleItems.sorted()
        guard let top = visible.first, let topID = dataSource.itemIdentifier(for: top),
            let index = order.firstIndex(of: topID)
        else { return [] }
        let below = order[(index + 1)..<min(order.count, index + max(visible.count, 1))]
        let above = order[max(0, index - 3)..<index].reversed()
        let offset = settledOffset
        return ([topID] + below + above).compactMap { id in
            guard let indexPath = dataSource.indexPath(for: id),
                let frame = collectionView.layoutAttributesForItem(at: indexPath)?.frame
            else { return nil }
            return (id, frame.minY - offset)
        }
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
        // Сравниваем со смещением без оттяжки: тянутую у верха ленту не сдёргиваем, если
        // якорь не сдвинулся.
        if abs(target - settledOffset) > 0.5 {
            ScrollProbe.note("restore pinned \(Int(collectionView.contentOffset.y)) -> \(Int(target)) decelerating=\(collectionView.isDecelerating)")
            collectionView.contentOffset.y = target
        }
        return true
    }

    // MARK: - Сборка

    private func configureCollectionView() {
        var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
        configuration.showsSeparators = false
        configuration.backgroundColor = .clear
        configuration.headerMode = .none

        // Дата дня — своя строка заранее известной высоты и без прилипания. Прилипшие
        // заголовки с замером SwiftUI на устройстве вставали мимо: дата висела у нижнего
        // края или посреди чужого дня поверх пузырей, между датой и сообщениями зияли
        // пустоты. Дату у верха при прокрутке рисует `floatingDate` поверх ленты.
        let compositional = MessageListLayout { [weak self] sectionIndex, environment in
            let section = self?.estimatedSection(sectionIndex)
                ?? NSCollectionLayoutSection.list(using: configuration, layoutEnvironment: environment)
            let header = NSCollectionLayoutBoundarySupplementaryItem(
                layoutSize: NSCollectionLayoutSize(
                    widthDimension: .fractionalWidth(1),
                    heightDimension: .absolute(DaySeparatorMetrics.height())
                ),
                elementKind: UICollectionView.elementKindSectionHeader,
                alignment: .top
            )
            section.boundarySupplementaryItems = [header]
            return section
        }

        compositional.onMeasured = { [weak self] indexPath, height in self?.recordHeight(height, at: indexPath) }
        let layout: UICollectionViewLayout = PerformanceFlags.chatHeightCache ? makeStackLayout() : compositional
        let list = MessageCollectionView(frame: .zero, collectionViewLayout: layout)
        list.onContentHeightChange = { [weak self] old in self?.contentHeightChanged(from: old) }
        collectionView = list
        collectionView.accessibilityIdentifier = "chat.messages"
        ScrollJankMonitor.shared.reportTarget = collectionView
        ScrollJankMonitor.shared.auditVisible = { [weak self] in self?.auditVisibleHeights() ?? [] }
        collectionView.backgroundColor = .clear
        collectionView.keyboardDismissMode = .interactive
        // Короткая переписка тоже тянется: жест к началу ленты есть всегда.
        collectionView.alwaysBounceVertical = true
        // Отступы задаёт экран чата (низ панелей над лентой, поле ввода), а не система:
        // лента уходит под шапку во весь экран.
        collectionView.contentInsetAdjustmentBehavior = .never
        #if compiler(>=6.2)
            // Размытие у верха рисует экран чата — плавно от края экрана; системное
            // легло бы второй полосой.
            if #available(iOS 26, *) {
                collectionView.topEdgeEffect.isHidden = true
            }
        #endif
        swipeToReply.attach(to: collectionView)
        swipeToReply.target = { [weak self] point in self?.replyTarget(at: point) }
        swipeToReply.onReply = { [weak self] message in self?.onAction?(.reply, message) }
        menuPress.minimumPressDuration = 0.3
        menuPress.addTarget(self, action: #selector(handleMenuPress(_:)))
        menuPress.delegate = self
        collectionView.addGestureRecognizer(menuPress)
        reactionTap.numberOfTapsRequired = 2
        // Касания идут в пузырь как шли: кнопки внутри срабатывают сразу, не дожидаясь,
        // будет ли второй тап.
        reactionTap.cancelsTouchesInView = false
        reactionTap.delaysTouchesEnded = false
        reactionTap.addTarget(self, action: #selector(handleReactionTap(_:)))
        reactionTap.delegate = self
        collectionView.addGestureRecognizer(reactionTap)
        collectionView.delegate = self
        collectionView.prefetchDataSource = self
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

        // Плавающая дата — над лентой, не внутри неё: раскладка ленты её не касается.
        floatingDate.alpha = 0
        floatingDate.isHidden = true
        floatingDate.onTap = { [weak self] day in self?.onDayTap?(day) }
        view.addSubview(floatingDate)
    }

    // MARK: - Ожидаемые высоты

    /// Секция дня, где у каждой строки своя ожидаемая высота: точная из кеша замеров или
    /// оценка по содержимому. Список (`.list`) считает все строки по 44 pt, и при быстрой
    /// прокрутке через ни разу не показанные строки каждая домеривалась (44 → 200) прямо
    /// на экране — лента скакала. `nil` — флаг выключен или секции нет.
    private func estimatedSection(_ index: Int) -> NSCollectionLayoutSection? {
        guard PerformanceFlags.chatEstimatedHeights, sectionItemIDs.indices.contains(index) else { return nil }
        return ScrollJankMonitor.shared.measure(.section) { buildEstimatedSection(index) }
    }

    private func buildEstimatedSection(_ index: Int) -> NSCollectionLayoutSection? {
        let ids = sectionItemIDs[index]
        guard !ids.isEmpty else { return nil }
        let width = collectionView?.bounds.width ?? 0
        var total: CGFloat = 0
        let items = ids.map { id -> NSCollectionLayoutItem in
            let height = expectedHeight(id: id, width: width)
            total += height
            return NSCollectionLayoutItem(
                layoutSize: NSCollectionLayoutSize(widthDimension: .fractionalWidth(1), heightDimension: .estimated(height))
            )
        }
        let group = NSCollectionLayoutGroup.vertical(
            layoutSize: NSCollectionLayoutSize(widthDimension: .fractionalWidth(1), heightDimension: .estimated(total)),
            subitems: items
        )
        return NSCollectionLayoutSection(group: group)
    }

    private func heightKey(id: String, width: CGFloat) -> MessageHeightKey? {
        guard let item = itemsByID[id] else { return nil }
        var hasher = Hasher()
        hasher.combine(item)
        hasher.combine(selection != nil)
        hasher.combine(bubbleContext.isGroup)
        return MessageHeightKey(
            id: id,
            revision: hasher.finalize(),
            width: Int(width),
            category: traitCollection.preferredContentSizeCategory.rawValue
        )
    }

    private func expectedHeight(id: String, width: CGFloat) -> CGFloat {
        if let key = heightKey(id: id, width: width), let known = Self.measuredHeights.height(for: key) {
            return CGFloat(known)
        }
        guard let item = itemsByID[id] else { return 44 }
        return CGFloat(MessageHeightEstimate.estimate(estimateInput(for: item), metrics: Self.estimateMetrics(width: width)))
    }

    /// Видимые строки, чья высота в раскладке разошлась с содержимым (`ScrollJankMonitor`):
    /// содержимое меряется от нулевой высоты, как его мерила бы сама ячейка без подсказки.
    private func auditVisibleHeights() -> [String] {
        let width = collectionView.bounds.width
        return collectionView.indexPathsForVisibleItems.sorted().compactMap { indexPath in
            guard let cell = collectionView.cellForItem(at: indexPath),
                let id = dataSource.itemIdentifier(for: indexPath)
            else { return nil }
            let fitted = cell.contentView.systemLayoutSizeFitting(
                CGSize(width: width, height: 0),
                withHorizontalFittingPriority: .required,
                verticalFittingPriority: .fittingSizeLevel
            ).height
            let laid = cell.frame.height
            guard abs(laid - fitted) > 2 else { return nil }
            return "\(id):\(Int(laid))/\(Int(fitted))"
        }
    }

    /// Ячейка измерила себя — запоминаем: в следующий раз строка встанет сразу своей высоты.
    private func recordHeight(_ height: CGFloat, at indexPath: IndexPath) {
        guard let id = dataSource?.itemIdentifier(for: indexPath),
            let key = heightKey(id: id, width: collectionView.bounds.width)
        else { return }
        Self.measuredHeights.store(Double(height), for: key)
    }

    /// Своя раскладка с кешем высот (шаг 2.5, флаг `chatHeightCache`).
    private func makeStackLayout() -> MessageStackLayout {
        let layout = MessageStackLayout()
        layout.headerHeight = { DaySeparatorMetrics.height() }
        layout.key = { [weak self] indexPath, width in
            guard let self, let id = self.dataSource?.itemIdentifier(for: indexPath), let item = self.itemsByID[id] else {
                return nil
            }
            var hasher = Hasher()
            hasher.combine(item)
            hasher.combine(self.selection != nil)
            hasher.combine(self.bubbleContext.isGroup)
            return MessageHeightKey(
                id: id,
                revision: hasher.finalize(),
                width: Int(width),
                category: self.traitCollection.preferredContentSizeCategory.rawValue
            )
        }
        layout.estimate = { [weak self] indexPath, width in
            guard let self, let id = self.dataSource?.itemIdentifier(for: indexPath), let item = self.itemsByID[id] else {
                return 44
            }
            return CGFloat(MessageHeightEstimate.estimate(self.estimateInput(for: item), metrics: Self.estimateMetrics(width: width)))
        }
        return layout
    }

    private func estimateInput(for item: MessageTimeline.Item) -> MessageHeightEstimate.Input {
        let message = item.message
        let media = item.attachments.filter(\.showsAsMedia)
        var input = MessageHeightEstimate.Input()
        input.textLength = message.content.count
        input.lineBreaks = message.content.reduce(0) { $1 == "\n" ? $0 + 1 : $0 }
        if media.count == 1, let only = media.first {
            let size = ChatMediaTile.singleSize(for: only)
            input.media = (Double(size.width), Double(size.height))
        } else if media.count > 1 {
            input.media = (Double(ChatMediaTile.singleWidth), Double(ChatMediaTile.singleWidth))
        }
        input.otherAttachments = item.attachments.count - media.count
        input.hasReply = message.replyToId != nil
        input.showsName = bubbleContext.isGroup && !item.isOwn && item.isFirstInGroup
        input.hasReactions = message.extras?.reactions.isEmpty == false
        input.isLastInGroup = item.isLastInGroup
        return input
    }

    private static func estimateMetrics(width: CGFloat) -> MessageHeightEstimate.Metrics {
        let body = UIFont.preferredFont(forTextStyle: .body)
        return MessageHeightEstimate.Metrics(
            textWidth: Double(min(width * 0.78, 360) - 24),
            lineHeight: Double(body.lineHeight),
            charWidth: Double(body.pointSize * 0.52),
            captionLineHeight: Double(UIFont.preferredFont(forTextStyle: .subheadline).lineHeight)
        )
    }

    private func configure(_ cell: MessageCell, id: String) {
        cell.contentView.isHidden = id == hiddenID
        guard let item = itemsByID[id] else { return }
        cell.contentConfiguration = UIHostingConfiguration {
            MessageBubbleView(
                item: item,
                context: bubbleContext,
                capabilities: capabilities?(item.message) ?? MessageCapabilities(),
                selecting: selection != nil,
                isSelected: selection?.contains(id) ?? false
            ) { [weak self] action in
                if case .menu = action {
                    self?.onMenu?(item)
                } else {
                    self?.onAction?(action, item.message)
                }
            }
            // Ссылки текста (markdown, автоссылки) — через единый открыватель, а не в
            // систему: окружение SwiftUI в ячейки `UIHostingConfiguration` не доходит,
            // поэтому ставим здесь, у каждого пузыря.
            .environment(\.openURL, ExternalLinkOpener.action)
        }
        // Как в Telegram: пузыри почти у краёв экрана, внутри группы — вплотную.
        .margins(.horizontal, Spacing.md)
        .margins(.vertical, ChatBubbleMetrics.rowMargin(isLastInGroup: item.isLastInGroup))
        cell.backgroundConfiguration = .clear()
    }

    private func configureDataSource() {
        let cell = UICollectionView.CellRegistration<MessageCell, String> {
            [weak self] cell, _, id in
            ScrollJankMonitor.shared.measure(.configure) { self?.configure(cell, id: id) }
        }


        // Обычная ячейка, не строка списка: у прилипшего заголовка списка система рисует
        // подложку во всю ширину — полосу под датой. Здесь видна только капсула даты.
        let header = UICollectionView.SupplementaryRegistration<DaySeparatorCell>(
            elementKind: UICollectionView.elementKindSectionHeader
        ) { [weak self] view, _, indexPath in
            guard let day = self?.dataSource.sectionIdentifier(for: indexPath.section) else { return }
            // Без полей: высота строки задана раскладкой (`DaySeparatorMetrics.height`), и
            // поля по умолчанию не уместились бы в неё.
            view.contentConfiguration = UIHostingConfiguration {
                DaySeparatorView(day: day) { [weak self] in self?.onDayTap?(day) }
            }
            .margins(.all, 0)
            view.automaticallyUpdatesBackgroundConfiguration = false
            view.backgroundConfiguration = .clear()
            view.backgroundColor = .clear
        }

        dataSource = UICollectionViewDiffableDataSource<Date, String>(collectionView: collectionView) {
            view, indexPath, id in
            view.dequeueConfiguredReusableCell(using: cell, for: indexPath, item: id)
        }
        dataSource.supplementaryViewProvider = { view, _, indexPath in
            view.dequeueConfiguredReusableSupplementary(using: header, for: indexPath)
        }
    }

    /// Спрятать строку `id` (и вернуть прежнюю) прямо в видимых ячейках: перенастройка
    /// пересоздала бы содержимое SwiftUI ради одного флага.
    func setHidden(_ id: String?) {
        guard id != hiddenID else { return }
        let previous = hiddenID
        hiddenID = id
        for changed in [previous, id].compactMap({ $0 }) {
            guard let indexPath = dataSource.indexPath(for: changed),
                let cell = collectionView.cellForItem(at: indexPath)
            else { continue }
            cell.contentView.isHidden = changed == id
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
            // Ленту ещё не расставили: цель и станет первой позицией, подсветка — после
            // показа ленты (`positionInitiallyIfPossible`). Таймер — только страховка.
            initialAnchor = request.id
            scheduleFocusFinish(for: request, after: Self.focusFallback)
            return
        }
        glide.stop()
        // Окно только что сменилось целиком или цель далеко — к ней сразу, без пробега
        // по ленте: так переход и выглядит в Telegram. Пробег через недели переписки
        // шёл по оценочным высотам — с пустыми кадрами, наложением пузырей и промахом.
        let recentlyReplaced = replacedAt.map { Date().timeIntervalSince($0) < 0.5 } ?? false
        collectionView.layoutIfNeeded()
        let near = isNear(indexPath)
        let animated = !recentlyReplaced && !reduceMotion && near
        if !near, !recentlyReplaced {
            crossfade { self.collectionView.scrollToItem(at: indexPath, at: Self.position(for: request), animated: false) }
        } else if animated {
            // Куда приедет лента, узнаём заранее: прокрутка без анимации и возврат в одном
            // проходе (кадра между ними нет). Стоит на месте — конца прокрутки не будет,
            // подсвечиваем сразу; едет — подсветит `scrollViewDidEndScrollingAnimation`.
            let start = collectionView.contentOffset
            collectionView.scrollToItem(at: indexPath, at: Self.position(for: request), animated: false)
            let target = collectionView.contentOffset
            collectionView.contentOffset = start
            if abs(target.y - start.y) < 0.5 {
                DispatchQueue.main.async { [weak self] in self?.finishFocusIfPending(request) }
            } else {
                collectionView.setContentOffset(target, animated: true)
                scheduleFocusFinish(for: request, after: Self.focusFallback)
            }
            return
        } else {
            collectionView.scrollToItem(at: indexPath, at: Self.position(for: request), animated: false)
        }
        // Без анимации лента уже на месте: подсветка — после текущего прохода раскладки.
        DispatchQueue.main.async { [weak self] in self?.finishFocusIfPending(request) }
    }

    /// Страховка перехода к сообщению: если конца прокрутки или первого показа ленты так
    /// и не случилось, подсветка всё равно придёт. Обычный путь — по завершению.
    private static let focusFallback: Swift.Duration = .seconds(1)

    private func finishFocusIfPending(_ request: MessageFocus) {
        guard pendingFocus == request else { return }
        finishFocus()
    }

    private static func position(for request: MessageFocus) -> UICollectionView.ScrollPosition {
        request.atTop ? .top : .centeredVertically
    }

    private func scheduleFocusFinish(for request: MessageFocus, after delay: Swift.Duration) {
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            self?.finishFocusIfPending(request)
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
        // Далеко от низа — не катимся через всю историю, а встаём к низу сразу.
        if !recentlyReplaced, distanceToBottom > collectionView.bounds.height * Self.nearScreens {
            crossfade {
                // Два прохода: первый ставит ленту по оценочным высотам, второй — по
                // настоящим высотам ячеек, оказавшихся на экране.
                for _ in 0..<2 {
                    self.scrollToBottom(animated: false)
                    self.collectionView.layoutIfNeeded()
                }
            }
            reportBottom()
            return
        }
        scrollToBottom(animated: !recentlyReplaced && !reduceMotion)
    }

    /// Сколько экранов лента проезжает анимацией; дальше — переход без пробега.
    private static let nearScreens: CGFloat = 1.5
    /// За сколько экранов до края загруженного просим следующую страницу.
    private static let preloadScreens: CGFloat = 3

    /// Цель в пределах полутора экранов от видимого — туда можно доехать анимацией.
    private func isNear(_ indexPath: IndexPath) -> Bool {
        guard let frame = collectionView.layoutAttributesForItem(at: indexPath)?.frame else { return false }
        let visibleMid = collectionView.contentOffset.y + collectionView.bounds.height / 2
        return abs(frame.midY - visibleMid) < collectionView.bounds.height * Self.nearScreens
    }

    /// Мгновенная смена места с коротким растворением, как переход к далёкому сообщению
    /// в Telegram. Без движения — просто смена.
    private func crossfade(_ change: @escaping () -> Void) {
        guard !reduceMotion else {
            change()
            return
        }
        UIView.transition(
            with: collectionView,
            duration: Motion.Duration.layer,
            options: [.transitionCrossDissolve, .allowUserInteraction],
            animations: change
        )
    }

    /// Сообщить SwiftUI, у низа ли лента. Только при смене и вне текущего прохода
    /// обновления: прокрутка случается и внутри `updateUIViewController`.
    private func reportBottom() {
        // До первой расстановки лента ещё не там, где её увидят (низ или первое
        // непрочитанное): первое сообщённое состояние — уже с неё.
        guard hasContent, !needsInitialPosition else { return }
        reportLowestVisible()
        let atBottom = isNearBottom
        guard atBottom != reportedAtBottom else { return }
        reportedAtBottom = atBottom
        DispatchQueue.main.async { [weak self] in
            self?.onBottomChange?(atBottom)
        }
    }

    /// Нижняя строка, видимая между панелями сверху и полем ввода (IOS_RULES 6.6.1): не
    /// `visibleCells` целиком — в них и строки под шапкой, и запас предзагрузки.
    private func reportLowestVisible() {
        let top = collectionView.contentOffset.y + collectionView.contentInset.top
        let bottom = collectionView.contentOffset.y + collectionView.bounds.height - collectionView.contentInset.bottom
        guard bottom > top else { return }
        let frames = collectionView.indexPathsForVisibleItems.compactMap { indexPath -> ReadVisibility.Frame? in
            guard let id = dataSource.itemIdentifier(for: indexPath),
                let frame = collectionView.layoutAttributesForItem(at: indexPath)?.frame
            else { return nil }
            return ReadVisibility.Frame(id: id, minY: frame.minY, maxY: frame.maxY)
        }
        let lowest = ReadVisibility.lowestVisible(frames, band: top...bottom)
        guard lowest != reportedLowestVisible else { return }
        reportedLowestVisible = lowest
        DispatchQueue.main.async { [weak self] in
            self?.onLowestVisible?(lowest)
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

    /// Смещение, при котором лента стоит на самом низу.
    private var bottomOffset: CGFloat {
        max(
            -collectionView.adjustedContentInset.top,
            collectionView.contentSize.height
                - collectionView.bounds.height
                + collectionView.adjustedContentInset.bottom
        )
    }

    /// Плавно — пружиной с живой целью (`MessageListGlide`), мгновенная установка
    /// обрывает идущую пружину.
    private func scrollToBottom(animated: Bool) {
        ScrollProbe.note("scrollToBottom animated=\(animated) offset=\(Int(collectionView.contentOffset.y))")
        if animated {
            glide.start()
            return
        }
        glide.stop()
        let bottom = bottomOffset
        guard abs(collectionView.contentOffset.y - bottom) > 0.5 else { return }
        collectionView.setContentOffset(CGPoint(x: 0, y: bottom), animated: false)
    }

    /// Досчитать высоты сменившихся пузырей в анимации: строки под пузырём едут вслед за
    /// ним той же пружиной, что растёт его содержимое (`Motion.lively`). Если досчёт уже
    /// случился при применении среза, анимировать нечего — лента просто остаётся как есть.
    private func animateLayout() {
        guard !reduceMotion else {
            collectionView.layoutIfNeeded()
            return
        }
        UIView.animate(
            springDuration: 0.3,
            bounce: 0.2,
            options: [.allowUserInteraction, .beginFromCurrentState]
        ) {
            self.collectionView.layoutIfNeeded()
        }
    }

    /// Высота содержимого сменилась без прокрутки: пузырь досчитал себя, догрузилась
    /// картинка, выросла или пропала строка реакций. Стояла лента на низу — едет к новому
    /// низу пружиной. Раньше низ держала раскладка мгновенным сдвигом на всю разницу: всё
    /// над пузырём прыгало вверх, пока сам он рос плавно.
    private func contentHeightChanged(from oldHeight: CGFloat) {
        guard hasContent, !needsInitialPosition, !applyingSnapshot, pendingFocus == nil,
            !glide.isRunning, !collectionView.isTracking, !collectionView.isDecelerating
        else { return }
        let inset = collectionView.adjustedContentInset
        let height = collectionView.bounds.height
        let oldBottom = oldHeight - height + inset.bottom
        let wasAtBottom = oldHeight + inset.top + inset.bottom > height
            && collectionView.contentOffset.y >= oldBottom - 1
        guard sticksToBottom || wasAtBottom else { return }
        scrollToBottom(animated: !reduceMotion)
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

    // MARK: - Меню долгим нажатием

    /// Сообщение, чей пузырь под пальцем; вне пузыря (поля строки, аватар) меню нет.
    private func menuItem(at point: CGPoint) -> MessageTimeline.Item? {
        guard selection == nil,
            let indexPath = collectionView.indexPathForItem(at: point),
            let id = dataSource.itemIdentifier(for: indexPath),
            let item = itemsByID[id],
            let bubble = BubbleAnchors.shared.rect(for: id, part: .bubble)
        else { return nil }
        let inWindow = collectionView.convert(point, to: nil)
        return bubble.insetBy(dx: -4, dy: -4).contains(inWindow) ? item : nil
    }

    @objc private func handleMenuPress(_ press: UILongPressGestureRecognizer) {
        let touch = MessageMenuTouch.shared
        switch press.state {
        case .began:
            guard let item = menuItem(at: press.location(in: collectionView)) else { return }
            touch.reset()
            // Толчок — в тот же миг, когда сработало нажатие, как в Telegram, а не
            // когда меню уже показалось.
            menuFeedback.impactOccurred()
            onMenu?(item)
        case .changed:
            touch.move(to: press.location(in: nil))
        case .ended:
            touch.release(at: press.location(in: nil))
        case .cancelled, .failed:
            touch.reset()
        default:
            break
        }
    }

    // MARK: - Реакция двойным тапом

    /// Сообщение под пальцем, если двойной тап по этому месту ставит реакцию: пузырь
    /// дошёл до сервера, не удалён, а палец не на живом элементе (`bubbleControl`).
    private func reactionItem(at point: CGPoint) -> MessageTimeline.Item? {
        guard let item = menuItem(at: point),
            item.message.remoteId != nil, item.message.deletedAt == nil,
            let indexPath = collectionView.indexPathForItem(at: point),
            let cell = collectionView.cellForItem(at: indexPath),
            !BubbleControlZone.contains(collectionView.convert(point, to: cell), in: cell)
        else { return nil }
        return item
    }

    @objc private func handleReactionTap(_ tap: UITapGestureRecognizer) {
        guard tap.state == .ended, let item = reactionItem(at: tap.location(in: collectionView)) else { return }
        reactionFeedback.impactOccurred()
        onAction?(.react(ChatReactions.doubleTap), item.message)
    }

    // MARK: - Ответ свайпом

    /// Строка под пальцем, если на её сообщение можно ответить: не в режиме выбора, не
    /// удалённое и не системное, уже дошедшее до сервера — как пункт «Ответить» в меню.
    private func replyTarget(at point: CGPoint) -> (cell: UICollectionViewCell, message: MessageRecord)? {
        guard selection == nil,
            let indexPath = collectionView.indexPathForItem(at: point),
            let id = dataSource.itemIdentifier(for: indexPath),
            let item = itemsByID[id],
            let cell = collectionView.cellForItem(at: indexPath)
        else { return nil }
        let message = item.message
        guard message.remoteId != nil, message.deletedAt == nil, message.systemType == nil else { return nil }
        return (cell, message)
    }

    // MARK: - Плавающая дата

    /// Плавающая дата гаснет через полторы секунды покоя и возвращается с первым
    /// движением ленты — как в Telegram. Даты на своих местах в ленте не гаснут: раньше
    /// гасилась «прилипшая», и дата, прилипшая на пару точек у самого верха, пропадала со
    /// своего места — над днём зияла дыра, а со следующей прокруткой (своя отправка)
    /// дата выскакивала обратно вместе с прыжком ленты.
    private func scheduleHeaderHide() {
        headerHideTask?.cancel()
        headerHideTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(1500))
            guard !Task.isCancelled else { return }
            self?.hideFloatingHeaders()
        }
    }

    private func hideFloatingHeaders() {
        guard !headersHidden,
            !collectionView.isTracking, !collectionView.isDragging, !collectionView.isDecelerating
        else { return }
        headersHidden = true
        let floating = floatingDate
        let scales = !reduceMotion
        UIView.animate(
            withDuration: Motion.Duration.surface,
            delay: 0,
            options: [.allowUserInteraction, .beginFromCurrentState]
        ) {
            floating.alpha = 0
            if scales { floating.transform = CGAffineTransform(scaleX: 0.85, y: 0.85) }
        } completion: { [weak self] _ in
            // Плавающей больше нет — своя строка дня снова на месте.
            self?.updateFloatingDate()
        }
    }

    private func showHeaders() {
        guard headersHidden else { return }
        headersHidden = false
        updateFloatingDate()
        let floating = floatingDate
        UIView.animate(
            withDuration: Motion.Duration.layer,
            delay: 0,
            options: [.allowUserInteraction, .beginFromCurrentState]
        ) {
            floating.alpha = 1
            floating.transform = .identity
        }
        // Лента сдвинулась не пальцем (подмотка, догрузка) — конца движения не будет,
        // и погасить дату снова должен таймер.
        scheduleHeaderHide()
    }

    /// Поставить плавающую дату по текущей прокрутке. Зовётся на каждом кадре
    /// прокрутки: только чтение готовой раскладки, без замеров.
    private func updateFloatingDate() {
        guard isViewLoaded else { return }
        let placement = hasContent && !needsInitialPosition ? floatingPlacement() : nil
        if let placement {
            let height = DaySeparatorMetrics.height()
            floatingDate.day = placement.day
            // Через `bounds` и `center`, не `frame`: у гаснущей даты сжатие.
            floatingDate.bounds = CGRect(x: 0, y: 0, width: view.bounds.width, height: height)
            floatingDate.center = CGPoint(x: view.bounds.midX, y: placement.top + height / 2)
            floatingDate.isHidden = false
        } else {
            floatingDate.isHidden = true
        }
        // Своя строка дня прячется, только пока плавающая на виду. VoiceOver читает
        // даты по строкам ленты — для него плавающей нет, и прятать нечего.
        let covered = headersHidden || VoiceOver.isRunning ? nil : placement?.day
        guard covered != coveredDay else { return }
        coveredDay = covered
        let kind = UICollectionView.elementKindSectionHeader
        for indexPath in collectionView.indexPathsForVisibleSupplementaryElements(ofKind: kind) {
            guard let header = collectionView.supplementaryView(forElementKind: kind, at: indexPath) as? UICollectionViewCell
            else { continue }
            header.contentView.isHidden = covered != nil && dataSource.sectionIdentifier(for: indexPath.section) == covered
        }
    }

    /// День сообщения у верха ленты и где стоит его плавающая дата (в координатах
    /// экрана ленты); `nil` — своя строка этого дня ещё на месте или ниже, вторая не нужна.
    /// Дата следующего дня, подъезжая снизу, выталкивает плавающую вверх — как прилипшие
    /// заголовки, только без их раскладки.
    private func floatingPlacement() -> (day: Date, top: CGFloat)? {
        let kind = UICollectionView.elementKindSectionHeader
        let height = DaySeparatorMetrics.height()
        let offset = collectionView.contentOffset.y
        let slot = collectionView.contentInset.top
        // Сообщение сразу под местом плавающей даты.
        let line = offset + slot + height
        let current = collectionView.indexPathsForVisibleItems.sorted().first { indexPath in
            (collectionView.layoutAttributesForItem(at: indexPath)?.frame.maxY ?? -.greatestFiniteMagnitude) > line
        }
        guard let section = current?.section,
            let day = dataSource.sectionIdentifier(for: section),
            let own = collectionView.layoutAttributesForSupplementaryElement(
                ofKind: kind, at: IndexPath(item: 0, section: section)
            ),
            own.frame.minY - offset < slot - 0.5
        else { return nil }
        var top = slot
        let next = section + 1
        if next < collectionView.numberOfSections,
            let following = collectionView.layoutAttributesForSupplementaryElement(
                ofKind: kind, at: IndexPath(item: 0, section: next)
            )
        {
            top = min(top, following.frame.minY - offset - height)
        }
        return (day, top)
    }
}

extension MessageListViewController: UIGestureRecognizerDelegate {
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        if gestureRecognizer === reactionTap {
            return reactionItem(at: gestureRecognizer.location(in: collectionView)) != nil
        }
        guard gestureRecognizer === menuPress else { return true }
        return menuItem(at: gestureRecognizer.location(in: collectionView)) != nil
    }

    /// Двойной тап не спорит с жестами SwiftUI в ячейке: живые элементы он отсекает сам
    /// (`reactionItem`), а без одновременности его гасило бы любое касание внутри.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        gestureRecognizer === reactionTap
    }
}

extension MessageListViewController: UICollectionViewDataSourcePrefetching {
    func collectionView(_ collectionView: UICollectionView, prefetchItemsAt indexPaths: [IndexPath]) {
        mediaPrefetcher.prefetch(prefetchable(at: indexPaths), scale: traitCollection.displayScale)
    }

    func collectionView(_ collectionView: UICollectionView, cancelPrefetchingForItemsAt indexPaths: [IndexPath]) {
        mediaPrefetcher.cancel(prefetchable(at: indexPaths).map(\.id))
    }

    /// Одиночный снимок сообщения: его плитку размер знает заранее
    /// (`ChatMediaTile.singleSize`), а значит, и ключ кеша. Альбомы раскладываются по
    /// месту — их не греем, чтобы не качать копию не того размера.
    private func prefetchable(at indexPaths: [IndexPath]) -> [AttachmentRecord] {
        indexPaths.compactMap { indexPath in
            guard let id = dataSource.itemIdentifier(for: indexPath),
                let item = itemsByID[id], item.message.deletedAt == nil
            else { return nil }
            let media = item.attachments.filter(\.showsAsMedia)
            guard media.count == 1, let only = media.first, only.chatKind == .photo else { return nil }
            return only
        }
    }
}

extension MessageListViewController: UICollectionViewDelegate {
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        ScrollJankMonitor.shared.measure(.scrollHandler) { handleScroll(scrollView) }
    }

    private func handleScroll(_ scrollView: UIScrollView) {
        #if DEBUG
            let jump = scrollView.contentOffset.y - probeLastOffset
            if abs(jump) > 200 {
                ScrollProbe.note("JUMP \(Int(probeLastOffset)) -> \(Int(scrollView.contentOffset.y)) (\(Int(jump))) tracking=\(scrollView.isTracking) decelerating=\(scrollView.isDecelerating) contentHeight=\(Int(scrollView.contentSize.height))")
            }
            probeLastOffset = scrollView.contentOffset.y
        #endif
        guard hasContent else { return }
        reportBottom()
        // Дата возвращается, когда ленту листает человек. Сдвиг самой программой (досчёт
        // высоты картинки у низа, удержание места при догрузке) её не будит: иначе она
        // вспыхивала бы у верха посреди чтения.
        if headersHidden, scrollView.isDragging || scrollView.isDecelerating { showHeaders() }
        updateFloatingDate()
        // Подгружаем заранее, как Telegram: за три экрана до края. С запасом в один экран
        // быстрая прокрутка упиралась в край раньше, чем приходила страница, — лента
        // вставала, а потом прыгала, когда страница всё же доезжала.
        let preload = scrollView.bounds.height * Self.preloadScreens
        // Просьба о странице — не чаще раза в треть секунды: на каждом кадре прокрутки
        // она порождала задачу, а страница всё равно одна.
        let now = CACurrentMediaTime()
        guard now - lastPageRequest > 0.3 else { return }
        if scrollView.contentOffset.y < preload {
            lastPageRequest = now
            onReachTop?()
        }
        let distance = scrollView.contentSize.height - scrollView.contentOffset.y - scrollView.bounds.height
        if distance < preload {
            lastPageRequest = now
            onReachBottom?()
        }
    }

    /// Человек взял ленту пальцем — программа больше не ведёт её к низу и к цели.
    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        ScrollJankMonitor.shared.begin()
        sticksToBottom = false
        glide.stop()
        pendingFocus = nil
        headerHideTask?.cancel()
        showHeaders()
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate {
            ScrollJankMonitor.shared.end()
            scheduleHeaderHide()
        }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        ScrollJankMonitor.shared.end()
        scheduleHeaderHide()
    }

    /// Касание строки состояния уводит к началу — тоже решение человека. Издалека — без
    /// системного пробега через всю загруженную историю (пустые кадры по пути), сразу.
    func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool {
        sticksToBottom = false
        glide.stop()
        pendingFocus = nil
        let top = -scrollView.adjustedContentInset.top
        guard scrollView.contentOffset.y - top > scrollView.bounds.height * Self.nearScreens else { return true }
        showHeaders()
        crossfade {
            scrollView.setContentOffset(CGPoint(x: 0, y: top), animated: false)
        }
        reportBottom()
        return false
    }

    /// Конец системной прокрутки — к сообщению (переход, ответ). К низу лента едет своей
    /// пружиной (`MessageListGlide`): досаживать её на настоящий низ второй анимацией
    /// больше не нужно.
    func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
        if pendingFocus != nil {
            finishFocus()
        }
        reportBottom()
        scheduleHeaderHide()
    }

    func collectionView(_ collectionView: UICollectionView, willDisplay cell: UICollectionViewCell, forItemAt indexPath: IndexPath) {
        // Ячейка могла прийти из переиспользования посреди подсветки другого сообщения.
        cell.contentView.backgroundColor = .clear
        let id = dataSource.itemIdentifier(for: indexPath)
        cell.contentView.isHidden = id != nil && id == hiddenID
        guard let id,
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
        guard let header = view as? UICollectionViewCell else { return }
        // Заголовок мог прийти из переиспользования посреди появления или спрятанным
        // под плавающей датой другого дня.
        header.contentView.alpha = 1
        header.contentView.transform = .identity
        let day = dataSource.sectionIdentifier(for: indexPath.section)
        header.contentView.isHidden = coveredDay != nil && day == coveredDay
        guard let day,
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

/// Разделитель дня — капсула по центру, на iOS 26 в стекле. Строка ленты над первым
/// сообщением дня и она же — плавающая дата у верха. Нажатие открывает календарь, как в
/// Telegram.
private struct DaySeparatorView: View {
    let day: Date
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(DaySeparatorMetrics.title(for: day))
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
}

/// Размеры даты дня без замера SwiftUI: строка даты в раскладке ленты — заранее
/// известной высоты, а плавающая дата ловит касания только по капсуле.
enum DaySeparatorMetrics {
    /// Строка `footnote`, поля капсулы 4 + 4 и вокруг неё по 6 сверху и снизу — как
    /// в `DaySeparatorView`.
    static func height() -> CGFloat {
        let line = UIFont.preferredFont(forTextStyle: .footnote).lineHeight
        return (line + Spacing.xs * 2 + Spacing.sm * 2).rounded(.up)
    }

    /// Ширина капсулы с датой этого дня.
    static func capsuleWidth(for day: Date) -> CGFloat {
        let size = UIFont.preferredFont(forTextStyle: .footnote).pointSize
        let font = UIFont.systemFont(ofSize: size, weight: .semibold)
        let text = (title(for: day) as NSString).size(withAttributes: [.font: font]).width
        return text.rounded(.up) + Spacing.lg * 2
    }

    static func title(for day: Date) -> String {
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

/// Плавающая дата над лентой. Полоса во всю ширину, но касания ловит только капсула:
/// вокруг неё — пузыри, и пустая полоса не должна их перекрывать.
final class FloatingDateView: UIView {
    var onTap: ((Date) -> Void)?
    private var content: (UIView & UIContentView)?

    /// День на капсуле; содержимое пересобирается только при смене дня.
    var day: Date? {
        didSet {
            guard let day, day != oldValue else { return }
            let configuration = UIHostingConfiguration {
                DaySeparatorView(day: day) { [weak self] in self?.onTap?(day) }
            }
            .margins(.all, 0)
            if let content {
                content.configuration = configuration
            } else {
                let view = configuration.makeContentView()
                view.frame = bounds
                view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                addSubview(view)
                content = view
            }
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        // Повтор даты из ленты: VoiceOver читает её по строкам дней.
        accessibilityElementsHidden = true
    }

    required init?(coder: NSCoder) { fatalError() }

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard alpha > 0.01, let day else { return false }
        let width = DaySeparatorMetrics.capsuleWidth(for: day)
        return CGRect(x: bounds.midX - width / 2, y: 0, width: width, height: bounds.height).contains(point)
    }
}

/// Системный список ленты с одной поправкой: ячейка, досчитавшая свою высоту выше
/// видимого, не сдвигает то, что на экране.
///
/// Список ставит ещё не виденные ячейки по оценке (44 точки), а настоящая высота пузыря —
/// от строки до экрана картинки. Листаешь вверх — ячейка входит сверху, меряет себя, и без
/// поправки всё под ней (то, что под пальцем) уезжало на разницу: лента прыгала на каждом
/// сообщении, а на свежей странице истории — на каждом втором.
///
/// Низ раскладка не держит: мгновенный сдвиг на всю разницу был прыжком ленты при каждой
/// реакции и отправке, пока сам пузырь рос плавно. Низ держит лента пружиной
/// (`MessageListViewController.contentHeightChanged`).
final class MessageListLayout: UICollectionViewCompositionalLayout {
    override func prepare() {
        ScrollJankMonitor.shared.measure(.layoutQuery) { super.prepare() }
    }

    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        ScrollJankMonitor.shared.measure(.layoutQuery) { super.layoutAttributesForElements(in: rect) }
    }

    /// Ячейка измерила себя (высота — её настоящая). Для кеша ожидаемых высот.
    var onMeasured: ((IndexPath, CGFloat) -> Void)?

    override func shouldInvalidateLayout(
        forPreferredLayoutAttributes preferred: UICollectionViewLayoutAttributes,
        withOriginalAttributes original: UICollectionViewLayoutAttributes
    ) -> Bool {
        if original.representedElementCategory == .cell {
            onMeasured?(original.indexPath, preferred.frame.height)
        }
        return super.shouldInvalidateLayout(forPreferredLayoutAttributes: preferred, withOriginalAttributes: original)
    }

    override func invalidationContext(
        forPreferredLayoutAttributes preferred: UICollectionViewLayoutAttributes,
        withOriginalAttributes original: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutInvalidationContext {
        let context = super.invalidationContext(
            forPreferredLayoutAttributes: preferred,
            withOriginalAttributes: original
        )
        // Сдвиг уже назначила сама система — второй раз не двигаем.
        guard let collectionView, original.representedElementCategory == .cell,
            context.contentOffsetAdjustment == .zero
        else { return context }
        let delta = preferred.frame.height - original.frame.height
        guard abs(delta) > 0.5 else { return context }
        // Ячейка пересчитала высоту после показа: оценка разошлась с настоящей. Сколько
        // таких событий на прокрутку — главный счётчик кеша высот (план, шаг 2.5).
        Signposts.chats.emitEvent("CellRemeasure")
        let inset = collectionView.adjustedContentInset
        let offset = collectionView.contentOffset.y
        let above = original.frame.minY < offset + inset.top - 0.5
        ScrollJankMonitor.shared.noteRemeasure(above: above)
        guard above else { return context }
        // Не выше начала ленты.
        context.contentOffsetAdjustment = CGPoint(x: 0, y: max(delta, -(offset + inset.top)))
        ScrollProbe.note("remeasure above top \(Int(original.frame.height)) -> \(Int(preferred.frame.height)) adjust=\(Int(context.contentOffsetAdjustment.y))")
        return context
    }
}

/// Ячейка сообщения. С кешем высот (`MessageStackLayout`, флаг `chatHeightCache`) она
/// меряет себя сама от минимальной высоты: стандартный замер ячейки отталкивается от
/// предложенной раскладкой высоты — оценки, — и содержимое SwiftUI, способное
/// растянуться, возвращало её обратно. Завышенная оценка так и оставалась дырой под
/// пузырём (`PerformanceFlagUITests` ловит это сравнением ленты с флагом и без).
final class MessageCell: UICollectionViewListCell {
    override func layoutSubviews() {
        ScrollJankMonitor.shared.measure(.cellLayout) { super.layoutSubviews() }
    }

    override func preferredLayoutAttributesFitting(
        _ layoutAttributes: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutAttributes {
        ScrollJankMonitor.shared.measure(.sizing) { fit(layoutAttributes) }
    }

    private func fit(_ layoutAttributes: UICollectionViewLayoutAttributes) -> UICollectionViewLayoutAttributes {
        let attributes = super.preferredLayoutAttributesFitting(layoutAttributes)
        guard PerformanceFlags.chatHeightCache else { return attributes }
        let fitted = contentView.systemLayoutSizeFitting(
            CGSize(width: layoutAttributes.size.width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
        attributes.frame.size = CGSize(width: layoutAttributes.size.width, height: ceil(fitted.height))
        return attributes
    }
}

/// Строка даты дня. Своим классом — чтобы замер (`ScrollJankMonitor`) видел её раскладку
/// отдельно от пузырей.
final class DaySeparatorCell: UICollectionViewCell {
    override func layoutSubviews() {
        ScrollJankMonitor.shared.measure(.headerLayout) { super.layoutSubviews() }
    }
}
