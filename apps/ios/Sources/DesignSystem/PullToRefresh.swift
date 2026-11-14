import SwiftUI
import UIKit

extension View {
    /// Обновление оттягиванием, как в Telegram, — вместо голого `.refreshable`.
    ///
    /// Механика — системная (`refreshable`), поверх неё прокрутка списка доводится
    /// через UIKit (`PullTuner`): оттянуть можно не дальше предела, индикатор крутится
    /// посередине открывшейся пустоты (системный на iOS 26 прилипал под шапку, на поле
    /// поиска), в момент срабатывания — лёгкий толчок, а поиск в шапке при открытии
    /// экрана спрятан и выезжает, когда список тянут вниз.
    func pullToRefresh(action: @escaping @Sendable () async -> Void) -> some View {
        modifier(PullToRefreshModifier(action: action))
    }
}

/// Действие обновления, обёрнутое сигналом начала и конца для доводки.
private struct PullToRefreshModifier: ViewModifier {
    let action: @Sendable () async -> Void
    @State private var signal = PullRefreshSignal()

    func body(content: Content) -> some View {
        let signal = signal
        let action = action
        content
            .refreshable {
                await signal.begin()
                await action()
                await signal.end()
            }
            .background(PullTunerProbe(signal: signal).accessibilityHidden(true))
    }
}

/// Начало и конец обновления — от самого действия, а не догадкой по сдвигу прокрутки.
///
/// Раньше доводка читала `refreshControl.isRefreshing` только на сдвигах `contentOffset`:
/// список вставал в позицию обновления, сдвиги кончались, а флаг поднимался позже —
/// индикатор так и висел неподвижным посреди пустоты, пока шёл запрос.
@MainActor
final class PullRefreshSignal {
    fileprivate weak var tuner: PullTuner?
    fileprivate private(set) var isActive = false

    nonisolated init() {}

    func begin() {
        isActive = true
        tuner?.refreshDidBegin()
    }

    func end() {
        isActive = false
        tuner?.refreshDidEnd()
    }
}

/// Пустой вид рядом со списком: по нему находится прокрутка с обновлением.
private struct PullTunerProbe: UIViewRepresentable {
    let signal: PullRefreshSignal

    func makeUIView(context: Context) -> ProbeView { ProbeView(signal: signal) }
    func updateUIView(_ view: ProbeView, context: Context) { view.attachSoon() }

    final class ProbeView: UIView {
        /// Найденная прокрутка. Пока она жива и на экране, искать её снова незачем:
        /// `updateUIView` зовётся на каждый пересчёт экрана, а поиск — три отложенных
        /// обхода иерархии (п. 42 аудита).
        private weak var attached: UIScrollView?
        private let signal: PullRefreshSignal

        init(signal: PullRefreshSignal) {
            self.signal = signal
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            backgroundColor = .clear
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError() }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            attachSoon()
        }

        /// Список строится позже пробы — ищем его на следующих витках.
        func attachSoon() {
            guard window != nil, attached?.window == nil else { return }
            for delay in [0.0, 0.25, 0.8] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    self?.attach()
                }
            }
        }

        private func attach() {
            guard attached?.window == nil, let window, let scrollView = findScrollView(in: window) else { return }
            attached = scrollView
            PullTuner.install(on: scrollView, signal: signal)
        }

        /// Прокрутка с обновлением, внутри которой (по экрану) лежит проба: ищем вверх
        /// по предкам, в каждом — вниз по детям.
        private func findScrollView(in window: UIWindow) -> UIScrollView? {
            let center = convert(CGPoint(x: bounds.midX, y: bounds.midY), to: window)
            var ancestor: UIView? = superview
            var depth = 0
            while let current = ancestor, depth < 8 {
                if let found = Self.search(current, containing: center, in: window) { return found }
                ancestor = current.superview
                depth += 1
            }
            return nil
        }

        private static func search(_ root: UIView, containing point: CGPoint, in window: UIWindow) -> UIScrollView? {
            var queue: [UIView] = [root]
            var index = 0
            while index < queue.count, index < 400 {
                let view = queue[index]
                index += 1
                if let scroll = view as? UIScrollView, scroll.refreshControl != nil, !scroll.isHidden,
                    scroll.convert(scroll.bounds, to: window).contains(point)
                {
                    return scroll
                }
                queue.append(contentsOf: view.subviews)
            }
            return nil
        }
    }
}

/// Доводка прокрутки с системным обновлением. Одна на прокрутку: держится за неё
/// связанным объектом и живёт, пока жива она.
@MainActor
final class PullTuner: NSObject {
    /// Дальше этого список не оттягивается.
    private static let maxPull: CGFloat = 130
    private static var key: UInt8 = 0

