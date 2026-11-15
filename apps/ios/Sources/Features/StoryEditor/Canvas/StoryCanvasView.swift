import UIKit

/// Что холст позволяет делать сейчас (по состоянию редактора).
enum StoryCanvasMode: Equatable {
    /// Редактор: объекты двигаются, тап по надписи — правка, тап по пустому — новая надпись.
    case idle
    /// Рисование: касания идут в слой рисунка, объекты не двигаются.
    case drawing
    /// Размытие: жесты двигают, растягивают и поворачивают зону резкости.
    case blur
    /// Правка надписи: холст под затемнением, эта надпись скрыта.
    case textEditing(UUID)
    /// Остальные инструменты и публикация: холст только показывает.
    case locked
}

/// Действия меню долгого нажатия по объекту.
enum StoryEntityMenuAction: Sendable {
    case delete
    case duplicate
    case bringToFront
    case edit
}

/// Обратные вызовы холста. Во время жеста модель не трогается: объект двигает сам
/// холст, а итог приходит одним вызовом в конце — 120 Гц без пересчёта SwiftUI.
struct StoryCanvasCallbacks {
    var entityChanged: (UUID, StoryPoint, Double, Double) -> Void = { _, _, _, _ in }
    var mediaChanged: (StoryTransform) -> Void = { _ in }
    var entityRemoved: (UUID) -> Void = { _ in }
    var menuAction: (StoryEntityMenuAction, UUID) -> Void = { _, _ in }
    var entityTapped: (UUID) -> Void = { _ in }
    var emptyTapped: () -> Void = {}
    var strokeFinished: (StoryStroke) -> Void = { _ in }
    var blurChanged: (StoryBlur) -> Void = { _ in }
    /// Палец на холсте (перетаскивание или рисование) — панели прячутся.
    var interactionChanged: (Bool) -> Void = { _ in }
}

/// Холст редактора: фон, медиа, рисунок, объекты и единая обработка жестов.
///
/// Жесты висят на самом холсте, а не на объектах: щипок двумя пальцами по обе стороны
/// маленького стикера масштабирует его, а не промахивается. Цель жеста выбирается
/// один раз в его начале и не меняется, пока пальцы на стекле.
final class StoryCanvasView: UIView, UIGestureRecognizerDelegate, UIEditMenuInteractionDelegate {
    var callbacks = StoryCanvasCallbacks()

    private let backdropLayer = CAGradientLayer()
    let mediaView = StoryMediaView()
    let drawingView = StoryDrawingView()
    private let entitiesView = UIView()
    private let guidesView = StoryBlurGuidesView()
    private let snapLayer = CAShapeLayer()
    private let trashView = StoryTrashView()

    private var entityViews: [UUID: StoryEntityView] = [:]
    private(set) var document: StoryDocument?
    private var workspace: StoryWorkspace?
    private(set) var mode: StoryCanvasMode = .locked
    private var imageCache: [String: UIImage] = [:]

