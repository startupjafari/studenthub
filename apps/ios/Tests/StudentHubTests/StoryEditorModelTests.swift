import XCTest

@testable import StudentHub

// Модель редактора историй: машина состояний, сессия с отменой инструментов, рисунок
// с отменой и повтором, кривые, размытие, коллаж, выбор в галерее, черновики.
// Всё — без камеры, UIKit и разрешений (ЧАСТЬ 16, п. 7 задания).

private func photoDocument() -> StoryDocument {
    StoryDocument(background: .photo(file: "source.jpg", size: StorySize(width: 3024, height: 4032)))
}

private func stroke(_ points: [(Double, Double)], brush: StoryBrush = .pen, color: StoryColor = .white) -> StoryStroke {
    StoryStroke(brush: brush, color: color, width: brush.defaultWidth, points: points.map { StoryPoint(x: $0.0, y: $0.1) })
}

final class StoryEditorMachineTests: XCTestCase {
    func testStartsInCameraAndOpensCollagePicker() {
        var machine = StoryEditorMachine()
        XCTAssertEqual(machine.state, .camera)

        XCTAssertTrue(machine.send(.openCollagePicker))
        XCTAssertEqual(machine.state, .cameraCollage)
        XCTAssertTrue(machine.send(.closeCollagePicker))
        XCTAssertEqual(machine.state, .camera)
    }

    func testRecordingStartsOnlyFromCameraAndReturnsToIt() {
        var machine = StoryEditorMachine()
        XCTAssertTrue(machine.send(.startRecording))
        XCTAssertEqual(machine.state, .recording)
        XCTAssertFalse(machine.send(.openGallery), "галерея не открывается посреди записи")
        XCTAssertTrue(machine.send(.stopRecording))
        XCTAssertEqual(machine.state, .camera)
    }

    func testMediaFromGalleryReturnsToGalleryOnBack() {
        var machine = StoryEditorMachine()
        machine.send(.openGallery)
        XCTAssertTrue(machine.send(.mediaReady(.gallery)))
        XCTAssertEqual(machine.state, .storyEditor)
        XCTAssertEqual(machine.underlying, .gallery)

        XCTAssertTrue(machine.send(.requestClose(hasChanges: false)))
        XCTAssertEqual(machine.state, .gallery, "без изменений «×» возвращает в галерею")
    }

    func testMediaFromCameraReturnsToCamera() {
        var machine = StoryEditorMachine()
        machine.send(.mediaReady(.camera))
        machine.send(.requestClose(hasChanges: false))
        XCTAssertEqual(machine.state, .camera)
    }

    /// Взаимоисключающие панели: из рисования не открыть обработку поверх.
    func testExclusivePanelsCannotStack() {
        var machine = StoryEditorMachine()
        machine.send(.mediaReady(.camera))
        XCTAssertTrue(machine.send(.openDrawing))
        XCTAssertFalse(machine.send(.openAdjustments(.tools)))
        XCTAssertFalse(machine.send(.openRoundVideo))
        XCTAssertFalse(machine.send(.next))
        XCTAssertEqual(machine.state, .drawing)
    }

    /// «Назад» снимает ровно один уровень: выбор цвета → рисование → редактор.
    func testBackReturnsOneLevel() {
        var machine = StoryEditorMachine()
        machine.send(.mediaReady(.camera))
        machine.send(.openDrawing)
        machine.send(.openColorPicker(.drawing))
        XCTAssertEqual(machine.state, .colorPicker(.drawing))
        XCTAssertTrue(machine.send(.cancel))
        XCTAssertEqual(machine.state, .drawing)
        XCTAssertTrue(machine.send(.confirm))
        XCTAssertEqual(machine.state, .storyEditor)
    }

    func testAdjustmentTabsReplaceEachOther() {
        var machine = StoryEditorMachine()
        machine.send(.mediaReady(.camera))
        machine.send(.openAdjustments(.tools))
        let depth = machine.depth
        machine.send(.openAdjustments(.blur))
        XCTAssertEqual(machine.state, .blurAdjustment)
        machine.send(.openAdjustments(.curves))
        XCTAssertEqual(machine.state, .curvesAdjustment)
        XCTAssertEqual(machine.depth, depth, "вкладки не копятся в стеке")
        machine.send(.confirm)
        XCTAssertEqual(machine.state, .storyEditor)
    }

