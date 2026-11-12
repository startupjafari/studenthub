import CoreGraphics
import XCTest

@testable import StudentHub

/// Жесты голосового как в Telegram: удержание, вверх — замок, влево — отмена,
/// отпустил — отправка. Машина чистая, поэтому сценарии проверяются без микрофона.
final class VoiceRecordingMachineTests: XCTestCase {
    private typealias Machine = VoiceRecordingMachine

    private func recording() -> Machine {
        var machine = Machine()
        machine.handle(.press(.granted))
        return machine
    }

    /// Нажатие с разрешением — запись сразу, с откликом и подписью у собеседников.
    func testPressWithPermissionStartsRecording() {
        var machine = Machine()
        let effects = machine.handle(.press(.granted))
        XCTAssertEqual(machine.phase, .recording)
        XCTAssertEqual(effects, [.startRecording, .haptic(.start), .announce(true)])
    }

    /// Первое нажатие спрашивает разрешение; записи нет — системное окно сняло палец.
    func testFirstPressRequestsPermissionWithoutRecording() {
        var machine = Machine()
        XCTAssertEqual(machine.handle(.press(.undetermined)), [.requestPermission])
        XCTAssertEqual(machine.phase, .requestingPermission)

        // Палец, снятый окном, не должен ничего отправить.
        XCTAssertEqual(machine.handle(.release(duration: 3)), [])

        XCTAssertEqual(machine.handle(.permissionResolved(granted: true)), [.showHint(.holdToRecord)])
        XCTAssertEqual(machine.phase, .idle)
    }

    func testDeniedPermissionFails() {
        var machine = Machine()
        machine.handle(.press(.undetermined))
        machine.handle(.permissionResolved(granted: false))
        XCTAssertEqual(machine.phase, .failed(.permissionDenied))

        var denied = Machine()
        XCTAssertEqual(denied.handle(.press(.denied)), [])
        XCTAssertEqual(denied.phase, .failed(.permissionDenied))
        denied.handle(.dismissFailure)
        XCTAssertEqual(denied.phase, .idle)
    }

    /// Отпустил без жестов — голосовое уходит.
    func testReleaseSends() {
        var machine = recording()
        let effects = machine.handle(.release(duration: 2.5))
        XCTAssertEqual(machine.phase, .preparing)
        XCTAssertEqual(effects, [.finishRecording(send: true), .haptic(.send), .announce(false)])
        machine.handle(.prepared(ok: true))
        XCTAssertEqual(machine.phase, .uploading)
        machine.handle(.uploadFinished)
        XCTAssertEqual(machine.phase, .idle)
    }

    /// Короткое касание — не голосовое: файл удаляется, показывается подсказка.
    func testQuickTapDiscardsAndHints() {
        var machine = recording()
        let effects = machine.handle(.release(duration: 0.2))
        XCTAssertEqual(machine.phase, .idle)
        XCTAssertEqual(effects, [.discardRecording, .showHint(.holdToRecord), .announce(false)])
    }

    /// Влево за порог — отмена сразу, ещё до отпускания; отпускание потом ничего не шлёт.
    func testSwipeLeftCancels() {
        var machine = recording()
        XCTAssertEqual(machine.handle(.drag(CGSize(width: -40, height: 0))), [])
        XCTAssertEqual(machine.phase, .recording)

        let effects = machine.handle(.drag(CGSize(width: -Machine.cancelDistance - 1, height: -5)))
        XCTAssertEqual(machine.phase, .idle)
        XCTAssertEqual(effects, [.discardRecording, .haptic(.cancel), .announce(false)])
        XCTAssertEqual(machine.handle(.release(duration: 4)), [])
    }

