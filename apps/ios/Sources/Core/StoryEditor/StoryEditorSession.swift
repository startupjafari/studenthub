import Foundation

/// Сессия редактора: машина состояний + документ + снимки для отмены.
///
/// Правила:
/// - Открыл инструмент — запомнили документ. «Отмена» возвращает этот снимок: уходят
///   только правки инструмента, остальное остаётся. «Готово» оставляет правки и кладёт
///   снимок в историю — шаг «Назад» нижней панели снимет весь инструмент разом.
/// - Выбор цвета — такой же уровень: отмена цвета не трогает нарисованное до него.
/// - Изменения, по которым «×» спрашивает «Сбросить изменения?», — расхождение
///   документа с исходным (только что снятым, открытым из галереи или из черновика).
///
/// Без UIKit и камеры: всё проверяется юнит-тестами.
struct StoryEditorSession: Sendable {
    private(set) var machine = StoryEditorMachine()
    private(set) var document: StoryDocument?
    /// Документ на момент открытия (или последнего сохранения черновика).
    private(set) var baseline: StoryDocument?
    /// Снимки на входе в инструменты — параллельно уровням стека машины.
    private var toolSnapshots: [StoryDocument] = []
    /// Шаги «Назад» нижней панели редактора.
    private(set) var history: [StoryDocument] = []
    /// Черновик, из которого открыт документ: сохранение перезаписывает его.
    private(set) var draftID: UUID?

    static let historyLimit = 50

    var state: StoryEditorState { machine.state }

    var hasChanges: Bool {
        guard let document, let baseline else { return false }
        return !document.isSameContent(as: baseline)
    }

    var canUndo: Bool { !history.isEmpty && state == .storyEditor }

    // MARK: Камера и галерея

    @discardableResult
    mutating func send(_ event: StoryEditorEvent) -> Bool {
        switch event {
        case .confirm, .cancel, .beginText, .openDrawing, .openAdjustments, .openRoundVideo,
             .openColorPicker, .requestClose, .discard, .saveDraft:
            assertionFailure("событие редактора идёт через свой метод сессии: \(event)")
            return false
        default:
            return machine.send(event)
        }
    }

    /// Медиа готово: открыть редактор с новым документом.
    @discardableResult
    mutating func open(_ document: StoryDocument, from origin: StoryEditorOrigin, draftID: UUID? = nil) -> Bool {
        guard machine.send(.mediaReady(origin)) else { return false }
        self.document = document
        baseline = document
        toolSnapshots.removeAll()
        history.removeAll()
        self.draftID = draftID
        return true
    }

    /// Следующий снимок из выбранных в галерее: редактор остаётся открытым, а документ,
    /// история шагов и исходное состояние — новые.
    @discardableResult
    mutating func openNext(_ document: StoryDocument) -> Bool {
        guard state == .storyEditor else { return false }
        self.document = document
        baseline = document
        toolSnapshots.removeAll()
        history.removeAll()
        draftID = nil
        return true
    }

    // MARK: Инструменты

    /// Новая надпись или правка существующей. Новая сразу лежит в документе (её видно
    /// во время набора) и исчезает при отмене или пустом тексте.
    @discardableResult
    mutating func beginText(existing id: UUID? = nil, size: StorySize = StorySize(width: 0.6, height: 0.1)) -> UUID? {
        guard var document else { return nil }
        let isNew = id == nil
        if let id, document.entity(id) == nil { return nil }
        // Смена вкладки рисования на «Текст» подтверждает рисование.
        let switching = state == .drawing
        let snapshot = document
        var targetID = id
        if isNew {
            var payload = document.textDefaults
            payload.text = ""
            targetID = document.add(.text(payload), center: StoryPoint(x: 0.5, y: 0.42), size: size)
        }
        guard let targetID, machine.send(.beginText(entityID: targetID, isNew: isNew)) else { return nil }
        if switching { commitTopSnapshot() }
        toolSnapshots.append(snapshot)
        self.document = document
        return targetID
    }

    @discardableResult
    mutating func switchTextInput(_ input: StoryTextInput) -> Bool {
        machine.send(.switchTextInput(input))
    }

    @discardableResult
    mutating func openDrawing() -> Bool { openTool(.openDrawing) }

    @discardableResult
    mutating func openAdjustments(_ tab: StoryAdjustTab = .tools) -> Bool {
        if state.adjustTab != nil { return machine.send(.openAdjustments(tab)) }
        return openTool(.openAdjustments(tab))
    }

    @discardableResult
    mutating func openRoundVideo() -> Bool { openTool(.openRoundVideo) }

    @discardableResult
    mutating func openColorPicker(_ target: StoryColorTarget) -> Bool { openTool(.openColorPicker(target)) }