    private weak var scrollView: UIScrollView?
    private weak var signal: PullRefreshSignal?
    private var observation: NSKeyValueObservation?
    private let spinner = RefreshSpinnerView()
    private let feedback = UIImpactFeedbackGenerator(style: .light)
    /// Отступ сверху без добавки, которую система даёт на время обновления.
    private var baseInset: CGFloat = 0
    private var wasRefreshing = false
    private var isClamping = false
    private var hidSearch = false

    static func install(on scrollView: UIScrollView, signal: PullRefreshSignal) {
        if let tuner = objc_getAssociatedObject(scrollView, &key) as? PullTuner {
            tuner.signal = signal
            signal.tuner = tuner
            return
        }
        let tuner = PullTuner(scrollView: scrollView, signal: signal)
        objc_setAssociatedObject(scrollView, &key, tuner, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    private init(scrollView: UIScrollView, signal: PullRefreshSignal) {
        self.scrollView = scrollView
        self.signal = signal
        super.init()
        signal.tuner = self
        spinner.alpha = 0
        spinner.isUserInteractionEnabled = false
        scrollView.addSubview(spinner)
        // Системный индикатор прячем: его место решаем сами.
        scrollView.refreshControl?.tintColor = .clear
        baseInset = scrollView.adjustedContentInset.top
        observation = scrollView.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.update() }
        }
        hideSearchInitially()
    }

    /// Обновление идёт: действие ещё не вернулось или система держит индикатор.
    private var isRefreshing: Bool {
        signal?.isActive == true || scrollView?.refreshControl?.isRefreshing == true
    }

    /// Действие началось — индикатор крутится сразу, не дожидаясь следующего сдвига.
    fileprivate func refreshDidBegin() {
        update()
    }

    /// Действие вернулось. Система должна сама снять обновление и вернуть список, но
    /// бывало, что список так и оставался оттянутым: снимаем и возвращаем сами.
    fileprivate func refreshDidEnd() {
        DispatchQueue.main.async { [weak self] in
            guard let self, let scrollView = self.scrollView, self.signal?.isActive != true else { return }
            if scrollView.refreshControl?.isRefreshing == true {
                scrollView.refreshControl?.endRefreshing()
            }
            self.update()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
                self?.settleIfStuck()
            }
        }
    }

    /// Обновления нет, пальца на списке нет, а он всё ещё оттянут — довести до верха.
    private func settleIfStuck() {
        guard let scrollView, !isRefreshing, !scrollView.isTracking, !scrollView.isDecelerating else { return }
        let rest = -scrollView.adjustedContentInset.top
        if scrollView.contentOffset.y < rest - 1 {
            scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: rest), animated: true)
        }
        hideSpinner()
    }

    private func hideSpinner() {
        guard spinner.alpha > 0 || spinner.isSpinning else { return }
        UIView.animate(withDuration: 0.2) { self.spinner.alpha = 0 } completion: { _ in
            if !self.isRefreshing { self.spinner.stopSpinning() }
        }
    }

    private func update() {
        guard let scrollView, !isClamping else { return }
        if !hidSearch, !scrollView.isTracking { hideSearchInitially() }
        let control = scrollView.refreshControl
        let refreshing = isRefreshing
        // Отступ шапки берём живым всегда, кроме пальца на списке (большой заголовок
        // растягивается под ним) и самого обновления (система добавляет свой). Раньше
        // он не обновлялся и по инерции — после броска к верху отступ оставался старым,
        // и в покое над первой строкой висел неподвижный индикатор.
        if !refreshing, !scrollView.isTracking {
            baseInset = scrollView.adjustedContentInset.top
        }
        // Сколько открыто над первой строкой.
        let pull = -(scrollView.contentOffset.y + baseInset)
        // Список прокручен вниз, его не тянут и не обновляют, индикатор спрятан: на
        // каждом кадре прокрутки делать нечего (п. 42) — раньше здесь каждый кадр
        // ставились цвет и `prepare()` тактильного отклика.
        if pull <= 0, !refreshing, !wasRefreshing, spinner.alpha == 0 { return }

        if scrollView.isTracking, pull > Self.maxPull {
            isClamping = true
            scrollView.contentOffset.y = -(baseInset + Self.maxPull)
            isClamping = false
        }

        if refreshing, !wasRefreshing { feedback.impactOccurred() }
        if !refreshing { feedback.prepare() }
        wasRefreshing = refreshing

        if control?.tintColor != .clear { control?.tintColor = .clear }
        let shown = min(pull, Self.maxPull)
        if shown > 8 || refreshing {
            // Посередине пустоты между шапкой и первой строкой.
            let top = scrollView.contentOffset.y + baseInset
            spinner.center = CGPoint(x: scrollView.bounds.midX, y: top / 2)
            spinner.alpha = refreshing ? 1 : min(1, shown / 60)
            // Пока тянут — дуга дорисовывается и поворачивается вслед за пальцем; пошло
            // обновление — крутится сама, пока оно не кончится.
            if refreshing, !spinner.isSpinning { spinner.startSpinning() }
            if !refreshing {
                if spinner.isSpinning { spinner.stopSpinning() }
                spinner.setProgress(min(1, shown / 80))
            }
            scrollView.bringSubviewToFront(spinner)
        } else {
            spinner.alpha = 0
            if spinner.isSpinning { spinner.stopSpinning() }
        }
    }

    /// Поиск в шапке, как в Telegram, при открытии спрятан: список чуть прокручен под
    /// него, а оттянув список вниз, поиск возвращают.
    ///
    /// Только до iOS 26. Там поле поиска от такого сдвига не сворачивается: оно остаётся
    /// на месте, а под ним и под заголовком оказываются первые строки — вкладки папок
    /// наслаивались на «Поиск» и на «Чаты». Поиск на iOS 26 сворачивает сама система.
    private func hideSearchInitially() {
        if #available(iOS 26, *) {
            hidSearch = true
            return
        }
        guard !hidSearch, let scrollView, let controller = Self.viewController(of: scrollView),
            let search = controller.navigationItem.searchController ?? controller.parent?.navigationItem.searchController,
            controller.navigationItem.hidesSearchBarWhenScrolling || controller.parent?.navigationItem.hidesSearchBarWhenScrolling == true
        else { return }
        let height = search.searchBar.frame.height
        // Поле ещё не разложено — попробуем на следующей прокрутке или замере.
        guard height > 0 else { return }
        hidSearch = true
        // Человек уже листает — его положение не трогаем.
        guard scrollView.contentOffset.y <= -scrollView.adjustedContentInset.top + 1 else { return }
        scrollView.setContentOffset(CGPoint(x: 0, y: scrollView.contentOffset.y + height), animated: false)
    }

    private static func viewController(of view: UIView) -> UIViewController? {
        var responder: UIResponder? = view
        while let current = responder {
            if let controller = current as? UIViewController { return controller }
            responder = current.next
        }
        return nil
    }
}