    func testDiscardDialogFlows() {
        var machine = StoryEditorMachine()
        machine.send(.mediaReady(.camera))
        machine.send(.requestClose(hasChanges: true))
        XCTAssertEqual(machine.state, .discardConfirmation)
        machine.send(.keepEditing)
        XCTAssertEqual(machine.state, .storyEditor)
        machine.send(.requestClose(hasChanges: true))
        machine.send(.discard)
        XCTAssertEqual(machine.state, .camera)
    }

    func testPublishingAndClose() {
        var machine = StoryEditorMachine()
        machine.send(.mediaReady(.camera))
        XCTAssertTrue(machine.send(.next))
        XCTAssertEqual(machine.state, .publishing)
        XCTAssertTrue(machine.send(.backFromPublishing))
        XCTAssertEqual(machine.state, .storyEditor)
        machine.send(.next)
        machine.send(.published)
        XCTAssertEqual(machine.state, .closed)
    }

    func testTextTabFromDrawingReplacesTool() {
        var machine = StoryEditorMachine()
        machine.send(.mediaReady(.camera))
        machine.send(.openDrawing)
        let id = UUID()
        XCTAssertTrue(machine.send(.beginText(entityID: id, isNew: true)))
        XCTAssertEqual(machine.state, .textEditing(entityID: id, isNew: true, input: .keyboard))
        XCTAssertEqual(machine.underlying, .storyEditor)
    }
}

final class StoryEditorSessionTests: XCTestCase {
    private func openSession() -> StoryEditorSession {
        var session = StoryEditorSession()
        XCTAssertTrue(session.open(photoDocument(), from: .camera))
        return session
    }

    private func setText(_ session: inout StoryEditorSession, _ id: UUID, _ text: String) {
        session.edit { document in
            document.update(id) { entity in
                if case var .text(payload) = entity.kind {
                    payload.text = text
                    entity.kind = .text(payload)
                }
            }
        }
    }

    func testFreshMediaHasNoChanges() {
        var session = openSession()
        XCTAssertFalse(session.hasChanges)
        XCTAssertEqual(session.requestClose(), .camera, "без изменений выход без диалога")
        XCTAssertNil(session.document)
    }

    /// Выбор кисти без единого штриха — не изменение.
    func testSelectingBrushIsNotAChange() {
        var session = openSession()
        session.openDrawing()
        session.edit { $0.drawingTool.brush = .neon }
        session.confirm()
        XCTAssertFalse(session.hasChanges)
        XCTAssertFalse(session.canUndo)
    }

    /// Отмена инструмента откатывает только его правки.
    func testCancelToolKeepsEarlierEdits() throws {
        var session = openSession()
        let textID = try XCTUnwrap(session.beginText())
        setText(&session, textID, "Привет")
        session.confirm()

        session.openDrawing()
        session.edit { $0.drawing.add(stroke([(0.1, 0.1), (0.2, 0.2)])) }
        XCTAssertEqual(session.document?.drawing.strokes.count, 1)
        session.cancel()

        XCTAssertEqual(session.document?.drawing.strokes.count, 0, "штрих отменённого рисования ушёл")
        XCTAssertNotNil(session.document?.entity(textID), "надпись до рисования осталась")
        XCTAssertEqual(session.state, .storyEditor)
    }

    /// Повторная правка надписи не создаёт дубликат.
    func testEditingExistingTextDoesNotDuplicate() throws {
        var session = openSession()
        let id = try XCTUnwrap(session.beginText())
        setText(&session, id, "Первая строка\nвторая")
        session.confirm()

        XCTAssertEqual(session.beginText(existing: id), id)
        setText(&session, id, "Первая строка\nвторая\nтретья 🎉")
        session.confirm()

        let texts = session.document?.textEntities ?? []
        XCTAssertEqual(texts.count, 1)
        guard case let .text(payload) = texts.first?.kind else { return XCTFail("не текст") }
        XCTAssertEqual(payload.text, "Первая строка\nвторая\nтретья 🎉")
    }

    func testBlankNewTextDisappearsOnConfirm() throws {
        var session = openSession()
        let id = try XCTUnwrap(session.beginText())
        setText(&session, id, "   \n ")
        session.confirm()
        XCTAssertNil(session.document?.entity(id))
        XCTAssertFalse(session.hasChanges)
    }

