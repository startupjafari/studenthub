import SwiftUI
import XCTest

@testable import StudentHub

/// Пузыри переписки — главный элемент чата — и флаги второй волны, которые их касаются.
///
/// Флаги проверяются не эталоном, а сравнением двух положений в одном прогоне: вид с
/// флагом обязан совпасть с видом без него (кеш раскладки — пиксель в пиксель, плоская
/// тень — в пределах того, что глаз не отличит). Так флаг можно включить, не открывая
/// приложение на телефоне: расхождение роняет тест и прикладывает обе картинки и разницу.
final class MessageBubbleSnapshotTests: SnapshotTestCase {
    private let viewerID = "u-me"

    override func tearDown() {
        PerformanceFlags.overrides = [:]
        super.tearDown()
    }

    // MARK: - Эталон

    func testMessageBubbles() {
        assertSnapshots(of: bubbles, named: "message-bubbles")
    }

    // MARK: - Флаги

    /// Шаг 2.6: кеш замеров `ChatBubbleStack` не меняет ни одного пикселя — во всей матрице
    /// тем, размеров экрана и шрифта.
    func testBubbleLayoutCacheChangesNothing() {
        assertSameRendering(of: .chatBubbleLayoutCache, tolerance: .strict)
    }

    /// Шаг 2.7: плоская тень входящего пузыря на месте размытой. Размытие 0,6 pt даёт
    /// полупрозрачный край в пару пикселей — допуск ровно на него (тень 10 % чёрного, то
    /// есть до 26 единиц канала, и только по нижней кромке пузырей).
    func testFlatShadowLooksLikeBlurredShadow() {
        assertSameRendering(
            of: .chatBubbleFlatShadow,
            tolerance: SnapshotComparison.Tolerance(channel: 26, fraction: 0.002))
    }

    /// Оба флага сразу — то положение, в котором их видит пользователь.
    func testBubbleFlagsTogetherChangeNothingVisible() {
        assertSameRendering(
            of: [.chatBubbleLayoutCache, .chatBubbleFlatShadow],
            tolerance: SnapshotComparison.Tolerance(channel: 26, fraction: 0.002))
    }

    // MARK: - Помощники

    private func assertSameRendering(
        of flags: PerformanceFlags.Switch..., tolerance: SnapshotComparison.Tolerance,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        assertSameRendering(of: flags, tolerance: tolerance, file: file, line: line)
    }

    private func assertSameRendering(
        of flags: [PerformanceFlags.Switch], tolerance: SnapshotComparison.Tolerance,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        for variant in Variant.standard {
            let size = variant.device.size
            PerformanceFlags.overrides = Dictionary(uniqueKeysWithValues: flags.map { ($0, false) })
            let off = render(bubbles, size: size, style: variant.style, category: variant.category)
            PerformanceFlags.overrides = Dictionary(uniqueKeysWithValues: flags.map { ($0, true) })
            let on = render(bubbles, size: size, style: variant.style, category: variant.category)
            PerformanceFlags.overrides = [:]

            XCTAssertFalse(SnapshotComparison.isBlank(on), "пустой снимок \(variant.name)", file: file, line: line)
            let names = flags.map(\.rawValue).joined(separator: "+")
            if let mismatch = SnapshotComparison.compare(reference: off, actual: on, tolerance: tolerance) {
                for (image, label) in [(off, "выкл"), (on, "вкл"), (mismatch.diff, "разница")] {
                    guard let image else { continue }
                    let attachment = XCTAttachment(image: image)
                    attachment.name = "\(names)-\(variant.name)-\(label)"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                }
                XCTFail("\(names) меняет вид пузырей (\(variant.name)): \(mismatch)", file: file, line: line)
            }
        }
    }

    /// Переписка группы: чужие и свои, склейка в группы, имя автора, ответ, правка,
    /// длинный текст с переносами и эмодзи, неотправленное.
    private var bubbles: some View {
        let messages = [
            message("m1", minute: 0, sender: "u-1", name: "Даурен Ахметов", "Привет! Ты сегодня на паре будешь?"),
            message("m2", minute: 1, sender: "u-1", name: "Даурен Ахметов", "Скинь, пожалуйста, методичку по курсовой"),
            message("m3", minute: 2, sender: viewerID, "Да, буду ко второй паре."),
            message("m4", minute: 3, sender: viewerID, "Конечно, вечером отправлю 👍", edited: true),
            message("m5", minute: 9, sender: "u-2", name: "Мария Ким",
                    "Лабораторную по базам данных перенесли на четверг, аудитория 305. Отчёт сдаём до пятницы.",
                    reply: ("m3", "Да, буду ко второй паре.")),
            message("m6", minute: 10, sender: viewerID, "Отлично, успею доделать отчёт.",
                    reply: ("m5", "Лабораторную по базам данных перенесли на четверг")),
            message("m7", minute: 11, sender: viewerID, "Встречаемся в 14:00 у библиотеки?", state: .failed),
        ]
        let items = MessageTimeline.build(from: messages, viewerID: viewerID).flatMap(\.items)
        let context = BubbleContext(isGroup: true, viewerID: viewerID)
        return VStack(spacing: Spacing.xs) {
            ForEach(items) { item in
                MessageBubbleView(item: item, context: context)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.top, Spacing.lg)
        .background(Palette.background)
        .environment(\.viewerID, viewerID)
    }

    /// 10 ноября 2026, 09:41 + `minute` — по часам процесса: время в пузыре не зависит от
    /// дня прогона.
    private func message(
        _ id: String, minute: Int, sender: String, name: String? = nil, _ text: String,
        reply: (id: String, quote: String)? = nil, edited: Bool = false, state: MessageSendState = .sent
    ) -> MessageRecord {
        var components = DateComponents(year: 2026, month: 11, day: 10, hour: 9, minute: 41)
        components.minute = 41 + minute
        let created = Calendar.current.date(from: components) ?? Date(timeIntervalSince1970: 1_794_300_000)
        var record = MessageRecord(
            id: id, remoteId: state == .sent ? id : nil, chatId: "chat-snap", seq: state == .sent ? 1 : nil,
            senderId: sender, content: text, replyToId: reply?.id, replyQuote: reply?.quote, systemType: nil,
            editedAt: edited ? created.addingTimeInterval(60) : nil, deletedAt: nil, pinnedAt: nil,
            createdAt: created, sendState: state)
        record.senderName = name
        return record
    }
}