    private lazy var pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
    private lazy var pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
    private lazy var rotation = UIRotationGestureRecognizer(target: self, action: #selector(handleRotation(_:)))
    private lazy var tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    private lazy var longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
    private lazy var editMenu = UIEditMenuInteraction(delegate: self)
    private var menuTarget: UUID?

    // Состояние жеста.
    private enum Target: Equatable {
        case entity(UUID)
        case media
        case blur
    }

    private var target: Target?
    private var activeGestures: Set<UIGestureRecognizer> = []
    private var rawCenter: CGPoint = .zero
    private var rawRotation: CGFloat = 0
    private var currentScale: CGFloat = 1
    private var mediaTransform = StoryTransform.identity
    private var liveBlur = StoryBlur.off
    private var overTrash = false
    private var snappedX = false
    private var snappedY = false
    private var snappedRotation = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        clipsToBounds = true
        layer.cornerRadius = StoryStageLayout.cornerRadius
        layer.cornerCurve = .continuous
        backgroundColor = .black
        layer.addSublayer(backdropLayer)
        addSubview(mediaView)
        addSubview(drawingView)
        addSubview(entitiesView)
        entitiesView.isUserInteractionEnabled = false
        addSubview(guidesView)
        guidesView.isUserInteractionEnabled = false
        snapLayer.strokeColor = UIColor.white.withAlphaComponent(0.7).cgColor
        snapLayer.lineWidth = 1
        snapLayer.lineDashPattern = [4, 4]
        layer.addSublayer(snapLayer)
        addSubview(trashView)
        trashView.alpha = 0

        for recognizer in [pan, pinch, rotation] as [UIGestureRecognizer] {
            recognizer.delegate = self
            addGestureRecognizer(recognizer)
        }
        pan.maximumNumberOfTouches = 2
        tap.delegate = self
        addGestureRecognizer(tap)
        longPress.minimumPressDuration = 0.4
        longPress.delegate = self
        addGestureRecognizer(longPress)
        addInteraction(editMenu)

        drawingView.onStrokeFinished = { [weak self] stroke in self?.callbacks.strokeFinished(stroke) }
        drawingView.onDrawingActive = { [weak self] active in self?.callbacks.interactionChanged(active) }

        accessibilityIdentifier = "story.canvas"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    // MARK: Синхронизация с документом

    func render(_ document: StoryDocument, workspace: StoryWorkspace, mode: StoryCanvasMode) {
        let previous = self.document
        self.document = document
        self.workspace = workspace
        setMode(mode)
        if previous?.backdrop != document.backdrop || previous?.background != document.background {
            updateBackdrop()
        }
        if target != .blur { liveBlur = document.blur }
        mediaView.show(document.background, trim: document.videoTrim, workspace: workspace, processing: processing(for: document))
        if target != .media {
            mediaTransform = document.mediaTransform
            layoutMedia()
        }
        drawingView.tool = document.drawingTool
        drawingView.setStrokes(document.drawing.strokes)
        syncEntities(document)
        guidesView.update(blur: liveBlur, mediaFrame: mediaFrameInfo, visible: mode == .blur)
    }

    private func processing(for document: StoryDocument) -> StoryProcessing {
        var processing = StoryProcessing(document)
        if target == .blur { processing.blur = liveBlur }
        // Направляющие видны только в режиме размытия, а само размытие — всегда.
        return processing
    }

    private func setMode(_ mode: StoryCanvasMode) {
        guard mode != self.mode else { return }
        if target != nil { cancelGesture() }
        self.mode = mode
        let editingID: UUID?
        if case let .textEditing(id) = mode { editingID = id } else { editingID = nil }
        let idle = mode == .idle
        pan.isEnabled = idle || mode == .blur
        pinch.isEnabled = idle || mode == .blur
        rotation.isEnabled = idle || mode == .blur
        tap.isEnabled = idle
        longPress.isEnabled = idle
        drawingView.isUserInteractionEnabled = mode == .drawing
        for (id, view) in entityViews { view.isHidden = id == editingID }
        UIView.animate(withDuration: Motion.Duration.layer) {
            // В рисовании объекты чуть притушены: видно, что их сейчас не двигают.
            self.entitiesView.alpha = mode == .drawing ? 0.6 : 1
        }
    }

    private func syncEntities(_ document: StoryDocument) {
        let width = bounds.width
        var seen = Set<UUID>()
        for entity in document.entities {
            seen.insert(entity.id)
            if let view = entityViews[entity.id] {
                view.update(entity)
            } else {
                let view: StoryEntityView
                if case .roundVideo = entity.kind {
                    let round = StoryRoundVideoEntityView(entity: entity)
                    round.urlProvider = { [weak self] file in self?.workspace?.url(for: file) }
                    view = round
                    round.update(entity)
                } else {
                    view = StoryEntityView(entity: entity)
                }
                view.imageProvider = { [weak self] file in self?.image(named: file) }
                view.canvasWidth = width
                entitiesView.addSubview(view)
                entityViews[entity.id] = view
                view.relayout()
                view.setNeedsDisplay()
            }
            if case let .textEditing(id) = mode { entityViews[entity.id]?.isHidden = id == entity.id }
        }
        for (id, view) in entityViews where !seen.contains(id) {
            (view as? StoryRoundVideoEntityView)?.stop()
            view.removeFromSuperview()
            entityViews[id] = nil
        }
        // Порядок наложения — порядок подвидов.
        for entity in document.entities {
            if let view = entityViews[entity.id] { entitiesView.bringSubviewToFront(view) }
        }
    }

    private func image(named file: String) -> UIImage? {
        if let cached = imageCache[file] { return cached }
        guard let url = workspace?.url(for: file), let image = UIImage(contentsOfFile: url.path) else { return nil }
        let prepared = image.preparingThumbnail(of: CGSize(width: 1200, height: 1200 / max(image.size.width / image.size.height, 0.01))) ?? image
        imageCache[file] = prepared
        return prepared
    }

    /// Обработка изменилась (ползунок) — только медиа, без пересборки объектов.
    func updateProcessing(_ processing: StoryProcessing) {
        mediaView.setProcessing(processing)
    }

    func stop() {
        mediaView.stop()
        entityViews.values.forEach { ($0 as? StoryRoundVideoEntityView)?.stop() }
    }

    // MARK: Раскладка

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        backdropLayer.frame = bounds
        snapLayer.frame = bounds
        CATransaction.commit()
        drawingView.frame = bounds
        entitiesView.frame = bounds
        guidesView.frame = bounds
        trashView.bounds = CGRect(x: 0, y: 0, width: 56, height: 56)
        trashView.center = CGPoint(x: bounds.midX, y: bounds.maxY - 72)
        layoutMedia()
        for view in entityViews.values where view.canvasWidth != bounds.width {
            view.canvasWidth = bounds.width
        }
        for view in entityViews.values where !view.isGestureActive {
            view.applyPlacement(in: bounds.size)
        }
        if document != nil { guidesView.update(blur: liveBlur, mediaFrame: mediaFrameInfo, visible: mode == .blur) }
    }

