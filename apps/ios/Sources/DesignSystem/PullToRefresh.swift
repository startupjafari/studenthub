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
        refreshable(action: action)
            .background(PullTunerProbe().accessibilityHidden(true))
    }
}

/// Пустой вид рядом со списком: по нему находится прокрутка с обновлением.
private struct PullTunerProbe: UIViewRepresentable {
    func makeUIView(context: Context) -> ProbeView { ProbeView() }
    func updateUIView(_ view: ProbeView, context: Context) { view.attachSoon() }

    final class ProbeView: UIView {
        override init(frame: CGRect) {
            super.init(frame: frame)
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
            guard window != nil else { return }
            for delay in [0.0, 0.25, 0.8] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    self?.attach()
                }
            }
        }

        private func attach() {
            guard let window, let scrollView = findScrollView(in: window) else { return }
            PullTuner.install(on: scrollView)
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
    private var observation: NSKeyValueObservation?
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let feedback = UIImpactFeedbackGenerator(style: .light)
    /// Отступ сверху без добавки, которую система даёт на время обновления.
    private var baseInset: CGFloat = 0
    private var wasRefreshing = false
    private var isClamping = false
    private var hidSearch = false

    static func install(on scrollView: UIScrollView) {
        guard objc_getAssociatedObject(scrollView, &key) == nil else { return }
        let tuner = PullTuner(scrollView: scrollView)
        objc_setAssociatedObject(scrollView, &key, tuner, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    private init(scrollView: UIScrollView) {
        self.scrollView = scrollView
        super.init()
        spinner.hidesWhenStopped = false
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

    private func update() {
        guard let scrollView, !isClamping else { return }
        if !hidSearch, !scrollView.isTracking { hideSearchInitially() }
        let control = scrollView.refreshControl
        let refreshing = control?.isRefreshing == true
        if !refreshing, !scrollView.isTracking, !scrollView.isDecelerating {
            baseInset = scrollView.adjustedContentInset.top
        }
        // Сколько открыто над первой строкой.
        let pull = -(scrollView.contentOffset.y + baseInset)

        if scrollView.isTracking, pull > Self.maxPull {
            isClamping = true
            scrollView.contentOffset.y = -(baseInset + Self.maxPull)
            isClamping = false
        }

        if refreshing, !wasRefreshing { feedback.impactOccurred() }
        if !refreshing { feedback.prepare() }
        wasRefreshing = refreshing

        control?.tintColor = .clear
        let shown = min(pull, Self.maxPull)
        if shown > 8 || refreshing {
            // Посередине пустоты между шапкой и первой строкой.
            let top = scrollView.contentOffset.y + baseInset
            spinner.center = CGPoint(x: scrollView.bounds.midX, y: top / 2)
            spinner.alpha = refreshing ? 1 : min(1, shown / 60)
            if refreshing, !spinner.isAnimating { spinner.startAnimating() }
            if !refreshing, spinner.isAnimating { spinner.stopAnimating() }
            scrollView.bringSubviewToFront(spinner)
        } else {
            spinner.alpha = 0
            if spinner.isAnimating { spinner.stopAnimating() }
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