    func testCancelNewTextRemovesIt() throws {
        var session = openSession()
        let id = try XCTUnwrap(session.beginText())
        setText(&session, id, "Черновик")
        session.cancel()
        XCTAssertNil(session.document?.entity(id))
    }

    /// Отмена цвета не стирает нарисованное до выбора цвета.
    func testColorPickerCancelKeepsStrokes() {
        var session = openSession()
        session.openDrawing()
        session.edit { $0.drawing.add(stroke([(0.1, 0.1), (0.3, 0.3)])) }
        XCTAssertTrue(session.openColorPicker(.drawing))
        session.edit { $0.drawingTool.color = StoryColor(hex: "#FF0000")! }
        session.cancel()

        XCTAssertEqual(session.state, .drawing)
        XCTAssertEqual(session.document?.drawingTool.color, .white)
        XCTAssertEqual(session.document?.drawing.strokes.count, 1)
    }

    /// Повторное открытие инструмента показывает прежние параметры.
    func testToolParametersPersistAcrossReopen() {
        var session = openSession()
        session.openDrawing()
        session.edit {
            $0.drawingTool.brush = .marker
            $0.drawingTool.setWidth(0.05, for: .marker)
        }
        session.confirm()
        session.openDrawing()
        XCTAssertEqual(session.document?.drawingTool.brush, .marker)
        XCTAssertEqual(session.document?.drawingTool.width(for: .marker), 0.05)
    }

    /// Шаг «Назад» нижней панели снимает инструмент целиком.
    func testUndoRemovesLastTool() {
        var session = openSession()
        session.openAdjustments(.tools)
        session.edit {
            $0.adjustments[.brightness] = 30
            $0.adjustments[.contrast] = 20
        }
        session.confirm()
        session.openDrawing()
        session.edit { $0.drawing.add(stroke([(0.5, 0.5)])) }
        session.confirm()

        XCTAssertTrue(session.undo())
        XCTAssertEqual(session.document?.drawing.strokes.count, 0)
        XCTAssertEqual(session.document?.adjustments[.brightness], 30, "обработка до рисования осталась")
        XCTAssertTrue(session.undo())
        XCTAssertTrue(session.document?.adjustments.isIdentity ?? false)
        XCTAssertFalse(session.undo())
    }

    func testDiscardDialogWithChanges() {
        var session = openSession()
        session.edit { $0.caption = "подпись" }
        XCTAssertEqual(session.requestClose(), .discardConfirmation)
        XCTAssertTrue(session.keepEditing())
        XCTAssertEqual(session.state, .storyEditor)
        XCTAssertEqual(session.document?.caption, "подпись", "«Отмена» диалога ничего не теряет")

        XCTAssertEqual(session.requestClose(), .discardConfirmation)
        XCTAssertTrue(session.discard())
        XCTAssertEqual(session.state, .camera)
        XCTAssertNil(session.document)
    }

    func testSaveDraftReturnsDocument() {
        var session = openSession()
        session.edit { $0.caption = "в черновик" }
        session.requestClose()
        let saved = session.saveDraftAndClose()
        XCTAssertEqual(saved?.caption, "в черновик")
        XCTAssertEqual(session.state, .camera)
    }

    func testTextFromDrawingTabCommitsDrawing() throws {
        var session = openSession()
        session.openDrawing()
        session.edit { $0.drawing.add(stroke([(0.2, 0.2), (0.4, 0.4)])) }
        let id = try XCTUnwrap(session.beginText())
        setText(&session, id, "текст")
        session.cancel()
        XCTAssertEqual(session.document?.drawing.strokes.count, 1, "отмена текста не трогает рисунок")
        XCTAssertEqual(session.state, .storyEditor)
    }

    func testToolCannotOpenWithoutDocument() {
        var session = StoryEditorSession()
        XCTAssertFalse(session.openDrawing())
        XCTAssertNil(session.beginText())
    }
}