    private func updateBackdrop() {
        guard let document else { return }
        if case let .gradient(key) = document.background {
            backdropLayer.colors = StoryBackground.colors(key).map {
                UIColor(red: CGFloat(($0 >> 16) & 0xFF) / 255, green: CGFloat(($0 >> 8) & 0xFF) / 255, blue: CGFloat($0 & 0xFF) / 255, alpha: 1).cgColor
            }
            backdropLayer.startPoint = CGPoint(x: 0, y: 0)
            backdropLayer.endPoint = CGPoint(x: 1, y: 1)
        } else {
            backdropLayer.colors = document.backdrop.map(\.cgColor)
            backdropLayer.startPoint = CGPoint(x: 0.5, y: 0)
            backdropLayer.endPoint = CGPoint(x: 0.5, y: 1)
        }
    }

    private var mediaFrameInfo: StoryBlurGuidesView.MediaFrame {
        guard let document, bounds.width > 0 else { return .init(center: .zero, size: .zero, rotation: 0) }
        let frame = StoryCanvasMetrics(size: bounds.size).mediaFrame(for: document.background.pixelSize, transform: mediaTransform)
        return .init(center: frame.center, size: frame.size, rotation: CGFloat(mediaTransform.rotation))
    }

    private func layoutMedia() {
        guard let document, bounds.width > 0 else { return }
        let frame = StoryCanvasMetrics(size: bounds.size).mediaFrame(for: document.background.pixelSize, transform: mediaTransform)
        mediaView.transform = .identity
        mediaView.bounds = CGRect(origin: .zero, size: frame.size)
        mediaView.center = frame.center
        mediaView.transform = CGAffineTransform(rotationAngle: CGFloat(mediaTransform.rotation))
    }

