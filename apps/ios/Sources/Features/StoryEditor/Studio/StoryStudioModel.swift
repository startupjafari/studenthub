@preconcurrency import AVFoundation
import CoreImage
import Observation
import Photos
import SwiftUI
import UIKit

/// Сообщение экрана создания истории.
struct StoryStudioAlert: Identifiable, Equatable {
    enum Kind: Equatable {
        case error(String)
        /// Выключить коллаж или сменить раскладку — снятые кадры пропадут.
        case dropCollage(StoryCollageLayout?)
        case savedToPhotos
    }

    let id = UUID()
    let kind: Kind
}

/// Экран создания истории: камера, коллаж, галерея, редактор, черновики и публикация.
///
/// Состояние экрана — `session` (машина состояний + документ); здесь — то, что вокруг:
/// живая камера, кадры коллажа, сетка галереи, экспорт. Модель не знает о UIKit-видах
/// холста — холст читает документ и сообщает итог жеста.
@MainActor
@Observable
final class StoryStudioModel {
    // MARK: Зависимости

    let camera: StoryCameraSource
    let gallery: StoryGallerySource
    let drafts: StoryDraftStore
    private let stories: StoriesModel
    private(set) var workspace: StoryWorkspace

    // MARK: Состояние

    private(set) var session = StoryEditorSession()
    var state: StoryEditorState { session.state }
    var document: StoryDocument? { session.document }

    // Камера.
    private(set) var captureMode: StoryCaptureMode = .photo
    private(set) var flash: StoryFlashMode = .off
    private(set) var cameraPosition: StoryCameraPosition = .back
    private(set) var cameraFailure: String?
    private(set) var isCameraReady = false
    private(set) var isCapturing = false
    private(set) var recordingStartedAt: Date?
    /// Таймер затвора (3 или 10 с), `nil` — без таймера.
    private(set) var selfTimer: Int?
    private(set) var countdown: Int?
    /// Камера разворачивается — предпросмотр под размытием.
    private(set) var isSwitchingCamera = false
    private(set) var collage: StoryCollageCapture<String>?
    private(set) var collageImages: [String: UIImage] = [:]
    private var recordingTask: Task<Void, Never>?
    private var countdownTask: Task<Void, Never>?

    // Галерея.
    private(set) var galleryAccess: Bool?
    private(set) var albums: [StoryGalleryAlbum] = []
    private(set) var album: StoryGalleryAlbum?
    private(set) var showsDrafts = false
    private(set) var items: [StoryGalleryItem] = []
    private(set) var draftList: [StoryDraftSummary] = []
    private(set) var latestThumbnail: UIImage?
    var isSelecting = false
    private(set) var selection = StoryGallerySelection()
    private(set) var isImporting = false
    /// Выбранные в галерее по порядку: редактор проходит их один за другим.
    private(set) var queue: [StoryGalleryItem] = []
    private(set) var queueIndex = 0
    private(set) var finished: [StoryExportResult] = []

    // Редактор.
    /// Палец на холсте — панели прячутся, как у Telegram.
    private(set) var chromeHidden = false
    private(set) var isExporting = false
    private(set) var histogram = StoryHistogram.empty
    var curvesChannel: StoryToneCurves.Channel = .all
    var activeAdjustment: StoryAdjustmentTool?
    /// Цвет, который правит открытый выбор цвета.
    private(set) var pickerColor = StoryColor.white
    private(set) var roundRecordingStartedAt: Date?
    private(set) var isPreparingRoundCamera = false

    var alert: StoryStudioAlert?
    /// Готовые файлы для экрана публикации.
    var publishResults: [StoryExportResult] { finished }
    private(set) var isPublishing = false
    private(set) var publishFailure: String?

    /// Экран закрыт — представляющий его вид убирает обложку.
    var onClose: () -> Void = {}