final class StoryDrawingTests: XCTestCase {
    /// Тест 5 задания: «Отмена» снимает только вторую линию, «Очистить всё» — все.
    func testUndoRemovesOnlyLastStrokeAndClearAllRemovesAll() {
        var document = photoDocument()
        let textID = document.add(.text(StoryTextPayload(text: "текст")), size: StorySize(width: 0.5, height: 0.1))
        document.drawing.add(stroke([(0.1, 0.1), (0.2, 0.2)], brush: .pen, color: .white))
        document.drawing.add(stroke([(0.5, 0.5), (0.6, 0.7)], brush: .neon, color: StoryColor(hex: "#30D158")!))

        XCTAssertTrue(document.drawing.undo())
        XCTAssertEqual(document.drawing.strokes.count, 1)
        XCTAssertEqual(document.drawing.strokes.first?.brush, .pen)

        XCTAssertTrue(document.drawing.clearAll())
        XCTAssertTrue(document.drawing.isEmpty)
        XCTAssertNotNil(document.entity(textID), "надпись не рисунок — остаётся")
        XCTAssertEqual(document.background, photoDocument().background, "фото не тронуто")
    }

    func testUndoClearRestoresStrokesAndRedoWorks() {
        var drawing = StoryDrawing()
        drawing.add(stroke([(0.1, 0.1)]))
        drawing.add(stroke([(0.2, 0.2)]))
        drawing.clearAll()
        XCTAssertTrue(drawing.undo())
        XCTAssertEqual(drawing.strokes.count, 2)
        XCTAssertTrue(drawing.redo())
        XCTAssertTrue(drawing.isEmpty)
        XCTAssertTrue(drawing.undo())
        XCTAssertTrue(drawing.undo())
        XCTAssertEqual(drawing.strokes.count, 1)
        XCTAssertTrue(drawing.redo())
        XCTAssertEqual(drawing.strokes.count, 2)
    }

    func testNewStrokeDropsRedo() {
        var drawing = StoryDrawing()
        drawing.add(stroke([(0.1, 0.1)]))
        drawing.undo()
        XCTAssertTrue(drawing.canRedo)
        drawing.add(stroke([(0.3, 0.3)]))
        XCTAssertFalse(drawing.canRedo)
        XCTAssertFalse(drawing.redo())
    }

    /// Много операций подряд — история не ломается.
    func testLongHistoryStaysConsistent() {
        var drawing = StoryDrawing()
        for index in 0..<20 { drawing.add(stroke([(Double(index) / 20, 0.5)])) }
        drawing.clearAll()
        for _ in 0..<5 { drawing.undo() }
        XCTAssertEqual(drawing.strokes.count, 16)
        for _ in 0..<3 { drawing.redo() }
        XCTAssertEqual(drawing.strokes.count, 19)
        while drawing.undo() {}
        XCTAssertTrue(drawing.isEmpty)
        while drawing.redo() {}
        XCTAssertTrue(drawing.isEmpty, "последнее действие — очистка")
    }

    func testClearingEmptyLayerAddsNoStep() {
        var drawing = StoryDrawing()
        XCTAssertFalse(drawing.clearAll())
        XCTAssertFalse(drawing.canUndo)
    }

    func testSmoothingProducesCurveThroughMidpoints() {
        let points = [(0.0, 0.0), (0.1, 0.0), (0.1, 0.1), (0.2, 0.1)].map { StoryPoint(x: $0.0, y: $0.1) }
        let elements = StoryStrokeSmoothing.elements(for: points)
        XCTAssertEqual(elements.first, .move(points[0]))
        XCTAssertEqual(elements.last, .line(points[3]))
        XCTAssertEqual(elements.filter { if case .quad = $0 { return true } else { return false } }.count, 2)
        XCTAssertEqual(elements[2], .quad(to: points[1].midpoint(points[2]), control: points[1]))
    }

    func testDotStrokeIsZeroLengthLine() {
        let point = StoryPoint(x: 0.4, y: 0.4)
        XCTAssertEqual(StoryStrokeSmoothing.elements(for: [point]), [.move(point), .line(point)])
    }

    func testJitterBelowStepIsDropped() {
        var points: [StoryPoint] = []
        XCTAssertTrue(StoryStrokeSmoothing.append(StoryPoint(x: 0.5, y: 0.5), to: &points))
        XCTAssertFalse(StoryStrokeSmoothing.append(StoryPoint(x: 0.5001, y: 0.5), to: &points))
        XCTAssertTrue(StoryStrokeSmoothing.append(StoryPoint(x: 0.51, y: 0.5), to: &points))
        XCTAssertEqual(points.count, 2)
    }

