import Foundation

/// Вкладка раздела «Обработка».
enum StoryAdjustTab: String, Codable, CaseIterable, Sendable {
    case tools
    case blur
    case curves
}

/// Чем занята клавиатурная область при правке текста.
enum StoryTextInput: String, Codable, Sendable {
    case keyboard
    case emoji
    case fonts
}

/// Для чего открыт выбор цвета.
enum StoryColorTarget: String, Codable, Sendable {
    case drawing
    case text
}

/// Откуда открыт редактор — куда вернуться по «×» без изменений.
enum StoryEditorOrigin: String, Codable, Sendable {
    case camera
    case gallery
    case draft
}

/// Состояние экрана создания истории. Одно значение вместо десятка флагов: взаимно
/// исключающие панели не открыть одновременно по построению.
enum StoryEditorState: Equatable, Sendable {
    /// Камера, полный кадр или коллаж.
    case camera
    /// Камера с открытым выбором раскладки коллажа.
    case cameraCollage
    /// Идёт запись видео камерой.
    case recording
    /// Галерея поверх камеры.
    case gallery
    /// Редактор с выбранным медиа.
    case storyEditor
    /// Правка надписи.
    case textEditing(entityID: UUID, isNew: Bool, input: StoryTextInput)
    /// Рисование.
    case drawing
    case imageAdjustment
    case blurAdjustment
    case curvesAdjustment
    /// Выбор цвета поверх рисования или текста.
    case colorPicker(StoryColorTarget)
    /// Запись круглого видео поверх фото.
    case roundVideoRecording
    /// «Сбросить изменения?»
    case discardConfirmation
    /// Экран аудитории и публикации.
    case publishing
    /// Экран закрыт.
    case closed

    /// Инструмент редактора: отмена откатывает его правки, подтверждение — сохраняет.
    var isEditorTool: Bool {
        switch self {
        case .textEditing, .drawing, .imageAdjustment, .blurAdjustment,
             .curvesAdjustment, .colorPicker, .roundVideoRecording:
            return true
        default:
            return false
        }
    }

    var adjustTab: StoryAdjustTab? {
        switch self {
        case .imageAdjustment: return .tools
        case .blurAdjustment: return .blur
        case .curvesAdjustment: return .curves
        default: return nil
        }
    }

    /// Камера живая (предпросмотр идёт) — в камере, выборе коллажа и записи.
    var isCameraVisible: Bool {
        switch self {
        case .camera, .cameraCollage, .recording, .gallery: return true
        default: return false
        }
    }

    /// Пока виден редактор (сам или под инструментом).
    var isInEditor: Bool {
        switch self {
        case .camera, .cameraCollage, .recording, .gallery, .closed: return false
        default: return true
        }
    }

    static func adjustment(_ tab: StoryAdjustTab) -> StoryEditorState {
        switch tab {
        case .tools: return .imageAdjustment
        case .blur: return .blurAdjustment
        case .curves: return .curvesAdjustment
        }
    }
}

/// Событие экрана.
enum StoryEditorEvent: Equatable, Sendable {
    case openCollagePicker
    case closeCollagePicker
    case startRecording
    case stopRecording
    case openGallery
    case closeGallery
    /// Снимок, видео, коллаж или выбор галереи готовы — открыть редактор.
    case mediaReady(StoryEditorOrigin)
    case beginText(entityID: UUID, isNew: Bool)
    case switchTextInput(StoryTextInput)
    case openDrawing
    case openAdjustments(StoryAdjustTab)
    case openRoundVideo
    case openColorPicker(StoryColorTarget)
    /// Подтвердить инструмент (и выбор цвета).
    case confirm
    /// Отменить инструмент (и выбор цвета).
    case cancel
    /// «×» редактора. Есть изменения — диалог, нет — назад к камере или галерее.
    case requestClose(hasChanges: Bool)
    case discard
    case saveDraft
    case keepEditing
    case next
    case backFromPublishing
    case published
    /// «×» камеры — закрыть экран.
    case dismiss
}