    // MARK: Жесты

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        let transforms: Set<UIGestureRecognizer> = [pan, pinch, rotation]
        return transforms.contains(gestureRecognizer) && transforms.contains(other)
    }

    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        if gestureRecognizer === longPress {
            return entity(at: gestureRecognizer.location(in: entitiesView)) != nil
        }
        if gestureRecognizer === rotation, mode == .blur {
            return liveBlur.mode == .linear
        }
        return true
    }

    private func entity(at point: CGPoint) -> UUID? {
        for view in entitiesView.subviews.reversed() {
            guard let view = view as? StoryEntityView, !view.isHidden else { continue }
            if view.point(inside: view.convert(point, from: entitiesView), with: nil) { return view.entity.id }
        }
        return nil
    }

    private func beginIfNeeded(_ recognizer: UIGestureRecognizer) {
        activeGestures.insert(recognizer)
        guard target == nil, let document else { return }
        if mode == .blur {
            target = .blur
            liveBlur = document.blur
        } else if let id = entity(at: recognizer.location(in: entitiesView)), let view = entityViews[id] {
            target = .entity(id)
            view.isGestureActive = true
            rawCenter = view.center
            rawRotation = CGFloat(view.entity.rotation)
            currentScale = CGFloat(view.entity.scale)
            snappedX = false
            snappedY = false
            snappedRotation = abs(rawRotation) < 0.001
            Haptics.prepareImpact()
        } else {
            target = .media
            mediaTransform = document.mediaTransform
        }
        callbacks.interactionChanged(true)
    }

    private func endIfNeeded(_ recognizer: UIGestureRecognizer) {
        activeGestures.remove(recognizer)
        guard activeGestures.isEmpty, let target else { return }
        self.target = nil
        switch target {
        case .entity(let id):
            guard let view = entityViews[id] else { break }
            view.isGestureActive = false
            if overTrash {
                overTrash = false
                Haptics.impact(.medium)
                UIView.animate(withDuration: Motion.Duration.layer, animations: {
                    view.alpha = 0
                    view.transform = view.transform.scaledBy(x: 0.1, y: 0.1)
                }, completion: { _ in
                    self.callbacks.entityRemoved(id)
                })
            } else {
                let metrics = StoryCanvasMetrics(size: bounds.size)
                callbacks.entityChanged(id, metrics.normalized(view.center), Double(currentScale), Double(displayRotation))
            }
            hideTrash()
            snapLayer.path = nil
        case .media:
            callbacks.mediaChanged(mediaTransform)
        case .blur:
            callbacks.blurChanged(liveBlur)
        }
        callbacks.interactionChanged(false)
    }

    private func cancelGesture() {
        for recognizer in [pan, pinch, rotation] {
            recognizer.isEnabled = false
            recognizer.isEnabled = true
        }
        activeGestures.removeAll()
        if case let .entity(id) = target, let view = entityViews[id] {
            view.isGestureActive = false
            view.applyPlacement(in: bounds.size)
        }
        target = nil
        hideTrash()
        snapLayer.path = nil
    }

    @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
        switch recognizer.state {
        case .began:
            beginIfNeeded(recognizer)
        case .changed:
            let delta = recognizer.translation(in: self)
            recognizer.setTranslation(.zero, in: self)
            apply(translation: delta, location: recognizer.location(in: self))
        case .ended, .cancelled, .failed:
            endIfNeeded(recognizer)
        default:
            break
        }
    }

    @objc private func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
        switch recognizer.state {
        case .began:
            beginIfNeeded(recognizer)
        case .changed:
            let factor = recognizer.scale
            recognizer.scale = 1
            apply(scale: factor)
        case .ended, .cancelled, .failed:
            endIfNeeded(recognizer)
        default:
            break
        }
    }

    @objc private func handleRotation(_ recognizer: UIRotationGestureRecognizer) {
        switch recognizer.state {
        case .began:
            beginIfNeeded(recognizer)
        case .changed:
            let angle = recognizer.rotation
            recognizer.rotation = 0
            apply(rotation: angle)
        case .ended, .cancelled, .failed:
            endIfNeeded(recognizer)
        default:
            break
        }
    }

    private var displayRotation: CGFloat { snappedRotation ? 0 : rawRotation }

    private func apply(translation: CGPoint, location: CGPoint) {
        switch target {
        case .entity(let id):
            guard let view = entityViews[id] else { return }
            rawCenter.x += translation.x
            rawCenter.y += translation.y
            var center = rawCenter
            // Притяжение к центру холста с направляющей — как у Telegram.
            let threshold: CGFloat = 8
            let nearX = abs(center.x - bounds.midX) < threshold
            let nearY = abs(center.y - bounds.midY) < threshold
            if nearX { center.x = bounds.midX }
            if nearY { center.y = bounds.midY }
            if nearX != snappedX || nearY != snappedY {
                if nearX && !snappedX || nearY && !snappedY { Haptics.impact(.light, intensity: 0.6) }
                snappedX = nearX
                snappedY = nearY
                updateSnapGuides()
            }
            view.center = center
            updateTrash(location: location, view: view)
        case .media:
            mediaTransform.offset.x += Double(translation.x / max(bounds.width, 1))
            mediaTransform.offset.y += Double(translation.y / max(bounds.height, 1))
            layoutMedia()
        case .blur:
            moveBlur(by: translation)
        case nil:
            break
        }
    }

    private func apply(scale factor: CGFloat) {
        switch target {
        case .entity(let id):
            guard let view = entityViews[id] else { return }
            let range = view.entity.scaleRange
            currentScale = min(max(currentScale * factor, CGFloat(range.lowerBound)), CGFloat(range.upperBound))
            applyEntityTransform(view)
        case .media:
            mediaTransform.scale = StoryTransform.clampedScale(mediaTransform.scale * Double(factor), min: 0.5, max: 6)
            layoutMedia()
        case .blur:
            liveBlur.setSize(liveBlur.size * Double(factor))
            refreshBlur()
        case nil:
            break
        }
    }

    private func apply(rotation angle: CGFloat) {
        switch target {
        case .entity(let id):
            guard let view = entityViews[id], view.entity.supportsRotation else { return }
            rawRotation += angle
            let near = abs(remainder(rawRotation, .pi * 2)) < 0.06
            if near != snappedRotation {
                if near { Haptics.impact(.light, intensity: 0.6) }
                snappedRotation = near
            }
            applyEntityTransform(view)
        case .media:
            mediaTransform.rotation += Double(angle)
            layoutMedia()
        case .blur:
            liveBlur.angle += Double(angle)
            refreshBlur()
        case nil:
            break
        }
    }

    private func applyEntityTransform(_ view: StoryEntityView) {
        let base = CGAffineTransform(rotationAngle: displayRotation).scaledBy(x: currentScale, y: currentScale)
        view.transform = overTrash ? base.scaledBy(x: 0.35, y: 0.35) : base
    }

    // MARK: Корзина

    private func updateTrash(location: CGPoint, view: StoryEntityView) {
        if trashView.alpha == 0 {
            UIView.animate(withDuration: Motion.Duration.layer) { self.trashView.alpha = 1 }
        }
        let inside = hypot(location.x - trashView.center.x, location.y - trashView.center.y) < 52
        guard inside != overTrash else { return }
        overTrash = inside
        trashView.setActive(inside)
        if inside { Haptics.impact(.light) }
        UIView.animate(withDuration: Motion.Duration.feedback) {
            self.applyEntityTransform(view)
            view.alpha = inside ? 0.6 : CGFloat(view.entity.opacity)
        }
    }

    private func hideTrash() {
        trashView.setActive(false)
        UIView.animate(withDuration: Motion.Duration.layer) { self.trashView.alpha = 0 }
    }

    private func updateSnapGuides() {
        let path = CGMutablePath()
        if snappedX {
            path.move(to: CGPoint(x: bounds.midX, y: 0))
            path.addLine(to: CGPoint(x: bounds.midX, y: bounds.maxY))
        }
        if snappedY {
            path.move(to: CGPoint(x: 0, y: bounds.midY))
            path.addLine(to: CGPoint(x: bounds.maxX, y: bounds.midY))
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        snapLayer.path = path
        CATransaction.commit()
    }

    // MARK: Размытие

    /// Сдвиг на экране → сдвиг центра в долях снимка (с учётом поворота фона).
    private func moveBlur(by translation: CGPoint) {
        let frame = mediaFrameInfo
        guard frame.size.width > 0 else { return }
        let local = translation.applying(CGAffineTransform(rotationAngle: -frame.rotation))
        liveBlur.setCenter(StoryPoint(
            x: liveBlur.center.x + Double(local.x / frame.size.width),
            y: liveBlur.center.y + Double(local.y / frame.size.height)
        ))
        refreshBlur()
    }

    private func refreshBlur() {
        guard let document else { return }
        var processing = StoryProcessing(document)
        processing.blur = liveBlur
        mediaView.setProcessing(processing)
        guidesView.update(blur: liveBlur, mediaFrame: mediaFrameInfo, visible: true)
    }

    // MARK: Тап и меню

    @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
        if let id = entity(at: recognizer.location(in: entitiesView)) {
            Haptics.tap()
            callbacks.entityTapped(id)
        } else {
            callbacks.emptyTapped()
        }
    }

    @objc private func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
        guard recognizer.state == .began, let id = entity(at: recognizer.location(in: entitiesView)) else { return }
        menuTarget = id
        Haptics.impact(.medium)
        let location = recognizer.location(in: self)
        editMenu.presentEditMenu(with: UIEditMenuConfiguration(identifier: nil, sourcePoint: location))
    }

    func editMenuInteraction(_ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration, suggestedActions: [UIMenuElement]) -> UIMenu? {
        guard let id = menuTarget, let entity = document?.entity(id) else { return nil }
        var actions: [UIAction] = []
        if entity.isText {
            actions.append(UIAction(title: String(localized: "stories.editor.menu.edit", defaultValue: "Изменить")) { [weak self] _ in
                self?.callbacks.menuAction(.edit, id)
            })
        }
        actions.append(UIAction(title: String(localized: "stories.editor.menu.duplicate", defaultValue: "Дублировать")) { [weak self] _ in
            self?.callbacks.menuAction(.duplicate, id)
        })
        actions.append(UIAction(title: String(localized: "stories.editor.menu.front", defaultValue: "Наверх")) { [weak self] _ in
            self?.callbacks.menuAction(.bringToFront, id)
        })
        actions.append(UIAction(title: String(localized: "stories.editor.menu.delete", defaultValue: "Удалить"), attributes: .destructive) { [weak self] _ in
            self?.callbacks.menuAction(.delete, id)
        })
        return UIMenu(children: actions)
    }

    /// Снимок холста (без направляющих) — превью черновика.
    func snapshotImage(maxWidth: CGFloat = 360) -> UIImage? {
        guard bounds.width > 0 else { return nil }
        let guidesHidden = guidesView.isHidden
        guidesView.isHidden = true
        snapLayer.isHidden = true
        trashView.isHidden = true
        defer {
            guidesView.isHidden = guidesHidden
            snapLayer.isHidden = false
            trashView.isHidden = false
        }
        let format = UIGraphicsImageRendererFormat()
        format.scale = maxWidth / bounds.width
        return UIGraphicsImageRenderer(bounds: bounds, format: format).image { _ in
            drawHierarchy(in: bounds, afterScreenUpdates: false)
        }
    }
}