    func testArrowHeadPointsBackwards() throws {
        let points = (0...10).map { StoryPoint(x: 0.2 + Double($0) * 0.05, y: 0.5) }
        let head = try XCTUnwrap(StoryStrokeSmoothing.arrowHead(for: points, width: 0.012))
        XCTAssertEqual(head.tip, points.last)
        XCTAssertLessThan(head.left.x, head.tip.x)
        XCTAssertLessThan(head.right.x, head.tip.x)
        XCTAssertEqual(head.left.y + head.right.y, 1, accuracy: 1e-9, "усы симметричны относительно линии")
    }

    func testBrushWidthsAreIndependent() {
        var tool = StoryDrawingTool()
        tool.setWidth(0.03, for: .pen)
        tool.setWidth(1, for: .marker)
        XCTAssertEqual(tool.width(for: .pen), 0.03)
        XCTAssertEqual(tool.width(for: .marker), StoryBrush.marker.widthRange.upperBound)
        XCTAssertEqual(tool.width(for: .neon), StoryBrush.neon.defaultWidth)
    }
}

final class StoryAdjustmentModelTests: XCTestCase {
    func testAdjustmentsAreIndependentAndClamped() {
        var adjustments = StoryAdjustments()
        adjustments[.brightness] = 40
        adjustments[.contrast] = -20
        adjustments[.sharpen] = -50
        XCTAssertEqual(adjustments[.brightness], 40)
        XCTAssertEqual(adjustments[.contrast], -20)
        XCTAssertEqual(adjustments[.sharpen], 0, "резкость не уходит ниже нуля")
        adjustments.reset(.brightness)
        XCTAssertEqual(adjustments[.brightness], 0)
        XCTAssertEqual(adjustments[.contrast], -20)
        XCTAssertEqual(adjustments.changedTools, [.contrast])
    }

    func testIdentityCurveTableIsLinear() {
        let table = StoryToneCurves.identity.table(count: 5)
        XCTAssertEqual(table.count, 15)
        for (index, value) in table.enumerated() {
            XCTAssertEqual(Double(value), Double(index / 3) / 4, accuracy: 1e-6)
        }
    }