/// Переходы экрана создания истории.
///
/// Состояния лежат стеком: «назад» снимает верхний уровень и возвращает на предыдущий
/// логический (выбор цвета → рисование → редактор → галерея). Недопустимое событие не
/// меняет состояние и возвращает `false` — двойной тап или запоздалый колбэк камеры
/// не откроют вторую панель поверх первой.
struct StoryEditorMachine: Equatable, Sendable {
    private(set) var stack: [StoryEditorState] = [.camera]
    private(set) var origin: StoryEditorOrigin = .camera

    var state: StoryEditorState { stack.last ?? .closed }

    /// Глубина вложенности — для тестов «назад возвращает на предыдущий уровень».
    var depth: Int { stack.count }

    /// Состояние под верхним (под выбором цвета — инструмент, под инструментом — редактор).
    var underlying: StoryEditorState? { stack.count > 1 ? stack[stack.count - 2] : nil }

    init(start: StoryEditorState = .camera) {
        stack = [start]
    }

    @discardableResult
    mutating func send(_ event: StoryEditorEvent) -> Bool {
        let current = state
        switch (current, event) {
        case (.camera, .openCollagePicker):
            push(.cameraCollage)
        case (.cameraCollage, .closeCollagePicker):
            pop()
        case (.camera, .startRecording), (.cameraCollage, .startRecording):
            if current == .cameraCollage { pop() }
            push(.recording)
        case (.recording, .stopRecording):
            pop()
        case (.camera, .openGallery), (.cameraCollage, .openGallery):
            if current == .cameraCollage { pop() }
            push(.gallery)
        case (.gallery, .closeGallery):
            pop()

        case (.camera, .mediaReady(let from)), (.cameraCollage, .mediaReady(let from)),
             (.recording, .mediaReady(let from)), (.gallery, .mediaReady(let from)):
            // Камера всегда остаётся корнем: «назад» из редактора — к ней или к галерее.
            origin = from
            stack = from == .camera ? [.camera, .storyEditor] : [.camera, .gallery, .storyEditor]

        case (.storyEditor, .beginText(let id, let isNew)), (.drawing, .beginText(let id, let isNew)):
            // Из вкладок рисования «Текст» сменяет инструмент, а не ложится поверх.
            if current != .storyEditor { pop() }
            push(.textEditing(entityID: id, isNew: isNew, input: .keyboard))
        case (.textEditing(let id, let isNew, _), .switchTextInput(let input)):
            replaceTop(.textEditing(entityID: id, isNew: isNew, input: input))
        case (.storyEditor, .openDrawing):
            push(.drawing)
        case (.storyEditor, .openAdjustments(let tab)):
            push(.adjustment(tab))
        case (.imageAdjustment, .openAdjustments(let tab)), (.blurAdjustment, .openAdjustments(let tab)),
             (.curvesAdjustment, .openAdjustments(let tab)):
            // Вкладки обработки — один инструмент: смена вкладки не подтверждает и не
            // отменяет правки, только показывает другую часть.
            replaceTop(.adjustment(tab))
        case (.storyEditor, .openRoundVideo):
            push(.roundVideoRecording)
        case (.drawing, .openColorPicker(let target)), (.textEditing, .openColorPicker(let target)):
            push(.colorPicker(target))

        case (let tool, .confirm) where tool.isEditorTool,
             (let tool, .cancel) where tool.isEditorTool:
            pop()

        case (.storyEditor, .requestClose(let hasChanges)):
            if hasChanges {
                push(.discardConfirmation)
            } else {
                pop()
            }
        case (.discardConfirmation, .keepEditing):
            pop()
        case (.discardConfirmation, .discard), (.discardConfirmation, .saveDraft):
            pop()
            pop()

        case (.storyEditor, .next):
            push(.publishing)
        case (.publishing, .backFromPublishing):
            pop()
        case (.publishing, .published):
            stack = [.closed]

        case (.camera, .dismiss), (.gallery, .dismiss), (.cameraCollage, .dismiss):
            stack = [.closed]

        default:
            return false
        }
        return true
    }

    private mutating func push(_ state: StoryEditorState) {
        stack.append(state)
    }

    private mutating func pop() {
        guard stack.count > 1 else {
            stack = [.closed]
            return
        }
        stack.removeLast()
    }

    private mutating func replaceTop(_ state: StoryEditorState) {
        stack[stack.count - 1] = state
    }
}
