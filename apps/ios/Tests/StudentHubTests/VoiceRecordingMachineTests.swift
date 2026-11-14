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
        XCTAssertEqual(machine.handle(.release(duration: 3, held: 3)), [])

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
        let effects = machine.handle(.release(duration: 2.5, held: 2.5))
        XCTAssertEqual(machine.phase, .preparing)
        XCTAssertEqual(effects, [.finishRecording(send: true), .haptic(.send), .announce(false)])
        machine.handle(.prepared(ok: true))
        XCTAssertEqual(machine.phase, .uploading)
        machine.handle(.uploadFinished)
        XCTAssertEqual(machine.phase, .idle)
    }

    /// Короткое касание микрофона — запись с замком, как в Telegram: таймер, «Отмена»
    /// и большая кнопка отправки; отпускание её не обрывает.
    func testQuickTapLocksRecording() {
        var machine = recording()
        let effects = machine.handle(.release(duration: 0.2, held: 0.2))
        XCTAssertEqual(machine.phase, .lockedRecording)
        XCTAssertEqual(effects, [.haptic(.lock)])
        // Касание раньше, чем включилась сессия звука, — тоже замок: запись догонит.
        var cold = recording()
        cold.handle(.release(duration: 0, held: 0.1))
        XCTAssertEqual(cold.phase, .lockedRecording)
    }

    /// Запись касанием отправляется большой кнопкой и отменяется «Отменой».
    func testTapRecordingSendsAndCancels() {
        var sent = recording()
        sent.handle(.release(duration: 0.1, held: 0.1))
        XCTAssertEqual(sent.handle(.tapSend), [.finishRecording(send: true), .haptic(.send), .announce(false)])
        XCTAssertEqual(sent.phase, .preparing)

        var cancelled = recording()
        cancelled.handle(.release(duration: 0.1, held: 0.1))
        XCTAssertEqual(cancelled.handle(.tapDelete), [.discardRecording, .haptic(.cancel), .announce(false)])
        XCTAssertEqual(cancelled.phase, .idle)
    }

    /// Палец держал, а звука почти нет — сессия включалась дольше удержания. Это не
    /// короткое касание: «удерживайте» не показываем, запись просто не начата.
    func testLongHoldWithoutSoundDiscardsWithoutHint() {
        var machine = recording()
        let effects = machine.handle(.release(duration: 0.1, held: 1.5))
        XCTAssertEqual(machine.phase, .idle)
        XCTAssertEqual(effects, [.discardRecording, .announce(false)])
    }

    /// Отменённая запись касанием не ломает следующее удержание: оно сразу начинает запись.
    func testTapThenHoldStartsRecording() {
        var machine = recording()
        machine.handle(.release(duration: 0.1, held: 0.1))
        machine.handle(.tapDelete)
        XCTAssertEqual(machine.phase, .idle)
        XCTAssertEqual(machine.handle(.press(.granted)), [.startRecording, .haptic(.start), .announce(true)])
        XCTAssertEqual(machine.phase, .recording)
        machine.handle(.release(duration: 1.2, held: 1.3))
        XCTAssertEqual(machine.phase, .preparing)
    }

    /// Влево за порог — отмена сразу, ещё до отпускания; отпускание потом ничего не шлёт.
    func testSwipeLeftCancels() {
        var machine = recording()
        XCTAssertEqual(machine.handle(.drag(CGSize(width: -40, height: 0))), [])
        XCTAssertEqual(machine.phase, .recording)

        let effects = machine.handle(.drag(CGSize(width: -Machine.cancelDistance - 1, height: -5)))
        XCTAssertEqual(machine.phase, .idle)
        XCTAssertEqual(effects, [.discardRecording, .haptic(.cancel), .announce(false)])
        XCTAssertEqual(machine.handle(.release(duration: 4, held: 4)), [])
    }

    /// Вверх до замка — запись продолжается без пальца; отпускание её не отправляет.
    func testSwipeUpLocks() {
        var machine = recording()
        let effects = machine.handle(.drag(CGSize(width: -10, height: -Machine.lockDistance - 1)))
        XCTAssertEqual(machine.phase, .lockedRecording)
        XCTAssertEqual(effects, [.haptic(.lock)])
        XCTAssertEqual(machine.handle(.release(duration: 3, held: 3)), [])
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

    /// Остановленная запись не дописалась — ошибка, а не молча пустое поле.
    func testStoppedEmptyFileFails() {
        var machine = recording()
        machine.handle(.drag(CGSize(width: 0, height: -200)))
        machine.handle(.tapStop(duration: 3))
        XCTAssertEqual(machine.handle(.prepared(ok: false)), [.discardRecording])
        XCTAssertEqual(machine.phase, .failed(.emptyRecording))
    }

    /// Панель ввода ушла посреди записи: запись удаляется, подпись у собеседников гаснет.
    func testAbandonDiscards() {
        var held = recording()
        XCTAssertEqual(held.handle(.abandon), [.discardRecording, .announce(false)])
        XCTAssertEqual(held.phase, .idle)

        var locked = recording()
        locked.handle(.drag(CGSize(width: 0, height: -200)))
        XCTAssertEqual(locked.handle(.abandon), [.discardRecording, .announce(false)])

        var idle = Machine()
        XCTAssertEqual(idle.handle(.abandon), [])
    }

    func testEmptyFileFails() {
        var machine = recording()
        machine.handle(.release(duration: 2, held: 2))
        machine.handle(.prepared(ok: false))
        XCTAssertEqual(machine.phase, .failed(.emptyRecording))
    }

    /// Пока прежнее голосовое уезжает, можно записывать следующее; запоздавший конец
    /// загрузки новую запись не сбрасывает.
    func testNewRecordingWhileUploading() {
        var machine = recording()
        machine.handle(.release(duration: 2, held: 2))
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

    // MARK: Пауза и продолжение

    private func paused() -> Machine {
        var machine = recording()
        machine.handle(.release(duration: 0.1, held: 0.1))
        machine.handle(.tapStop(duration: 3))
        return machine
    }

    /// Пауза в записи с замком — прослушивание; микрофон там продолжает запись с замком.
    func testResumeFromPauseContinuesLocked() {
        var machine = paused()
        XCTAssertEqual(machine.phase, .stopped)
        XCTAssertEqual(machine.handle(.tapResume), [.resumeRecording, .haptic(.start), .announce(true)])
        XCTAssertEqual(machine.phase, .lockedRecording)
        XCTAssertTrue(machine.isContinuation)

        // Снова пауза, снова продолжение — сколько угодно раз.
        XCTAssertEqual(machine.handle(.tapStop(duration: 5)), [.finishRecording(send: false), .announce(false)])
        XCTAssertEqual(machine.phase, .stopped)
        machine.handle(.tapResume)
        XCTAssertEqual(machine.phase, .lockedRecording)

        // Отправка из продолжения — склеенная запись целиком.
        XCTAssertEqual(machine.handle(.tapSend), [.finishRecording(send: true), .haptic(.send), .announce(false)])
        XCTAssertEqual(machine.phase, .preparing)
    }

    /// Продолжение не запустилось (микрофон занят) — записанное не теряется, а
    /// возвращается на прослушивание.
    func testResumeFailureRestoresStopped() {
        var machine = paused()
        machine.handle(.tapResume)
        XCTAssertEqual(machine.handle(.recordingFailed), [.restoreStopped, .announce(false)])
        XCTAssertEqual(machine.phase, .stopped)
    }

    /// Новая запись — уже не продолжение: её сбой — обычная ошибка.
    func testNewRecordingIsNotContinuation() {
        var machine = paused()
        machine.handle(.tapResume)
        machine.handle(.tapDelete)
        XCTAssertEqual(machine.phase, .idle)
        machine.handle(.press(.granted))
        XCTAssertFalse(machine.isContinuation)
        machine.handle(.recordingFailed)
        XCTAssertEqual(machine.phase, .failed(.couldNotStart))
    }

    /// Звонок посреди продолжения — снова на прослушивание, ничего не уходит само.
    func testInterruptedContinuationStops() {
        var machine = paused()
        machine.handle(.tapResume)
        XCTAssertEqual(machine.handle(.interrupted(duration: 4)), [.finishRecording(send: false), .announce(false)])
        XCTAssertEqual(machine.phase, .stopped)
    }

    /// «Продолжить» вне прослушивания — запоздавшее событие, его не замечаем.
    func testResumeIgnoredOutsideStopped() {
        var idle = Machine()
        XCTAssertEqual(idle.handle(.tapResume), [])
        XCTAssertEqual(idle.phase, .idle)

        var held = recording()
        XCTAssertEqual(held.handle(.tapResume), [])
        XCTAssertEqual(held.phase, .recording)

        var sending = paused()
        sending.handle(.tapSend)
        XCTAssertEqual(sending.handle(.tapResume), [])
        XCTAssertEqual(sending.phase, .preparing)
    }
}

/// Обрезка перед продолжением: какой отрезок файла и какая часть волны остаются.
final class VoiceSegmentTests: XCTestCase {
    private let url = URL(filePath: "/tmp/voice-test.m4a")

    func testWholeFileHasNoRange() {
        let segment = VoiceSegment(url: url, duration: 4, selection: 0...1, envelope: [])
        XCTAssertNil(segment.range)
        XCTAssertEqual(segment.length, 4)
    }

    func testTrimmedRangeInSeconds() {
        let segment = VoiceSegment(url: url, duration: 10, selection: 0.2...0.5, envelope: [])
        XCTAssertEqual(segment.range?.lowerBound ?? 0, 2, accuracy: 0.000_1)
        XCTAssertEqual(segment.range?.upperBound ?? 0, 5, accuracy: 0.000_1)
        XCTAssertEqual(segment.length, 3, accuracy: 0.000_1)
    }

    func testEnvelopeSlice() {
        let levels: [Float] = (0..<10).map(Float.init)
        XCTAssertEqual(VoiceSegment.slice(levels, to: 0...1), levels)
        XCTAssertEqual(VoiceSegment.slice(levels, to: 0.2...0.5), [2, 3, 4])
        XCTAssertEqual(VoiceSegment.slice([], to: 0.2...0.5), [])
        XCTAssertEqual(VoiceSegment.slice(levels, to: 1...1), [])
    }
}