    init(camera: StoryCameraSource, gallery: StoryGallerySource, drafts: StoryDraftStore = StoryDraftStore(), stories: StoriesModel) {
        self.camera = camera
        self.gallery = gallery
        self.drafts = drafts
        self.stories = stories
        // Хвосты прошлых запусков — один раз на процесс: SwiftUI создаёт модель заново при
        // каждом init вида (`State(initialValue:)`), и чистка в init стирала папку живого
        // редактора — экспорт падал «папка не существует» (CI 15.11).
        _ = Self.leftoversRemoved
        workspace = (try? StoryWorkspace.make()) ?? StoryWorkspace(directory: FileManager.default.temporaryDirectory)
    }

    /// Собрать модель под окружение: в UI-тестах и на симуляторе без камеры — имитации.
    static func make(stories: StoriesModel) -> StoryStudioModel {
        let testing = UITestEnvironment.current.isMock
        let camera: StoryCameraSource = testing || !StoryCaptureController.isAvailable ? StorySimulatedCamera() : StoryCaptureController()
        let gallery: StoryGallerySource = testing ? StorySyntheticGallery() : StoryPhotosGallery()
        let drafts = testing
            // Черновики теста живут один запуск: следующий сценарий начинает с пустого списка.
            ? StoryDraftStore(root: FileManager.default.temporaryDirectory
                .appendingPathComponent("UITestStoryDrafts-\(ProcessInfo.processInfo.processIdentifier)"))
            : StoryDraftStore()
        return StoryStudioModel(camera: camera, gallery: gallery, drafts: drafts, stories: stories)
    }

    // MARK: Жизненный цикл

    private static let leftoversRemoved: Void = StoryWorkspace.removeLeftovers()

    func appear() async {
        // Папку могли убрать снаружи (системная чистка tmp) — вернуть до первой записи.
        try? FileManager.default.createDirectory(at: workspace.directory, withIntermediateDirectories: true)
        refreshDrafts()
        await startCamera()
        await loadLatestThumbnail()
    }

    func startCamera() async {
        guard state.isCameraVisible else { return }
        do {
            try await camera.start(position: cameraPosition)
            camera.setFlash(flash)
            cameraFailure = nil
            isCameraReady = true
        } catch {
            cameraFailure = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            isCameraReady = false
        }
    }

    func close() {
        recordingTask?.cancel()
        countdownTask?.cancel()
        camera.stop()
        workspace.remove()
        session.send(.dismiss)
        onClose()
    }

    /// Приложение ушло в фон: камера отпускается, запись останавливается.
    func enterBackground() {
        if state == .recording { Task { await stopRecording() } }
        if state == .roundVideoRecording, roundRecordingStartedAt != nil { Task { await stopRoundRecording() } }
        camera.stop()
    }

    func enterForeground() async {
        if state.isCameraVisible || state == .roundVideoRecording { try? await camera.start(position: cameraPosition) }
    }

    // MARK: Камера

    var shutter: StoryShutterAppearance {
        StoryShutterAppearance(mode: captureMode, isRecording: state == .recording)
    }

    func setCaptureMode(_ mode: StoryCaptureMode) {
        guard mode != captureMode, state == .camera || state == .cameraCollage else { return }
        Haptics.tap()
        withAnimation(Motion.snappy) { captureMode = mode }
    }

    func toggleFlash() {
        flash = flash.next
        camera.setFlash(flash)
        Haptics.tap()
    }

    func cycleSelfTimer() {
        switch selfTimer {
        case nil: selfTimer = 3
        case 3: selfTimer = 10
        default: selfTimer = nil
        }
        Haptics.tap()
    }

    func switchCamera() async {
        guard !isSwitchingCamera, state != .recording else { return }
        Haptics.impact(.light)
        withAnimation(.easeOut(duration: Motion.Duration.feedback)) { isSwitchingCamera = true }
        await camera.switchCamera()
        cameraPosition = camera.position
        // Кадр новой камеры приходит не сразу — размытие уходит после него.
        try? await Task.sleep(nanoseconds: 180_000_000)
        withAnimation(.easeIn(duration: Motion.Duration.layer)) { isSwitchingCamera = false }
    }

