import CoreGraphics
import Foundation

/// Состояние записи голосового — явная машина, как в Telegram.
///
/// Жест микрофона, конец аудиосессии и отправка приходят из разных мест и в любом
/// порядке. Решает за них одна чистая функция `handle(_:)`: она меняет фазу и говорит,
/// что сделать (`Effect`). Так гонки «отпустил палец, пока система прервала запись»
/// разбираются в одном месте, а сама логика проверяется тестами без микрофона.
struct VoiceRecordingMachine: Equatable {
    enum Phase: Equatable {
        case idle
        /// Спросили разрешение на микрофон. Палец к этому моменту уже снят системным
        /// окном — после «Разрешить» запись начинается следующим нажатием, как в Telegram.
        case requestingPermission
        /// Палец держит микрофон.
        case recording
        /// Свайп вверх: запись идёт без пальца.
        case lockedRecording
        /// Остановлено с замком или прервано системой: прослушать, удалить, отправить.
        case stopped
        /// Файл дописывается и читается перед отправкой.
        case preparing
        /// Голосовое передано в очередь отправки; дальше его ведёт пузырь в ленте.
        case uploading
        case failed(Failure)
    }

    enum Failure: Equatable {
        case permissionDenied
        case couldNotStart
        case emptyRecording
    }

    enum Haptic: Equatable {
        case start, lock, cancel, send
    }

    enum Hint: Equatable {
        /// Короткое касание: «Удерживайте, чтобы записать».
        case holdToRecord
    }

    enum Effect: Equatable {
        case requestPermission
        case startRecording
        /// Остановить запись. `send` — сразу отправить, иначе — оставить на прослушивание.
        case finishRecording(send: Bool)
        /// Отправить уже остановленную запись (из прослушивания).
        case sendStopped
        case discardRecording
        case haptic(Haptic)
        case showHint(Hint)
        /// Подпись «записывает голосовое…» у собеседников.
        case announce(Bool)
    }

    enum Event: Equatable {
        enum Permission: Equatable { case granted, undetermined, denied }

        case press(Permission)
        case permissionResolved(granted: Bool)
        case recordingStarted
        case recordingFailed
        /// Смещение пальца от точки нажатия (вверх и влево — отрицательные).
        case drag(CGSize)
        /// Палец отпущен; `duration` — сколько уже записано.
        case release(duration: TimeInterval)
        /// Система забрала касание (звонок, уведомление поверх).
        case touchCancelled(duration: TimeInterval)
        case tapStop(duration: TimeInterval)
        case tapSend
        case tapDelete
        /// Прервала аудиосессия или приложение ушло в фон.
        case interrupted(duration: TimeInterval)
        case prepared(ok: Bool)
        case uploadFinished
        case dismissFailure
    }

    /// Насколько увести палец влево, чтобы отменить.
    static let cancelDistance: CGFloat = 110
    /// Насколько поднять палец, чтобы закрепить запись.
    static let lockDistance: CGFloat = 72
    /// Короче — это не голосовое, а случайное касание.
    static let minimumDuration: TimeInterval = 0.5

    private(set) var phase: Phase = .idle

    var isRecording: Bool { phase == .recording || phase == .lockedRecording }
    /// Поле ввода уступает место записи.
    var isActive: Bool {
        switch phase {
        case .recording, .lockedRecording, .stopped, .preparing: return true
        default: return false
        }
    }

    /// Новую запись можно начать и пока прежняя уезжает на сервер.
    private var canStart: Bool {
        switch phase {
        case .idle, .uploading, .failed: return true
        default: return false
        }
    }

    @discardableResult
    mutating func handle(_ event: Event) -> [Effect] {
        switch (phase, event) {
        case (_, .press(let permission)) where canStart:
            switch permission {
            case .granted:
                phase = .recording
                return [.startRecording, .haptic(.start), .announce(true)]
            case .undetermined:
                phase = .requestingPermission
                return [.requestPermission]
            case .denied:
                phase = .failed(.permissionDenied)
                return []
            }

        case (.requestingPermission, .permissionResolved(let granted)):
            phase = granted ? .idle : .failed(.permissionDenied)
            return granted ? [.showHint(.holdToRecord)] : []

        case (.recording, .recordingFailed), (.lockedRecording, .recordingFailed):
            phase = .failed(.couldNotStart)
            return [.discardRecording, .announce(false)]

        case (.recording, .drag(let offset)):
            if offset.width <= -Self.cancelDistance {
                phase = .idle
                return [.discardRecording, .haptic(.cancel), .announce(false)]
            }
            // Вверх — только когда палец ушёл вверх заметнее, чем вбок: косой жест к
            // отмене не должен случайно закрепить запись.
            if offset.height <= -Self.lockDistance, abs(offset.height) > abs(offset.width) {
                phase = .lockedRecording
                return [.haptic(.lock)]
            }
            return []

        case (.recording, .release(let duration)):
            guard duration >= Self.minimumDuration else {
                phase = .idle
                return [.discardRecording, .showHint(.holdToRecord), .announce(false)]
            }
            phase = .preparing
            return [.finishRecording(send: true), .haptic(.send), .announce(false)]

        case (.recording, .touchCancelled(let duration)),
            (.recording, .interrupted(let duration)),
            (.lockedRecording, .interrupted(let duration)):
            // Отправлять без решения человека нельзя — оставляем на прослушивание.
            guard duration >= Self.minimumDuration else {
                phase = .idle
                return [.discardRecording, .announce(false)]
            }
            phase = .stopped
            return [.finishRecording(send: false), .announce(false)]

        case (.lockedRecording, .tapStop(let duration)):
            guard duration >= Self.minimumDuration else {
                phase = .idle
                return [.discardRecording, .announce(false)]
            }
            phase = .stopped
            return [.finishRecording(send: false), .announce(false)]

        case (.lockedRecording, .tapSend):
            phase = .preparing
            return [.finishRecording(send: true), .haptic(.send), .announce(false)]

        case (.stopped, .tapSend):
            phase = .preparing
            return [.sendStopped, .haptic(.send)]

        case (.lockedRecording, .tapDelete):
            phase = .idle
            return [.discardRecording, .haptic(.cancel), .announce(false)]

        case (.stopped, .tapDelete):
            phase = .idle
            return [.discardRecording, .haptic(.cancel)]

        case (.preparing, .prepared(let ok)):
            phase = ok ? .uploading : .failed(.emptyRecording)
            return []

        case (.uploading, .uploadFinished):
            phase = .idle
            return []

        case (.failed, .dismissFailure):
            phase = .idle
            return []

        default:
            // Всё остальное — запоздавшие события: палец отпущен после замка, второй
            // «стоп», прерывание без записи. Их игнорирование и есть защита от гонок.
            return []
        }
    }
}
