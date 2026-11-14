import UIKit

/// Цитата в ответе.
struct ReplyPreview: Hashable {
    var targetId: MessageID
    var authorName: String
    var text: String
    /// Ответ на удалённое: Telegram пишет «Удалённое сообщение».
    var isDeleted: Bool
    var isOutgoingTarget: Bool
    var thumbnailFile: String?
}

struct ReactionChipLayout: Hashable {
    var frame: CGRect
    var emoji: String
    var count: Int
    var isMine: Bool
}

/// Раскладка строки ленты: все рамки посчитаны заранее, ячейка только расставляет виды.
/// Рамки содержимого — в координатах пузыря (`bubbleFrame`), сам пузырь — в координатах ячейки.
struct MessageLayout {
    enum Style: Hashable {
        /// Обычный пузырь.
        case bubble
        /// Без пузыря: крупные эмодзи, кружок.
        case freeform
        /// Служебное сообщение по центру.
        case service
        /// Плашка даты.
        case date
    }

    enum StatusPlacement: Hashable {
        /// Внутри пузыря, справа внизу.
        case inline
        /// Поверх медиа — на тёмной плашке.
        case overlay
        /// Под свободным содержимым — на плашке цвета служебных.
        case pill
    }

    enum Content: Hashable {
        case none
        case media
        case file
        case voice
        case videoNote
    }

    var rowId: RowID
    var width: CGFloat
    var height: CGFloat
    var style: Style
    var isOutgoing = false
    var merge = MergeFlags(top: false, bottom: false)
    var hasTail: Bool { style == .bubble && !merge.bottom }

    var bubbleFrame: CGRect = .zero
    var forwardFrame: CGRect?
    var forwardName: String?
    var replyFrame: CGRect?
    var reply: ReplyPreview?
    var content: Content = .none
    /// Медиа или блок файла/голоса/кружка.
    var contentFrame: CGRect = .zero
    /// Рамки плиток альбома относительно `contentFrame`.
    var mediaTileFrames: [CGRect] = []
    var mediaMessageIds: [MessageID] = []
    /// Углы медиа, которые скругляются радиусом пузыря (сверху нет шапки, снизу нет подписи).
    var mediaRoundsTop = true
    var mediaRoundsBottom = true
    var text: TextLayout?
    var textFrame: CGRect = .zero
    var reactionChips: [ReactionChipLayout] = []
    var statusFrame: CGRect = .zero
    var statusPlacement: StatusPlacement = .inline
    var statusText = ""
    var showsChecks = false
    /// Служебное/дата: текст и плашка.
    var serviceText = ""
    var servicePillFrame: CGRect = .zero
    var serviceTextLayout: TextLayout?
}

/// Константы раскладки. Подобраны по снимкам Telegram iOS на 393 pt (iPhone 15/16/17).
enum BubbleMetrics {
    static let tailWidth: CGFloat = 6
    /// От края экрана до тела пузыря со стороны хвоста.
    static let edgeInset: CGFloat = 12
    /// Минимальный зазор с противоположной стороны.
    static let farGap: CGFloat = 50
    static let cornerRadius: CGFloat = 17
    static let mergedCornerRadius: CGFloat = 6
    static let textInsets = UIEdgeInsets(top: 6.5, left: 11, bottom: 6.5, right: 11)
    static let mediaInset: CGFloat = 2
    static let spacing: CGFloat = 4
    static let mergedSpacing: CGFloat = 1
    static let statusHeight: CGFloat = 14
    static let checksWidth: CGFloat = 17
    static let replyHeight: CGFloat = 40
    static let forwardHeight: CGFloat = 36
    static let fileHeight: CGFloat = 46
    static let voiceHeight: CGFloat = 44
    static let reactionHeight: CGFloat = 28
    static let reactionSpacing: CGFloat = 6
    static let datePillHeight: CGFloat = 22
    static let videoNoteDiameter: CGFloat = 220

    static func maxBubbleWidth(_ width: CGFloat) -> CGFloat { max(160, width - edgeInset - farGap) }
    static func maxMediaWidth(_ width: CGFloat) -> CGFloat { min(floor(width * 0.72), 300) }
}