    /// Нажатие затвора: снимок, запись или её остановка — по режиму.
    func shutterTapped() async {
        // Камера не готова (нет разрешения, сессия ещё настраивается) — затвор молчит.
        guard isCameraReady, state == .camera || state == .recording, !isCapturing, countdown == nil else { return }
        if state == .recording {
            await stopRecording()
            return
        }
        if let selfTimer {
            await runCountdown(selfTimer)
            guard countdown == nil, state == .camera else { return }
        }
        switch captureMode {
        case .photo: await capturePhoto()
        case .video: await startRecording()
        }
    }

    private func runCountdown(_ seconds: Int) async {
        countdownTask?.cancel()
        for value in stride(from: seconds, to: 0, by: -1) {
            countdown = value
            Haptics.tap()
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if Task.isCancelled || state != .camera { break }
        }
        countdown = nil
    }

    func capturePhoto() async {
        guard !isCapturing else { return }
        isCapturing = true
        defer { isCapturing = false }
        Haptics.impact(.medium)
        do {
            let shot = try await camera.capturePhoto()
            if var collage {
                guard let index = collage.activeIndex else {
                    // Все ячейки сняты (вернулись из редактора) — снова в редактор.
                    await finishCollage()
                    return
                }
                let cell = collage.layout.cells[index]
                let image = StoryMediaImport.normalized(shot, cropAspect: StoryMediaImport.aspect(of: cell), maxSide: 1920)
                let file = workspace.newFile(extension: "jpg")
                collageImages[file] = image
                withAnimation(Motion.snappy) {
                    collage.capture(file)
                    self.collage = collage
                }
                if collage.isComplete { await finishCollage() }
            } else {
                let image = StoryMediaImport.normalized(shot, cropAspect: 9.0 / 16.0)
                let workspace = workspace
                let document = try await Task.detached(priority: .userInitiated) {
                    try StoryMediaImport.photoDocument(image, workspace: workspace)
                }.value
                openEditor(document, from: .camera)
            }
        } catch {
            show(error)
        }
    }