/// Индикатор обновления оттягиванием, как в Telegram и почте: пока список тянут, дуга
/// дорисовывается и поворачивается вслед за пальцем, а во время обновления крутится
/// непрерывно. Системный `UIActivityIndicatorView` до начала обновления стоял на месте
/// — пустота над списком открывалась с неподвижным значком.
final class RefreshSpinnerView: UIView {
    private static let side: CGFloat = 28
    private static let lineWidth: CGFloat = 2.5
    /// Доля круга, которую дуга занимает при полном оттягивании и во время обновления.
    private static let fullArc: CGFloat = 0.78

    private let arc = CAShapeLayer()
    private(set) var isSpinning = false

    init() {
        super.init(frame: CGRect(x: 0, y: 0, width: Self.side, height: Self.side))
        isUserInteractionEnabled = false
        arc.fillColor = UIColor.clear.cgColor
        arc.lineWidth = Self.lineWidth
        arc.lineCap = .round
        arc.strokeEnd = 0
        layer.addSublayer(arc)
        applyColor()
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: RefreshSpinnerView, _) in
            view.applyColor()
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        arc.frame = bounds
        let radius = (min(bounds.width, bounds.height) - Self.lineWidth) / 2
        arc.path = UIBezierPath(
            arcCenter: CGPoint(x: bounds.midX, y: bounds.midY),
            radius: radius,
            startAngle: -.pi / 2,
            endAngle: .pi * 1.5,
            clockwise: true
        ).cgPath
    }

    /// Насколько оттянут список, 0…1: длина дуги и её поворот.
    func setProgress(_ progress: CGFloat) {
        guard !isSpinning else { return }
        let value = min(max(progress, 0), 1)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        arc.strokeEnd = 0.04 + (Self.fullArc - 0.04) * value
        arc.setAffineTransform(CGAffineTransform(rotationAngle: value * .pi * 1.2))
        CATransaction.commit()
    }

    func startSpinning() {
        guard !isSpinning else { return }
        isSpinning = true
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        arc.strokeEnd = Self.fullArc
        CATransaction.commit()
        // Вращение продолжает поворот, на котором остался палец, — без скачка.
        let start = (arc.value(forKeyPath: "transform.rotation.z") as? CGFloat) ?? 0
        let spin = CABasicAnimation(keyPath: "transform.rotation.z")
        spin.fromValue = start
        spin.toValue = start + .pi * 2
        spin.duration = 0.75
        spin.repeatCount = .infinity
        spin.isRemovedOnCompletion = false
        arc.add(spin, forKey: "spin")
    }

    func stopSpinning() {
        guard isSpinning else { return }
        isSpinning = false
        arc.removeAnimation(forKey: "spin")
    }

    private func applyColor() {
        arc.strokeColor = UIColor.secondaryLabel.resolvedColor(with: traitCollection).cgColor
    }
}