/// Направляющие размытия: сплошная — граница резкого, пунктир — конец перехода.
/// Видны только в режиме размытия и в экспорт не попадают (это отдельный слой холста).
final class StoryBlurGuidesView: UIView {
    struct MediaFrame {
        var center: CGPoint
        var size: CGSize
        var rotation: CGFloat
    }

    private let innerLayer = CAShapeLayer()
    private let outerLayer = CAShapeLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        for shape in [innerLayer, outerLayer] {
            shape.fillColor = nil
            shape.strokeColor = UIColor.white.cgColor
            shape.lineWidth = 1.5
            shape.shadowColor = UIColor.black.cgColor
            shape.shadowOpacity = 0.4
            shape.shadowRadius = 2
            shape.shadowOffset = .zero
            layer.addSublayer(shape)
        }
        outerLayer.lineDashPattern = [6, 5]
        isHidden = true
        accessibilityIdentifier = "story.blur.guides"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    func update(blur: StoryBlur, mediaFrame: MediaFrame, visible: Bool) {
        let show = visible && blur.mode != .off
        isHidden = !show
        isAccessibilityElement = show
        guard show, mediaFrame.size.width > 0 else { return }
        let width = mediaFrame.size.width
        let local = CGPoint(
            x: (CGFloat(blur.center.x) - 0.5) * mediaFrame.size.width,
            y: (CGFloat(blur.center.y) - 0.5) * mediaFrame.size.height
        ).applying(CGAffineTransform(rotationAngle: mediaFrame.rotation))
        let center = CGPoint(x: mediaFrame.center.x + local.x, y: mediaFrame.center.y + local.y)
        let inner = CGFloat(blur.size) * width
        let outer = CGFloat(blur.size * (1 + blur.falloff)) * width
        let innerPath = CGMutablePath()
        let outerPath = CGMutablePath()
        switch blur.mode {
        case .off:
            break
        case .radial:
            innerPath.addEllipse(in: CGRect(x: center.x - inner, y: center.y - inner, width: inner * 2, height: inner * 2))
            outerPath.addEllipse(in: CGRect(x: center.x - outer, y: center.y - outer, width: outer * 2, height: outer * 2))
        case .linear:
            let angle = CGFloat(blur.angle) + mediaFrame.rotation
            let direction = CGPoint(x: cos(angle), y: sin(angle))
            let normal = CGPoint(x: -sin(angle), y: cos(angle))
            let reach = hypot(bounds.width, bounds.height)
            for (path, distance) in [(innerPath, inner), (outerPath, outer)] {
                for sign in [CGFloat(1), -1] {
                    let base = CGPoint(x: center.x + normal.x * distance * sign, y: center.y + normal.y * distance * sign)
                    path.move(to: CGPoint(x: base.x - direction.x * reach, y: base.y - direction.y * reach))
                    path.addLine(to: CGPoint(x: base.x + direction.x * reach, y: base.y + direction.y * reach))
                }
            }
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        innerLayer.path = innerPath
        outerLayer.path = outerPath
        CATransaction.commit()
        accessibilityValue = blur.mode.rawValue
    }
}

/// Корзина внизу холста во время перетаскивания объекта.
final class StoryTrashView: UIView {
    private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
    private let icon = UIImageView(image: UIImage(systemName: "trash"))

    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(blur)
        blur.clipsToBounds = true
        icon.tintColor = .white
        icon.contentMode = .scaleAspectFit
        addSubview(icon)
        isUserInteractionEnabled = false
        accessibilityIdentifier = "story.trash"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    override func layoutSubviews() {
        super.layoutSubviews()
        blur.frame = bounds
        blur.layer.cornerRadius = bounds.width / 2
        icon.frame = bounds.insetBy(dx: 16, dy: 16)
    }

    func setActive(_ active: Bool) {
        UIView.animate(withDuration: Motion.Duration.feedback, delay: 0, options: [.beginFromCurrentState]) {
            self.transform = active ? CGAffineTransform(scaleX: 1.25, y: 1.25) : .identity
            self.icon.tintColor = active ? .systemRed : .white
        }
    }
}