    /// Вверх до замка — запись продолжается без пальца; отпускание её не отправляет.
    func testSwipeUpLocks() {
        var machine = recording()
        let effects = machine.handle(.drag(CGSize(width: -10, height: -Machine.lockDistance - 1)))
        XCTAssertEqual(machine.phase, .lockedRecording)
        XCTAssertEqual(effects, [.haptic(.lock)])
        XCTAssertEqual(machine.handle(.release(duration: 3)), [])
        XCTAssertEqual(machine.phase, .lockedRecording)
    }

    /// Косой жест к отмене не закрепляет запись случайно.
    func testDiagonalDragDoesNotLock() {
        var machine = recording()
        machine.handle(.drag(CGSize(width: -100, height: -Machine.lockDistance - 1)))
        XCTAssertEqual(machine.phase, .recording)
    }

    func testLockedStopThenSend() {
        var machine = recording()
        machine.handle(.drag(CGSize(width: 0, height: -200)))
        XCTAssertEqual(machine.handle(.tapStop(duration: 4)), [.finishRecording(send: false), .announce(false)])
        XCTAssertEqual(machine.phase, .stopped)
        XCTAssertEqual(machine.handle(.tapSend), [.sendStopped, .haptic(.send)])
        XCTAssertEqual(machine.phase, .preparing)
    }

    func testLockedDelete() {
        var machine = recording()
        machine.handle(.drag(CGSize(width: 0, height: -200)))
        XCTAssertEqual(machine.handle(.tapDelete), [.discardRecording, .haptic(.cancel), .announce(false)])
        XCTAssertEqual(machine.phase, .idle)
    }

    func testLockedSendDirectly() {
        var machine = recording()
        machine.handle(.drag(CGSize(width: 0, height: -200)))
        XCTAssertEqual(machine.handle(.tapSend), [.finishRecording(send: true), .haptic(.send), .announce(false)])
    }

    func testStoppedDelete() {
        var machine = recording()
        machine.handle(.drag(CGSize(width: 0, height: -200)))
        machine.handle(.tapStop(duration: 4))
        XCTAssertEqual(machine.handle(.tapDelete), [.discardRecording, .haptic(.cancel)])
        XCTAssertEqual(machine.phase, .idle)
    }

    /// Звонок посреди записи: не теряем и не отправляем сами — на прослушивание.
    func testInterruptionKeepsRecordingForReview() {
        var held = recording()
        XCTAssertEqual(held.handle(.interrupted(duration: 3)), [.finishRecording(send: false), .announce(false)])
        XCTAssertEqual(held.phase, .stopped)

        var cancelled = recording()
        cancelled.handle(.touchCancelled(duration: 3))
        XCTAssertEqual(cancelled.phase, .stopped)

        var short = recording()
        XCTAssertEqual(short.handle(.interrupted(duration: 0.1)), [.discardRecording, .announce(false)])
        XCTAssertEqual(short.phase, .idle)
    }

    func testStartFailure() {
        var machine = recording()
        machine.handle(.recordingFailed)
        XCTAssertEqual(machine.phase, .failed(.couldNotStart))
    }

    func testEmptyFileFails() {
        var machine = recording()
        machine.handle(.release(duration: 2))
        machine.handle(.prepared(ok: false))
        XCTAssertEqual(machine.phase, .failed(.emptyRecording))
    }

    /// Пока прежнее голосовое уезжает, можно записывать следующее; запоздавший конец
    /// загрузки новую запись не сбрасывает.
    func testNewRecordingWhileUploading() {
        var machine = recording()
        machine.handle(.release(duration: 2))
        machine.handle(.prepared(ok: true))
        XCTAssertEqual(machine.phase, .uploading)
        machine.handle(.press(.granted))
        XCTAssertEqual(machine.phase, .recording)
        XCTAssertEqual(machine.handle(.uploadFinished), [])
        XCTAssertEqual(machine.phase, .recording)
    }

    /// Повторное нажатие во время записи не начинает вторую.
    func testPressWhileRecordingIgnored() {
        var machine = recording()
        XCTAssertEqual(machine.handle(.press(.granted)), [])
        XCTAssertEqual(machine.phase, .recording)
    }
}