    func testRaisingMidtoneBrightensMiddleOnly() {
        var curve = StoryToneCurve.identity
        curve.setPoint(2, y: 0.7)
        XCTAssertEqual(curve.value(at: 0.5), 0.7, accuracy: 1e-9)
        XCTAssertEqual(curve.value(at: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(curve.value(at: 1), 1, accuracy: 1e-9)
        XCTAssertGreaterThan(curve.value(at: 0.4), 0.4)
    }

    /// Монотонная кривая без «горбов» между точками.
    func testCurveIsMonotone() {
        let curve = StoryToneCurve(ys: [0, 0.05, 0.9, 0.92, 1])
        var previous = -1.0
        for step in 0...200 {
            let value = curve.value(at: Double(step) / 200)
            XCTAssertGreaterThanOrEqual(value, previous - 1e-9)
            previous = value
        }
    }

    func testChannelCurveAffectsOnlyItsChannel() {
        var curves = StoryToneCurves()
        curves[.red].setPoint(2, y: 0.8)
        let table = curves.table(count: 3)
        XCTAssertEqual(Double(table[3]), 0.8, accuracy: 1e-6, "красный в середине поднят")
        XCTAssertEqual(Double(table[4]), 0.5, accuracy: 1e-6)
        XCTAssertEqual(Double(table[5]), 0.5, accuracy: 1e-6)
    }

    func testRadialBlurKeepsCenterSharp() {
        var blur = StoryBlur()
        blur.mode = .radial
        blur.center = StoryPoint(x: 0.5, y: 0.5)
        XCTAssertEqual(blur.sharpness(at: StoryPoint(x: 0.5, y: 0.5)), 1)
        XCTAssertEqual(blur.sharpness(at: StoryPoint(x: 0.0, y: 0.0)), 0)
    }

    func testLinearBlurFollowsMovedBand() {
        var blur = StoryBlur()
        blur.mode = .linear
        blur.size = 0.1
        blur.setCenter(StoryPoint(x: 0.5, y: 0.2))
        XCTAssertEqual(blur.sharpness(at: StoryPoint(x: 0.9, y: 0.2)), 1, "вдоль горизонтальной полосы резко")
        XCTAssertEqual(blur.sharpness(at: StoryPoint(x: 0.5, y: 0.8)), 0)
        blur.angle = .pi / 2
        XCTAssertEqual(blur.sharpness(at: StoryPoint(x: 0.5, y: 0.8)), 1, "полоса повёрнута вертикально")
    }

    func testBlurOffIsSharpEverywhere() {
        XCTAssertEqual(StoryBlur.off.sharpness(at: .zero), 1)
    }
}

final class StoryCollageTests: XCTestCase {
    func testFourGridHasFourCellsCoveringCanvas() {
        let cells = StoryCollageLayout.fourGrid.cells
        XCTAssertEqual(cells.count, 4)
        XCTAssertEqual(cells.reduce(0) { $0 + $1.width * $1.height }, 1, accuracy: 1e-9)
        XCTAssertTrue(cells[3].contains(StoryPoint(x: 0.75, y: 0.75)))
    }

    func testEveryLayoutCoversCanvasExactly() {
        for layout in StoryCollageLayout.allCases {
            XCTAssertEqual(layout.cells.reduce(0) { $0 + $1.width * $1.height }, 1, accuracy: 1e-9, layout.rawValue)
        }
    }

    func testCaptureAdvancesThroughCells() {
        var capture = StoryCollageCapture<String>(layout: .fourGrid)
        XCTAssertEqual(capture.activeIndex, 0)
        capture.capture("a")
        capture.capture("b")
        XCTAssertEqual(capture.activeIndex, 2)
        capture.capture("c")
        capture.capture("d")
        XCTAssertTrue(capture.isComplete)
        XCTAssertNil(capture.activeIndex)
        XCTAssertEqual(capture.frames, ["a", "b", "c", "d"])
    }

    func testRetakeReplacesOnlyThatCell() {
        var capture = StoryCollageCapture<String>(layout: .fourGrid)
        ["a", "b", "c", "d"].forEach { capture.capture($0) }
        capture.retake(1)
        XCTAssertEqual(capture.activeIndex, 1)
        XCTAssertFalse(capture.isComplete)
        capture.capture("B")
        XCTAssertEqual(capture.frames, ["a", "B", "c", "d"])
        XCTAssertTrue(capture.isComplete)
    }

    func testCaptureWrapsToEarlierEmptyCell() {
        var capture = StoryCollageCapture<String>(layout: .threeStacked)
        capture.activate(0)
        capture.capture("a")
        capture.retake(0)
        capture.activate(2)
        capture.capture("c")
        XCTAssertEqual(capture.activeIndex, 0, "после последней — к пустой в начале")
    }

    func testChangingToSmallerLayoutDropsExtraFrames() {
        var capture = StoryCollageCapture<String>(layout: .fourGrid)
        ["a", "b", "c"].forEach { capture.capture($0) }
        XCTAssertTrue(capture.wouldDropFrames(changingTo: .twoStacked))
        let dropped = capture.change(to: .twoStacked)
        XCTAssertEqual(dropped, ["c"])
        XCTAssertEqual(capture.frames, ["a", "b"])
        XCTAssertTrue(capture.isComplete)
    }
}

final class StoryGallerySelectionTests: XCTestCase {
    func testNumbersFollowSelectionOrder() {
        var selection = StoryGallerySelection()
        selection.toggle("c")
        selection.toggle("a")
        selection.toggle("b")
        XCTAssertEqual(selection.number(of: "c"), 1)
        XCTAssertEqual(selection.number(of: "a"), 2)
        selection.toggle("c")
        XCTAssertNil(selection.number(of: "c"))
        XCTAssertEqual(selection.ids, ["a", "b"], "порядок остальных не меняется")
    }

    func testLimit() {
        var selection = StoryGallerySelection()
        for index in 0..<StoryGallerySelection.limit { XCTAssertTrue(selection.toggle("\(index)")) }
        XCTAssertFalse(selection.toggle("extra"))
        XCTAssertEqual(selection.count, StoryGallerySelection.limit)
    }
}

final class StoryColorTests: XCTestCase {
    func testHexRoundTrip() {
        XCTAssertEqual(StoryColor(hex: "#30D158")?.hex, "#30D158")
        XCTAssertEqual(StoryColor(hex: "ff000080")?.alpha ?? 0, 128.0 / 255, accuracy: 1e-9)
        XCTAssertNil(StoryColor(hex: "#12"))
    }

    func testHSBRoundTrip() {
        let color = StoryColor(hue: 0.6, saturation: 0.7, brightness: 0.8)
        let hsb = color.hsb
        XCTAssertEqual(hsb.hue, 0.6, accuracy: 1e-9)
        XCTAssertEqual(hsb.saturation, 0.7, accuracy: 1e-9)
        XCTAssertEqual(hsb.brightness, 0.8, accuracy: 1e-9)
    }

    /// Тест 6 задания: прозрачность 33 % хранится в цвете инструмента.
    func testAlphaIsPartOfColor() {
        let color = StoryColor(hex: "#0A84FF")!.withAlpha(0.33)
        XCTAssertEqual(color.alpha, 0.33)
        XCTAssertEqual(color.hex, "#0A84FF")
        XCTAssertTrue(color.matches(StoryColor(hex: "#0A84FF")!))
        XCTAssertFalse(color.matches(StoryColor(hex: "#0A84FF")!, includingAlpha: true))
    }

    func testPaletteGrid() {
        let grid = StoryColor.paletteGrid(columns: 12, rows: 10)
        XCTAssertEqual(grid.count, 10)
        XCTAssertTrue(grid.allSatisfy { $0.count == 12 })
        XCTAssertEqual(grid[0][0], .white)
        XCTAssertEqual(grid[0][11], .black)
    }

    func testFilledTextUsesContrastingGlyphs() {
        var payload = StoryTextPayload(text: "А")
        payload.style = .filled
        payload.color = .white
        XCTAssertEqual(payload.glyphColor, .black)
        payload.color = StoryColor(hex: "#0A0A40")!
        XCTAssertEqual(payload.glyphColor, .white)
    }
}

final class StoryDocumentTests: XCTestCase {
    func testCodableRoundTripKeepsEverythingEditable() throws {
        var document = photoDocument()
        var text = StoryTextPayload(text: "Строка 1\nСтрока 2 🎉")
        text.font = .serif
        text.style = .filled
        text.color = StoryColor(hex: "#FFD60A")!
        let textID = document.add(.text(text), center: StoryPoint(x: 0.3, y: 0.7), size: StorySize(width: 0.6, height: 0.2))
        document.update(textID) {
            $0.scale = 1.4
            $0.rotation = 0.3
        }
        document.add(.emoji("🔥"), size: StorySize(width: 0.25, height: 0.25))
        document.add(.shape(StoryShapePayload(shape: .ellipse, color: StoryColor(hex: "#30D158")!.withAlpha(0.5))), size: StorySize(width: 0.4, height: 0.4))
        document.add(.roundVideo(StoryRoundVideoPayload(file: "round.mp4", duration: 7.5, startTime: 1)), size: StorySize(width: 0.45, height: 0.45))
        document.drawing.add(stroke([(0.1, 0.1), (0.2, 0.3)], brush: .neon, color: StoryColor(hex: "#BF5AF2")!))
        document.drawingTool.brush = .marker
        document.adjustments[.brightness] = 25
        document.blur.mode = .linear
        document.curves[.blue].setPoint(1, y: 0.4)
        document.caption = "Подпись"

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let restored = try decoder.decode(StoryDocument.self, from: encoder.encode(document))

        XCTAssertTrue(restored.isSameContent(as: document))
        XCTAssertEqual(restored.entity(textID)?.scale, 1.4)
        XCTAssertEqual(restored.drawingTool.brush, .marker)
        XCTAssertEqual(restored.referencedFiles.sorted(), ["round.mp4", "source.jpg"])
        XCTAssertTrue(restored.producesVideo)
        XCTAssertEqual(restored.duration, 8.5)
    }

    func testEntitiesStayOrderedByZIndex() {
        var document = photoDocument()
        let a = document.add(.emoji("A"), size: StorySize(width: 0.2, height: 0.2))
        let b = document.add(.emoji("B"), size: StorySize(width: 0.2, height: 0.2))
        let snapshot = document
        document.bringToFront(b)
        XCTAssertEqual(document, snapshot, "уже сверху — без изменений")
        document.bringToFront(a)
        XCTAssertEqual(document.entities.last?.id, a)
    }

    func testDuplicateCreatesNewEntityOnTop() throws {
        var document = photoDocument()
        let id = document.add(.emoji("A"), size: StorySize(width: 0.2, height: 0.2))
        let copy = try XCTUnwrap(document.duplicate(id))
        XCTAssertNotEqual(copy, id)
        XCTAssertEqual(document.entities.count, 2)
        XCTAssertEqual(document.entities.last?.id, copy)
    }

    func testFittedRectKeepsAspect() {
        let landscape = StoryCanvasGeometry.fittedRect(for: StorySize(width: 4000, height: 3000))
        XCTAssertEqual(landscape.width, 1)
        XCTAssertEqual(landscape.height * 16 / 9, 0.75, accuracy: 1e-9, "в пикселях холста 4:3")
        XCTAssertEqual(landscape.center.y, 0.5, accuracy: 1e-9)
        let tall = StoryCanvasGeometry.fittedRect(for: StorySize(width: 1000, height: 3000))
        XCTAssertEqual(tall.height, 1)
        XCTAssertTrue(StoryCanvasGeometry.fillsCanvas(StorySize(width: 1080, height: 1920)))
        XCTAssertFalse(StoryCanvasGeometry.fillsCanvas(StorySize(width: 3024, height: 4032)))
    }

    func testRoundVideoScaleRange() {
        let entity = StoryEntity(
            kind: .roundVideo(StoryRoundVideoPayload(file: "r.mp4", duration: 3)),
            center: .center,
            size: StorySize(width: 0.45, height: 0.45)
        )
        XCTAssertFalse(entity.supportsRotation)
        XCTAssertEqual(entity.scaleRange.upperBound * 0.45, 0.9, accuracy: 1e-9)
    }
}

final class StoryDraftStoreTests: XCTestCase {
    private var root: URL!
    private var work: URL!

    override func setUpWithError() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("StoryDraftTests-\(UUID().uuidString)")
        root = base.appendingPathComponent("drafts")
        work = base.appendingPathComponent("work")
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root.deletingLastPathComponent())
    }