    func startRecording() async {
        guard session.send(.startRecording) else { return }
        let url = workspace.url(for: workspace.newFile(extension: "mov"))
        do {
            try await camera.startRecording(to: url)
            Haptics.impact(.medium)
            recordingStartedAt = Date()
            recordingTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(StoryMediaImport.maxVideoDuration * 1_000_000_000))
                guard !Task.isCancelled else { return }
                await self?.stopRecording()
            }
        } catch {
            session.send(.stopRecording)
            show(error)
        }
    }

    func stopRecording() async {
        guard state == .recording else { return }
        recordingTask?.cancel()
        recordingTask = nil
        recordingStartedAt = nil
        session.send(.stopRecording)
        Haptics.impact(.light)
        do {
            let url = try await camera.stopRecording()
            let document = try await StoryMediaImport.videoDocument(at: url, workspace: workspace)
            openEditor(document, from: .camera)
        } catch {
            show(error)
        }
    }

    func focus(at point: CGPoint) {
        camera.focus(at: point)
    }

    // MARK: Коллаж

    var collageLayout: StoryCollageLayout { collage?.layout ?? .single }

    func toggleCollagePicker() {
        Haptics.tap()
        withAnimation(Motion.snappy) {
            if state == .cameraCollage {
                _ = session.send(.closeCollagePicker)
            } else {
                _ = session.send(.openCollagePicker)
            }
        }
    }

    /// Выбор раскладки. Потеря снятых кадров — только после подтверждения.
    func selectCollage(_ layout: StoryCollageLayout) {
        let target: StoryCollageLayout? = layout == .single ? nil : layout
        if let collage, target.map({ collage.wouldDropFrames(changingTo: $0) }) ?? !collage.isEmpty {
            alert = StoryStudioAlert(kind: .dropCollage(target))
            return
        }
        applyCollage(target)
    }

    func applyCollage(_ layout: StoryCollageLayout?) {
        Haptics.tap()
        withAnimation(Motion.snappy) {
            if let layout {
                if var collage {
                    for file in collage.change(to: layout) { collageImages[file] = nil }
                    self.collage = collage
                } else {
                    collage = StoryCollageCapture(layout: layout)
                }
            } else {
                collage = nil
                collageImages.removeAll()
            }
        }
    }

    /// Тап по снятой ячейке — переснять её.
    func retakeCollageCell(_ index: Int) {
        guard var collage else { return }
        Haptics.tap()
        if let file = collage.frames[index] { collageImages[file] = nil }
        withAnimation(Motion.snappy) {
            collage.retake(index)
            self.collage = collage
        }
    }

    func activateCollageCell(_ index: Int) {
        guard var collage else { return }
        withAnimation(Motion.snappy) {
            collage.activate(index)
            self.collage = collage
        }
    }

    private func finishCollage() async {
        guard let collage, collage.isComplete else { return }
        let images = collage.frames.compactMap { $0.flatMap { collageImages[$0] } }
        let layout = collage.layout
        let workspace = workspace
        do {
            let document = try await Task.detached(priority: .userInitiated) {
                let composed = StoryMediaImport.composeCollage(layout, images: images)
                return try StoryMediaImport.photoDocument(composed, workspace: workspace)
            }.value
            openEditor(document, from: .camera)
        } catch {
            show(error)
        }
    }

    // MARK: Галерея

    func openGallery() async {
        guard session.send(.openGallery) else { return }
        Haptics.tap()
        if galleryAccess == nil || galleryAccess == false {
            galleryAccess = await gallery.requestAccess()
        }
        guard galleryAccess == true else { return }
        if items.isEmpty { items = await gallery.load(album: album) }
        if albums.isEmpty { albums = await gallery.albums() }
        refreshDrafts()
    }

    func closeGallery() {
        withAnimation(Motion.snappy) {
            session.send(.closeGallery)
            isSelecting = false
            selection.clear()
        }
    }

    func selectAlbum(_ album: StoryGalleryAlbum?) async {
        showsDrafts = false
        self.album = album
        items = await gallery.load(album: album)
    }

    func showDrafts() {
        refreshDrafts()
        showsDrafts = true
    }

    func refreshDrafts() {
        draftList = drafts.list()
    }

    func toggleSelecting() {
        Haptics.tap()
        isSelecting.toggle()
        if !isSelecting { selection.clear() }
    }

    /// Тап по плитке: открыть снимок или отметить его в режиме выбора.
    func tapItem(_ item: StoryGalleryItem) async {
        if isSelecting {
            if !selection.toggle(item.id) { Haptics.error() } else { Haptics.tap() }
            return
        }
        await open([item])
    }

    /// «Далее» в режиме выбора — выбранные по порядку.
    func openSelection() async {
        let picked = selection.ids.compactMap { id in items.first { $0.id == id } }
        guard !picked.isEmpty else { return }
        await open(picked)
    }

    private func open(_ picked: [StoryGalleryItem]) async {
        guard !isImporting, let first = picked.first else { return }
        isImporting = true
        defer { isImporting = false }
        do {
            let document = try await gallery.importMedia(first, into: workspace)
            queue = picked
            queueIndex = 0
            finished = []
            openEditor(document, from: .gallery)
            isSelecting = false
            selection.clear()
        } catch {
            show(error)
        }
    }

    func openDraft(_ draft: StoryDraftSummary) async {
        guard !isImporting else { return }
        isImporting = true
        defer { isImporting = false }
        do {
            let fresh = try StoryWorkspace.make()
            let document = try drafts.open(draft.id, into: fresh.directory)
            workspace.remove()
            workspace = fresh
            queue = []
            queueIndex = 0
            finished = []
            camera.stop()
            withAnimation(Motion.snappy) {
                _ = session.open(document, from: .draft, draftID: draft.id)
            }
        } catch {
            show(error)
        }
    }

    func deleteDraft(_ draft: StoryDraftSummary) {
        drafts.delete(draft.id)
        refreshDrafts()
    }

    private func loadLatestThumbnail() async {
        guard PhotoAssets.status == .authorized || PhotoAssets.status == .limited || UITestEnvironment.current.isMock else { return }
        if items.isEmpty { items = await gallery.load(album: nil) }
        guard let first = items.first else { return }
        for await image in gallery.thumbnail(for: first, side: 120) { latestThumbnail = image }
    }

    /// Текстовая история на градиенте — из меню режимов камеры.
    func startTextStory() {
        var document = StoryMediaImport.gradientDocument("ocean")
        document.backdrop = []
        openEditor(document, from: .camera)
        beginText()
    }

    func cycleGradient() {
        guard case let .gradient(key) = document?.background else { return }
        let all = StoryBackground.all
        let next = all[((all.firstIndex(of: key) ?? 0) + 1) % all.count]
        Haptics.tap()
        session.edit { $0.background = .gradient(next) }
    }

    // MARK: Редактор

    private func openEditor(_ document: StoryDocument, from origin: StoryEditorOrigin) {
        camera.stop()
        isCameraReady = false
        withAnimation(Motion.snappy) {
            _ = session.open(document, from: origin)
        }
        Haptics.prepareImpact()
    }

    func setChromeHidden(_ hidden: Bool) {
        guard hidden != chromeHidden else { return }
        withAnimation(.easeInOut(duration: Motion.Duration.layer)) { chromeHidden = hidden }
    }

    func undo() {
        Haptics.tap()
        withAnimation(Motion.snappy) { _ = session.undo() }
    }

    /// «×» редактора.
    func requestClose() async {
        let next = session.requestClose()
        if next != .discardConfirmation { await returnToCapture() }
    }

    /// «Удалить» в диалоге. Переход — сразу, в том же такте, что и нажатие: алерт
    /// закрывается по состоянию, и запоздалый переход не столкнётся с его закрытием.
    func discardChanges() {
        session.discard()
        Task { await returnToCapture() }
    }

    func keepEditing() {
        session.keepEditing()
    }

    func saveDraftAndClose() {
        let snapshot = previewImage(width: 360)
        let draftID = session.draftID
        guard let document = session.saveDraftAndClose() else { return }
        do {
            try saveDraft(document, replacing: draftID, thumbnail: snapshot)
            Haptics.success()
        } catch {
            show(error)
        }
        Task { await returnToCapture() }
    }

    /// «Сохранить черновик» из меню — редактор остаётся открытым.
    func saveDraftOnly() async {
        guard let document else { return }
        do {
            let id = session.draftID ?? document.id
            try saveDraft(document, replacing: id, thumbnail: previewImage(width: 360))
            session.markSaved(draftID: id)
            Haptics.success()
        } catch {
            show(error)
        }
    }

    private func saveDraft(_ document: StoryDocument, replacing draftID: UUID?, thumbnail: UIImage?) throws {
        var stored = document
        if let draftID { stored.id = draftID }
        let jpeg = thumbnail?.jpegData(compressionQuality: 0.7)
        try drafts.save(stored, from: workspace.directory, thumbnail: jpeg)
        refreshDrafts()
    }

    private func returnToCapture() async {
        queue = []
        finished = []
        if state.isCameraVisible { await startCamera() }
    }

    /// Кадр истории тем же рендером, что экспорт, — превью черновика и пипетка. Снимок
    /// экрана не годится: слой Metal с фото в `drawHierarchy` не попадает.
    func previewImage(width: CGFloat) -> UIImage? {
        guard let document else { return nil }
        let size = CGSize(width: width, height: width * 16 / 9)
        var poster: UIImage?
        if case let .video(file, _, _) = document.background {
            poster = MediaPreparation.thumbnail(ofVideoAt: workspace.url(for: file))
        }
        // Медиа — уменьшенная копия: полный размер на главном потоке дал бы рывок.
        return StoryExporter.renderPhoto(document, workspace: workspace, size: size, videoPoster: poster, maxMediaSide: width * 2)
    }

    // Инструменты.

    func beginText(existing id: UUID? = nil) {
        Haptics.tap()
        withAnimation(Motion.snappy) { _ = session.beginText(existing: id) }
    }

    func setTextInput(_ input: StoryTextInput) {
        session.switchTextInput(input)
    }

    func updateText(_ id: UUID, payload: StoryTextPayload, canvasWidth: CGFloat) {
        let size = StoryTextLayout(payload: payload, canvasWidth: max(canvasWidth, 1)).normalizedSize
        session.edit(recordingStep: false) { document in
            document.update(id) { entity in
                entity.kind = .text(payload)
                entity.size = size
            }
        }
    }

    func openStickers() {
        Haptics.tap()
        withAnimation(Motion.snappy) { _ = session.openStickers() }
    }

    func openDrawing() {
        Haptics.tap()
        withAnimation(Motion.snappy) { _ = session.openDrawing() }
    }

    func openAdjustments(_ tab: StoryAdjustTab = .tools) {
        Haptics.tap()
        withAnimation(Motion.snappy) { _ = session.openAdjustments(tab) }
        if tab == .curves || histogram == .empty { Task { await computeHistogram() } }
    }

    func openColorPicker(_ target: StoryColorTarget) {
        guard let document else { return }
        switch target {
        case .drawing: pickerColor = document.drawingTool.color
        case .text:
            if case let .textEditing(id, _, _) = state, case let .text(payload)? = document.entity(id)?.kind {
                pickerColor = payload.color
            }
        case .shape: pickerColor = document.drawingTool.color
        }
        Haptics.tap()
        withAnimation(Motion.snappy) { _ = session.openColorPicker(target) }
    }

    /// Цвет из выбора цвета — сразу в инструмент (кисть, надпись), отмена его вернёт.
    func setPickerColor(_ color: StoryColor) {
        pickerColor = color
        guard case let .colorPicker(target) = state else { return }
        session.edit(recordingStep: false) { document in
            switch target {
            case .drawing, .shape:
                document.drawingTool.color = color
            case .text:
                break
            }
        }
        if target == .text, case let .textEditing(id, _, _)? = session.machine.underlying,
           case var .text(payload)? = document?.entity(id)?.kind {
            payload.color = color
            session.edit(recordingStep: false) { document in
                document.update(id) { $0.kind = .text(payload) }
            }
        }
    }

    func confirmTool() {
        Haptics.tap()
        withAnimation(Motion.snappy) { _ = session.confirm() }
    }

    func cancelTool() {
        withAnimation(Motion.snappy) { _ = session.cancel() }
    }

    func edit(_ change: (inout StoryDocument) -> Void) {
        session.edit(change)
    }

    /// Правка внутри открытого инструмента — шаг «Назад» запишется при «Готово».
    func editInTool(_ change: (inout StoryDocument) -> Void) {
        session.edit(recordingStep: false, change)
    }

    // Холст.

    func entityMoved(_ id: UUID, center: StoryPoint, scale: Double, rotation: Double) {
        session.edit { document in
            document.update(id) { entity in
                entity.center = center
                entity.scale = scale
                entity.rotation = entity.supportsRotation ? rotation : 0
            }
        }
    }

    func entityTapped(_ id: UUID) {
        guard state == .storyEditor, let entity = document?.entity(id) else { return }
        if entity.isText {
            beginText(existing: id)
        } else {
            session.edit { $0.bringToFront(id) }
        }
    }

    func menuAction(_ action: StoryEntityMenuAction, for id: UUID) {
        switch action {
        case .delete:
            Haptics.impact(.medium)
            withAnimation(Motion.snappy) { session.edit { $0.remove(id) } }
        case .duplicate:
            session.edit { _ = $0.duplicate(id) }
        case .bringToFront:
            session.edit { $0.bringToFront(id) }
        case .edit:
            beginText(existing: id)
        }
    }

    func strokeFinished(_ stroke: StoryStroke) {
        session.edit(recordingStep: false) { $0.drawing.add(stroke) }
    }

    /// Новый объект по центру. Из панели стикеров — как выбор в инструменте (панель
    /// закрывается), с холста — отдельный шаг «Назад».
    func addSticker(_ kind: StoryEntity.Kind, size: StorySize) {
        let add: (inout StoryDocument) -> Void = { document in
            document.add(kind, center: StoryPoint(x: 0.5, y: 0.45), size: size)
        }
        if state == .stickerSelection {
            session.edit(recordingStep: false, add)
            confirmTool()
        } else {
            Haptics.tap()
            withAnimation(Motion.snappy) { session.edit(add) }
        }
    }

    func addEmoji(_ emoji: String) {
        RecentEmoji.shared.use(emoji)
        addSticker(.emoji(emoji), size: StorySize(width: 0.28, height: 0.28))
    }

    func addShape(_ shape: StoryShapePayload.Shape, filled: Bool) {
        guard let color = document?.drawingTool.color else { return }
        let payload = StoryShapePayload(shape: shape, color: color, filled: filled)
        addSticker(.shape(payload), size: payload.defaultSize)
    }

    /// Фото поверх фона — «плавающая» картинка.
    func addEntity(photo image: UIImage) {
        let prepared = StoryMediaImport.normalized(image, maxSide: 1200)
        guard let data = prepared.jpegData(compressionQuality: 0.88), let file = try? workspace.store(data, extension: "jpg") else { return }
        let aspect = max(Double(prepared.size.width / max(prepared.size.height, 1)), 0.1)
        let width = 0.5
        addSticker(
            .image(StoryImagePayload(file: file, pixelSize: StorySize(width: Double(prepared.size.width), height: Double(prepared.size.height)))),
            size: StorySize(width: width, height: width / aspect)
        )
    }

    // Обработка.

    func setAdjustment(_ tool: StoryAdjustmentTool, _ value: Double) {
        activeAdjustment = tool
        session.edit(recordingStep: false) { $0.adjustments[tool] = value }
    }

    func setBlurMode(_ mode: StoryBlur.Mode) {
        Haptics.tap()
        session.edit(recordingStep: false) { $0.blur.mode = mode }
    }

    func setBlur(_ blur: StoryBlur) {
        session.edit(recordingStep: false) { $0.blur = blur }
    }

    func setCurvePoint(_ index: Int, y: Double) {
        let channel = curvesChannel
        session.edit(recordingStep: false) { $0.curves[channel].setPoint(index, y: y) }
    }

    func resetCurve() {
        let channel = curvesChannel
        Haptics.tap()
        session.edit(recordingStep: false) { $0.curves[channel] = .identity }
    }

    private func computeHistogram() async {
        guard let document, case let .photo(file, _) = document.background else { return }
        let url = workspace.url(for: file)
        histogram = await Task.detached(priority: .utility) {
            guard let image = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) else { return StoryHistogram.empty }
            return StoryImageProcessor.shared.histogram(of: StoryImageProcessor.proxy(of: image, maxSide: 512))
        }.value
    }

    // Круглое видео.

    func openRoundVideo() async {
        guard session.openRoundVideo() else { return }
        Haptics.tap()
        isPreparingRoundCamera = true
        defer { isPreparingRoundCamera = false }
        do {
            // Кружок — всегда фронтальная; выбор камеры экрана съёмки не меняется.
            try await camera.start(position: .front)
        } catch {
            session.cancel()
            show(error)
        }
    }

    func roundShutterTapped() async {
        if roundRecordingStartedAt == nil {
            let url = workspace.url(for: workspace.newFile(extension: "mov"))
            do {
                try await camera.startRecording(to: url)
                Haptics.impact(.medium)
                roundRecordingStartedAt = Date()
                recordingTask = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: UInt64(StoryRoundVideoPayload.maxDuration * 1_000_000_000))
                    guard !Task.isCancelled else { return }
                    await self?.stopRoundRecording()
                }
            } catch {
                show(error)
            }
        } else {
            await stopRoundRecording()
        }
    }

    func stopRoundRecording() async {
        guard roundRecordingStartedAt != nil else { return }
        recordingTask?.cancel()
        roundRecordingStartedAt = nil
        Haptics.impact(.light)
        do {
            let url = try await camera.stopRecording()
            camera.stop()
            let file = try workspace.adopt(url, extension: "mov")
            let duration = (try? await AVURLAssetDuration.seconds(of: workspace.url(for: file))) ?? 1
            let diameter = 0.45
            session.edit(recordingStep: false) { document in
                document.add(
                    .roundVideo(StoryRoundVideoPayload(file: file, duration: duration)),
                    center: StoryPoint(x: 0.5, y: 0.4),
                    size: StorySize(width: diameter, height: diameter)
                )
            }
            confirmTool()
        } catch {
            show(error)
        }
    }

    func cancelRoundVideo() {
        if roundRecordingStartedAt != nil {
            recordingTask?.cancel()
            roundRecordingStartedAt = nil
            Task { _ = try? await camera.stopRecording() }
        }
        camera.stop()
        cancelTool()
    }

    // MARK: Далее, сохранение, публикация

    /// «Далее»: собрать файл; есть ещё выбранные — к следующему, иначе — к публикации.
    func next() async {
        guard state == .storyEditor, let document, !isExporting else { return }
        isExporting = true
        defer { isExporting = false }
        do {
            let result = try await StoryExporter.export(document, workspace: workspace)
            _ = try result.prepared()
            finished.append(result)
            if queueIndex + 1 < queue.count {
                queueIndex += 1
                let nextDocument = try await gallery.importMedia(queue[queueIndex], into: workspace)
                withAnimation(Motion.snappy) { _ = session.openNext(nextDocument) }
            } else {
                Haptics.success()
                withAnimation(Motion.snappy) { _ = session.next() }
            }
        } catch {
            show(error)
        }
    }

    var queueProgress: (current: Int, total: Int)? {
        queue.count > 1 ? (queueIndex + 1, queue.count) : nil
    }

    func backFromPublishing() {
        // Готовый файл последнего снимка пересоберётся при новом «Далее».
        if !finished.isEmpty { finished.removeLast() }
        withAnimation(Motion.snappy) { _ = session.backFromPublishing() }
    }

    func publish(audience: StoryAudience, extras: CommunityStoryExtras) async {
        guard !isPublishing, let document else { return }
        isPublishing = true
        publishFailure = nil
        defer { isPublishing = false }
        let caption = document.caption.trimmingCharacters(in: .whitespacesAndNewlines)
        for (index, result) in finished.enumerated() {
            do {
                let media = try result.prepared()
                let ok = await stories.publish(
                    media: media,
                    text: caption.isEmpty || index > 0 ? nil : String(caption.prefix(StoryTextPayload.maxLength)),
                    background: nil,
                    audience: audience,
                    extras: index == 0 ? extras : CommunityStoryExtras()
                )
                guard ok else {
                    publishFailure = stories.actionFailure
                    stories.dismissActionFailure()
                    return
                }
            } catch {
                publishFailure = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                return
            }
        }
        if let draftID = session.draftID { drafts.delete(draftID) }
        Haptics.success()
        session.published()
        close()
    }

    func dismissPublishFailure() {
        publishFailure = nil
    }

    /// «Скачать» в редакторе: итог — в «Фото».
    func saveToPhotos() async {
        guard let document, !isExporting else { return }
        isExporting = true
        defer { isExporting = false }
        do {
            let result = try await StoryExporter.export(document, workspace: workspace)
            try await PHPhotoLibrary.shared().performChanges {
                if result.isVideo {
                    PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: result.url)
                } else {
                    PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: result.url)
                }
            }
            Haptics.success()
            alert = StoryStudioAlert(kind: .savedToPhotos)
        } catch {
            show(error)
        }
    }

    func show(_ error: Error) {
        Haptics.error()
        let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        alert = StoryStudioAlert(kind: .error(message))
    }
}

/// Длительность ролика без блокировки главного потока.
enum AVURLAssetDuration {
    static func seconds(of url: URL) async throws -> Double {
        try await AVURLAsset(url: url).load(.duration).seconds
    }
}