enum MessageLayoutEngine {
    /// Время в статусе: «12:45».
    static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.setLocalizedDateFormatFromTemplate("d MMMM")
        return formatter
    }()

    static let dayYearFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.setLocalizedDateFormatFromTemplate("d MMMM yyyy")
        return formatter
    }()

    static func dayTitle(_ date: Date, now: Date = Date()) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Сегодня" }
        if calendar.isDateInYesterday(date) { return "Вчера" }
        if calendar.component(.year, from: date) == calendar.component(.year, from: now) {
            return dayFormatter.string(from: date)
        }
        return dayYearFormatter.string(from: date)
    }

    static func statusText(for message: Message) -> String {
        let time = timeFormatter.string(from: message.date)
        return message.editedAt != nil ? "изменено \(time)" : time
    }

    /// Крупные эмодзи без пузыря: 1–3 эмодзи и ничего больше.
    static func emojiOnlyCount(_ text: String) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 3 else { return nil }
        for character in trimmed {
            guard character.unicodeScalars.contains(where: { $0.properties.isEmojiPresentation })
                || (character.unicodeScalars.first?.properties.isEmoji == true && character.unicodeScalars.count > 1)
            else { return nil }
        }
        return trimmed.count
    }

    static func textSize(_ string: String, font: UIFont) -> CGSize {
        let size = (string as NSString).size(withAttributes: [.font: font])
        return CGSize(width: ceil(size.width), height: ceil(size.height))
    }

    // MARK: Строка

    static func layout(row: ChatRow, width: CGFloat, replyLookup: (MessageID) -> ReplyPreview?) -> MessageLayout {
        switch row.kind {
        case let .date(day):
            return dateLayout(id: row.id, day: day, width: width)
        case let .messages(messages):
            guard let primary = messages.last else {
                return MessageLayout(rowId: row.id, width: width, height: 1, style: .date)
            }
            if primary.isService {
                return serviceLayout(id: row.id, message: primary, width: width)
            }
            return messageLayout(row: row, messages: messages, width: width, replyLookup: replyLookup)
        }
    }

    static func dateLayout(id: RowID, day: Date, width: CGFloat) -> MessageLayout {
        var layout = MessageLayout(rowId: id, width: width, height: 6 + BubbleMetrics.datePillHeight + 6, style: .date)
        layout.serviceText = dayTitle(day)
        let textWidth = textSize(layout.serviceText, font: Fonts.service).width
        let pillWidth = textWidth + 20
        layout.servicePillFrame = CGRect(x: floor((width - pillWidth) / 2), y: 6, width: pillWidth, height: BubbleMetrics.datePillHeight)
        return layout
    }

    static func serviceLayout(id: RowID, message: Message, width: CGFloat) -> MessageLayout {
        let text = TextLayout.make(message.text, font: Fonts.service, maxWidth: width - 100, detectLinks: false)
        let pill = CGSize(width: text.size.width + 20, height: text.size.height + 8)
        var layout = MessageLayout(rowId: id, width: width, height: pill.height + 12, style: .service)
        layout.serviceText = message.text
        layout.serviceTextLayout = text
        layout.servicePillFrame = CGRect(x: floor((width - pill.width) / 2), y: 6, width: pill.width, height: pill.height)
        layout.textFrame = CGRect(x: 10, y: 4, width: text.size.width, height: text.size.height)
        return layout
    }

    // MARK: Сообщение

    static func messageLayout(
        row: ChatRow, messages: [Message], width: CGFloat, replyLookup: (MessageID) -> ReplyPreview?
    ) -> MessageLayout {
        let primary = messages.last!
        let first = messages.first!
        var layout = MessageLayout(rowId: row.id, width: width, height: 0, style: .bubble)
        layout.isOutgoing = primary.isOutgoing
        layout.merge = row.merge
        layout.statusText = statusText(for: primary)
        layout.showsChecks = primary.isOutgoing

        let insets = BubbleMetrics.textInsets
        let maxBubble = BubbleMetrics.maxBubbleWidth(width)
        let maxText = maxBubble - insets.left - insets.right
        let timeWidth = textSize(layout.statusText, font: Fonts.time).width
        let statusWidth = timeWidth + (primary.isOutgoing ? BubbleMetrics.checksWidth + 2 : 0)

        // Свободные стили: кружок и крупные эмодзи.
        if case .videoNote = primary.kind, first.forward == nil {
            return freeformLayout(layout: layout, message: primary, contentSize: CGSize(width: BubbleMetrics.videoNoteDiameter, height: BubbleMetrics.videoNoteDiameter), content: .videoNote, statusWidth: statusWidth, reply: first.replyTo.flatMap(replyLookup))
        }
        if case .text = primary.kind, first.forward == nil, first.replyTo == nil, let count = emojiOnlyCount(primary.text) {
            let size: CGFloat = count == 1 ? 56 : (count == 2 ? 48 : 42)
            let text = TextLayout.make(primary.text, font: .systemFont(ofSize: size), maxWidth: maxBubble, detectLinks: false)
            var freeform = freeformLayout(layout: layout, message: primary, contentSize: text.size, content: .none, statusWidth: statusWidth, reply: nil)
            freeform.text = text
            freeform.textFrame = freeform.contentFrame
            return freeform
        }

        var contentWidth: CGFloat = 0
        var y: CGFloat = 0
        var headerHeight: CGFloat = 0

        // Шапка «Переслано от».
        if let forward = first.forward {
            layout.forwardName = forward.authorName
            let nameWidth = textSize(forward.authorName, font: Fonts.replyName).width
            let labelWidth = textSize("Переслано от", font: Fonts.replyText).width
            contentWidth = max(contentWidth, min(maxText, max(nameWidth, labelWidth)))
            layout.forwardFrame = CGRect(x: insets.left, y: 6, width: 0, height: BubbleMetrics.forwardHeight)
            headerHeight = 6 + BubbleMetrics.forwardHeight
        }

        // Цитата ответа.
        if let replyId = first.replyTo {
            let preview = replyLookup(replyId) ?? ReplyPreview(
                targetId: replyId, authorName: "", text: "Удалённое сообщение", isDeleted: true, isOutgoingTarget: false, thumbnailFile: nil
            )
            layout.reply = preview
            let nameWidth = textSize(preview.authorName, font: Fonts.replyName).width
            let quoteWidth = textSize(String(preview.text.prefix(80)), font: Fonts.replyText).width
            let thumb: CGFloat = preview.thumbnailFile != nil ? 36 : 0
            let replyWidth = min(maxText, max(nameWidth, quoteWidth) + 18 + thumb)
            contentWidth = max(contentWidth, max(replyWidth, 80))
            layout.replyFrame = CGRect(x: insets.left - 2, y: headerHeight + 6, width: 0, height: BubbleMetrics.replyHeight)
            headerHeight += 6 + BubbleMetrics.replyHeight
        }
        y = headerHeight

        let caption = primary.text
        var mediaWidth: CGFloat = 0
        var contentBlockHeight: CGFloat = 0
        var mediaBottom = false

        switch primary.kind {
        case .photo, .video, .gif:
            layout.content = .media
            let mosaic = mosaicLayout(messages: messages, maxWidth: BubbleMetrics.maxMediaWidth(width))
            layout.mediaTileFrames = mosaic.tiles
            layout.mediaMessageIds = messages.map(\.id)
            mediaWidth = mosaic.size.width
            contentBlockHeight = mosaic.size.height
            let top = headerHeight > 0 ? y + 6 : BubbleMetrics.mediaInset
            layout.contentFrame = CGRect(x: BubbleMetrics.mediaInset, y: top, width: mosaic.size.width, height: mosaic.size.height)
            layout.mediaRoundsTop = headerHeight == 0
            y = top + mosaic.size.height
            mediaBottom = true
        case let .file(media):
            layout.content = .file
            let name = media.fileName ?? "Файл"
            let nameWidth = textSize(name, font: Fonts.fileName).width
            let sizeWidth = textSize(formatFileSize(media.fileSize ?? 0), font: Fonts.fileSize).width
            let blockWidth = min(maxText, max(200, 46 + 10 + max(nameWidth, sizeWidth + statusWidth + 12)))
            contentWidth = max(contentWidth, blockWidth)
            layout.contentFrame = CGRect(x: insets.left, y: y + 8, width: blockWidth, height: BubbleMetrics.fileHeight)
            y += 8 + BubbleMetrics.fileHeight
        case let .voice(media):
            layout.content = .voice
            let waveWidth = min(190, max(110, 80 + CGFloat(media.duration) * 3))
            let blockWidth = 44 + 10 + waveWidth
            contentWidth = max(contentWidth, blockWidth)
            layout.contentFrame = CGRect(x: insets.left - 2, y: y + 7, width: blockWidth, height: BubbleMetrics.voiceHeight)
            y += 7 + BubbleMetrics.voiceHeight
        case .videoNote:
            // Пересланный кружок — в пузыре (редкий случай).
            layout.content = .videoNote
            let diameter: CGFloat = 180
            contentWidth = max(contentWidth, diameter)
            layout.contentFrame = CGRect(x: insets.left, y: y + 6, width: diameter, height: diameter)
            y += 6 + diameter
        case .text, .service:
            break
        }

        // Текст или подпись.
        var statusOnOwnLine = false
        if !caption.isEmpty {
            let textMax = layout.content == .media ? max(80, mediaWidth + 2 * BubbleMetrics.mediaInset - insets.left - insets.right) : maxText
            let text = TextLayout.make(caption, font: Fonts.message, maxWidth: textMax)
            layout.text = text
            let top = y + (y > 0 ? (layout.content == .media ? 5 : 4) : insets.top)
            layout.textFrame = CGRect(x: insets.left, y: top, width: text.size.width, height: text.size.height)
            var widthForText = text.size.width
            if primary.reactions.isEmpty {
                if text.lastLineWidth + 8 + statusWidth <= textMax {
                    widthForText = max(text.size.width, text.lastLineWidth + 8 + statusWidth)
                } else {
                    statusOnOwnLine = true
                    widthForText = max(text.size.width, statusWidth)
                }
            }
            contentWidth = max(contentWidth, widthForText)
            y = top + text.size.height + (statusOnOwnLine ? BubbleMetrics.statusHeight + 2 : 0)
            mediaBottom = false
        }

        // Ширина пузыря.
        var bubbleWidth: CGFloat
        if layout.content == .media {
            bubbleWidth = mediaWidth + 2 * BubbleMetrics.mediaInset
            contentWidth = bubbleWidth - insets.left - insets.right
        } else {
            if layout.content == .none, caption.isEmpty { contentWidth = max(contentWidth, statusWidth) }
            if layout.content == .file || layout.content == .voice { contentWidth = max(contentWidth, layout.contentFrame.width) }
            bubbleWidth = min(maxBubble, contentWidth + insets.left + insets.right)
            bubbleWidth = max(bubbleWidth, statusWidth + insets.left + insets.right)
        }

        // Реакции — под содержимым внутри пузыря; время встаёт справа от последнего ряда.
        if !primary.reactions.isEmpty {
            let chips = reactionChips(primary.reactions, maxWidth: max(contentWidth, bubbleWidth - insets.left - insets.right), statusWidth: statusWidth)
            let top = y + 6
            layout.reactionChips = chips.chips.map { chip in
                var chip = chip
                chip.frame.origin.x += insets.left
                chip.frame.origin.y += top
                return chip
            }
            bubbleWidth = min(maxBubble, max(bubbleWidth, chips.width + insets.left + insets.right))
            y = top + chips.height + (chips.statusFits ? 0 : BubbleMetrics.statusHeight + 2)
            mediaBottom = false
            statusOnOwnLine = !chips.statusFits
        }

        // Блок голоса/файла: время в строке длительности/размера.
        var bubbleHeight: CGFloat
        if mediaBottom {
            bubbleHeight = y + BubbleMetrics.mediaInset
            layout.statusPlacement = .overlay
        } else if caption.isEmpty, primary.reactions.isEmpty, layout.content == .voice || layout.content == .file {
            bubbleHeight = y + 6
            layout.statusPlacement = .inline
        } else if caption.isEmpty, primary.reactions.isEmpty {
            bubbleHeight = max(y + insets.bottom, 34)
        } else {
            bubbleHeight = y + insets.bottom
        }
        layout.mediaRoundsBottom = mediaBottom

        // Рамки шапок теперь, когда ширина известна.
        let innerWidth = bubbleWidth - insets.left - insets.right
        if var frame = layout.forwardFrame {
            frame.size.width = innerWidth
            layout.forwardFrame = frame
        }
        if var frame = layout.replyFrame {
            frame.size.width = bubbleWidth - frame.minX - (insets.right - 2)
            layout.replyFrame = frame
        }

        // Статус.
        let statusSize = CGSize(width: statusWidth, height: BubbleMetrics.statusHeight)
        switch layout.statusPlacement {
        case .overlay:
            let pill = CGSize(width: statusSize.width + 12, height: 18)
            layout.statusFrame = CGRect(
                x: layout.contentFrame.maxX - pill.width - 6, y: layout.contentFrame.maxY - pill.height - 6,
                width: pill.width, height: pill.height
            )
        default:
            layout.statusFrame = CGRect(
                x: bubbleWidth - insets.right - statusSize.width + 2, y: bubbleHeight - statusSize.height - 5,
                width: statusSize.width, height: statusSize.height
            )
        }

        // Пузырь в ячейке.
        let topSpacing = row.merge.top ? BubbleMetrics.mergedSpacing : BubbleMetrics.spacing
        let bottomSpacing = row.merge.bottom ? BubbleMetrics.mergedSpacing : BubbleMetrics.spacing
        let x = primary.isOutgoing ? width - BubbleMetrics.edgeInset - bubbleWidth : BubbleMetrics.edgeInset
        layout.bubbleFrame = CGRect(x: x, y: topSpacing, width: bubbleWidth, height: ceil(bubbleHeight))
        layout.height = ceil(topSpacing + bubbleHeight + bottomSpacing)
        return layout
    }

    static func freeformLayout(
        layout base: MessageLayout, message: Message, contentSize: CGSize, content: MessageLayout.Content,
        statusWidth: CGFloat, reply: ReplyPreview?
    ) -> MessageLayout {
        var layout = base
        layout.style = .freeform
        layout.content = content
        layout.statusPlacement = .pill
        var y: CGFloat = 0
        var blockWidth = contentSize.width
        if let reply {
            layout.reply = reply
            layout.replyFrame = CGRect(x: 0, y: 0, width: min(220, max(140, contentSize.width)), height: BubbleMetrics.replyHeight)
            y = BubbleMetrics.replyHeight + 6
            blockWidth = max(blockWidth, layout.replyFrame!.width)
        }
        layout.contentFrame = CGRect(x: message.isOutgoing ? blockWidth - contentSize.width : 0, y: y, width: contentSize.width, height: contentSize.height)
        y += contentSize.height
        if !message.reactions.isEmpty {
            let chips = reactionChips(message.reactions, maxWidth: 240, statusWidth: 0)
            layout.reactionChips = chips.chips.map { chip in
                var chip = chip
                chip.frame.origin.y += y + 4
                if message.isOutgoing { chip.frame.origin.x += blockWidth - chips.width }
                return chip
            }
            y += 4 + chips.height
        }
        let pill = CGSize(width: statusWidth + 12, height: 18)
        layout.statusFrame = CGRect(x: message.isOutgoing ? blockWidth - pill.width : layout.contentFrame.maxX - pill.width, y: y + 3, width: pill.width, height: pill.height)
        y += 3 + pill.height
        let topSpacing = base.merge.top ? BubbleMetrics.mergedSpacing : BubbleMetrics.spacing
        let bottomSpacing = base.merge.bottom ? BubbleMetrics.mergedSpacing : BubbleMetrics.spacing
        let x = message.isOutgoing ? base.width - BubbleMetrics.edgeInset - blockWidth : BubbleMetrics.edgeInset
        layout.bubbleFrame = CGRect(x: x, y: topSpacing, width: blockWidth, height: y)
        layout.height = ceil(topSpacing + y + bottomSpacing + 2)
        return layout
    }

    // MARK: Реакции

    static func reactionChipWidth(_ reaction: MessageReaction) -> CGFloat {
        reaction.count > 1 ? 58 : 44
    }

    static func reactionChips(_ reactions: [MessageReaction], maxWidth: CGFloat, statusWidth: CGFloat)
        -> (chips: [ReactionChipLayout], width: CGFloat, height: CGFloat, statusFits: Bool)
    {
        var chips: [ReactionChipLayout] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var widest: CGFloat = 0
        for reaction in reactions {
            let chipWidth = reactionChipWidth(reaction)
            if x > 0, x + chipWidth > maxWidth {
                x = 0
                y += BubbleMetrics.reactionHeight + BubbleMetrics.reactionSpacing
            }
            chips.append(ReactionChipLayout(
                frame: CGRect(x: x, y: y, width: chipWidth, height: BubbleMetrics.reactionHeight),
                emoji: reaction.emoji, count: reaction.count, isMine: reaction.byMe
            ))
            x += chipWidth + BubbleMetrics.reactionSpacing
            widest = max(widest, x - BubbleMetrics.reactionSpacing)
        }
        let lastRowEnd = x - BubbleMetrics.reactionSpacing
        let statusFits = statusWidth == 0 || lastRowEnd + 10 + statusWidth <= maxWidth
        let width = statusFits && statusWidth > 0 ? max(widest, lastRowEnd + 10 + statusWidth) : max(widest, statusWidth)
        return (chips, width, y + BubbleMetrics.reactionHeight, statusFits)
    }

    // MARK: Альбом

    /// Мозаика альбома: строки «по ширине» (justified), как у Telegram — плитки в строке одной
    /// высоты, строки заполняют ширину. Для 2–3 элементов — особые раскладки.
    static func mosaicLayout(messages: [Message], maxWidth: CGFloat) -> (tiles: [CGRect], size: CGSize) {
        let spacing: CGFloat = 2
        let ratios: [CGFloat] = messages.map { message in
            let ratio = message.kind.media?.aspectRatio ?? 1
            return min(2.2, max(0.5, ratio))
        }
        if ratios.count == 1 {
            let ratio = ratios[0]
            var width = maxWidth
            var height = width / ratio
            let maxHeight = maxWidth * 1.3
            if height > maxHeight {
                height = maxHeight
                width = max(150, height * ratio)
            }
            height = max(110, height)
            return ([CGRect(x: 0, y: 0, width: floor(width), height: floor(height))], CGSize(width: floor(width), height: floor(height)))
        }
        // Три: портретная первая — большая слева, две справа друг над другом.
        if ratios.count == 3, ratios[0] < 0.9 {
            let height = min(maxWidth * 1.1, 340)
            let rightWidth = floor(maxWidth * 0.42)
            let leftWidth = maxWidth - rightWidth - spacing
            let half = floor((height - spacing) / 2)
            return ([
                CGRect(x: 0, y: 0, width: leftWidth, height: height),
                CGRect(x: leftWidth + spacing, y: 0, width: rightWidth, height: half),
                CGRect(x: leftWidth + spacing, y: half + spacing, width: rightWidth, height: height - half - spacing),
            ], CGSize(width: maxWidth, height: height))
        }
        let partitions: [Int: [Int]] = [
            2: ratios.allSatisfy({ $0 > 1.3 }) ? [1, 1] : [2],
            3: [1, 2], 4: ratios[0] > 1.3 ? [1, 3] : [2, 2], 5: [2, 3], 6: [3, 3], 7: [2, 2, 3], 8: [2, 3, 3],
            9: [3, 3, 3], 10: [2, 3, 2, 3],
        ]
        let rows = partitions[ratios.count] ?? [ratios.count]
        var tiles: [CGRect] = []
        var y: CGFloat = 0
        var cursor = 0
        for count in rows {
            let rowRatios = Array(ratios[cursor..<min(ratios.count, cursor + count)])
            let available = maxWidth - spacing * CGFloat(rowRatios.count - 1)
            var height = floor(available / rowRatios.reduce(0, +))
            height = min(max(height, 70), count == 1 ? maxWidth * 0.75 : maxWidth)
            var x: CGFloat = 0
            for (offset, ratio) in rowRatios.enumerated() {
                let isLast = offset == rowRatios.count - 1
                let tileWidth = isLast ? maxWidth - x : floor(available * ratio / rowRatios.reduce(0, +))
                tiles.append(CGRect(x: x, y: y, width: tileWidth, height: height))
                x += tileWidth + spacing
            }
            y += height + spacing
            cursor += count
        }
        return (tiles, CGSize(width: maxWidth, height: y - spacing))
    }

    static func formatFileSize(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        formatter.allowedUnits = [.useKB, .useMB, .useGB]
        return formatter.string(fromByteCount: bytes)
    }

    static func formatDuration(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded()))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}