    func testSaveOpenListDelete() throws {
        try Data("jpeg".utf8).write(to: work.appendingPathComponent("source.jpg"))
        var document = photoDocument()
        document.add(.text(StoryTextPayload(text: "Черновик")), size: StorySize(width: 0.5, height: 0.1))
        document.drawing.add(stroke([(0.1, 0.1), (0.4, 0.4)]))
        document.drawingTool.color = StoryColor(hex: "#FF453A")!

        let store = StoryDraftStore(root: root)
        let summary = try store.save(document, from: work, thumbnail: Data("thumb".utf8))
        XCTAssertEqual(summary.id, document.id)
        XCTAssertNotNil(summary.thumbnail)
        XCTAssertEqual(store.list().map(\.id), [document.id])

        let reopenedWork = root.deletingLastPathComponent().appendingPathComponent("work2")
        let restored = try store.open(document.id, into: reopenedWork)
        XCTAssertTrue(restored.isSameContent(as: document))
        XCTAssertEqual(restored.drawingTool.color, StoryColor(hex: "#FF453A")!)
        XCTAssertEqual(try Data(contentsOf: reopenedWork.appendingPathComponent("source.jpg")), Data("jpeg".utf8))

        // Повторное сохранение того же черновика заменяет его, а не плодит второй.
        try store.save(restored, from: reopenedWork, thumbnail: nil)
        XCTAssertEqual(store.list().count, 1)

        store.delete(document.id)
        XCTAssertTrue(store.list().isEmpty)
    }

    func testMissingMediaFailsWithoutBreakingOldDraft() throws {
        try Data("jpeg".utf8).write(to: work.appendingPathComponent("source.jpg"))
        let store = StoryDraftStore(root: root)
        var document = photoDocument()
        try store.save(document, from: work, thumbnail: nil)

        document.add(.image(StoryImagePayload(file: "missing.jpg", pixelSize: StorySize(width: 10, height: 10))), size: StorySize(width: 0.3, height: 0.3))
        XCTAssertThrowsError(try store.save(document, from: work, thumbnail: nil)) { error in
            XCTAssertEqual(error as? StoryDraftStore.Failure, .missingFile("missing.jpg"))
        }
        let reopened = try store.open(document.id, into: root.deletingLastPathComponent().appendingPathComponent("w3"))
        XCTAssertTrue(reopened.entities.isEmpty, "прежний черновик цел")
    }
}