    /// «Готово» инструмента или выбора цвета.
    @discardableResult
    mutating func confirm() -> Bool {
        let leaving = state
        guard leaving.isEditorTool, machine.send(.confirm) else { return false }
        if case let .textEditing(id, _, _) = leaving, let entity = document?.entity(id),
           case let .text(payload) = entity.kind {
            if payload.isBlank {
                // Пустая надпись не остаётся невидимым объектом на холсте.
                document?.remove(id)
            } else {
                var defaults = payload
                defaults.text = ""
                document?.textDefaults = defaults
            }
        }
        commitTopSnapshot()
        return true
    }

    /// «Отмена» инструмента: документ — как в момент его открытия.
    @discardableResult
    mutating func cancel() -> Bool {
        guard state.isEditorTool, machine.send(.cancel) else { return false }
        if let snapshot = toolSnapshots.popLast() { document = snapshot }
        return true
    }

    // MARK: Правки

    /// Правка внутри инструмента или на холсте. Вне инструмента (перетаскивание надписи,
    /// удаление объекта) — отдельный шаг «Назад»; внутри — шаг всего инструмента.
    mutating func edit(recordingStep: Bool = true, _ change: (inout StoryDocument) -> Void) {
        guard var document else { return }
        let before = document
        change(&document)
        guard document != before else { return }
        document.updatedAt = Date()
        if recordingStep, toolSnapshots.isEmpty, !document.isSameContent(as: before) { pushHistory(before) }
        self.document = document
    }

    /// Шаг «Назад» нижней панели — снимает последний инструмент или жест.
    @discardableResult
    mutating func undo() -> Bool {
        guard canUndo, let previous = history.popLast() else { return false }
        document = previous
        return true
    }

    // MARK: Выход

    /// «×» редактора. Возвращает новое состояние: диалог или возврат к камере/галерее.
    @discardableResult
    mutating func requestClose() -> StoryEditorState {
        guard state == .storyEditor else { return state }
        let changed = hasChanges
        machine.send(.requestClose(hasChanges: changed))
        if !changed { closeDocument() }
        return state
    }

    /// «Удалить» в диалоге — правки уходят, редактор закрывается.
    @discardableResult
    mutating func discard() -> Bool {
        guard machine.send(.discard) else { return false }
        closeDocument()
        return true
    }

    /// «Сохранить черновик» — документ отдаётся на запись, редактор закрывается.
    @discardableResult
    mutating func saveDraftAndClose() -> StoryDocument? {
        guard let document, machine.send(.saveDraft) else { return nil }
        closeDocument()
        return document
    }

    @discardableResult
    mutating func keepEditing() -> Bool { machine.send(.keepEditing) }

    /// Черновик записан, а редактор остаётся открытым: изменений больше нет.
    mutating func markSaved(draftID: UUID) {
        self.draftID = draftID
        baseline = document
    }

    @discardableResult
    mutating func next() -> Bool { machine.send(.next) }

    @discardableResult
    mutating func backFromPublishing() -> Bool { machine.send(.backFromPublishing) }

    @discardableResult
    mutating func published() -> Bool {
        guard machine.send(.published) else { return false }
        closeDocument()
        return true
    }

    // MARK: Внутреннее

    private mutating func openTool(_ event: StoryEditorEvent) -> Bool {
        guard let document else { return false }
        guard machine.send(event) else { return false }
        toolSnapshots.append(document)
        return true
    }

    /// Инструмент закрыт с сохранением: его снимок — шаг «Назад», если что-то поменялось.
    private mutating func commitTopSnapshot() {
        guard let snapshot = toolSnapshots.popLast() else { return }
        // Подтверждённый выбор цвета — часть инструмента под ним, отдельного шага нет.
        guard toolSnapshots.isEmpty, let document, !document.isSameContent(as: snapshot) else { return }
        pushHistory(snapshot)
    }

    private mutating func pushHistory(_ document: StoryDocument) {
        history.append(document)
        if history.count > Self.historyLimit { history.removeFirst(history.count - Self.historyLimit) }
    }

    private mutating func closeDocument() {
        document = nil
        baseline = nil
        toolSnapshots.removeAll()
        history.removeAll()
        draftID = nil
    }
}

extension StoryDocument {
    /// Содержимое без служебных отметок времени и без последних настроек инструментов:
    /// выбранная кисть или цвет без единого штриха — не повод спрашивать «Сбросить?».
    func isSameContent(as other: StoryDocument) -> Bool {
        var lhs = self
        let rhs = other
        lhs.updatedAt = rhs.updatedAt
        lhs.drawingTool = rhs.drawingTool
        lhs.textDefaults = rhs.textDefaults
        lhs.createdAt = rhs.createdAt
        return lhs == rhs
    }
}
