import UIKit

/// Раскладка ленты переписки, как в Telegram: столбец сообщений по дням, дата дня
/// прилипает к верху, пока листаешь этот день.
///
/// Чем отличается от системного списка. Список раскладывал все ячейки по одной оценке
/// высоты и досчитывал их на экране — при прокрутке вверх каждая новая ячейка меняла
/// высоту над видимой областью, и лента дёргалась. Здесь высота каждого сообщения
/// берётся из `MessageHeightCache` (точная, если сообщение уже показывали) или из оценки
/// по содержимому, а когда ячейка досчитывает себя, сдвиг гасится смещением прокрутки:
/// всё, что выше видимого, растёт вверх, а видимое стоит на месте. У нижнего края лента
/// держится за низ — как переписка в Telegram.
final class MessageTimelineLayout: UICollectionViewLayout {
    /// Что лента знает о сообщениях: id по позиции, высота (точная или оценка) и куда
    /// записать замер.
    struct Source {
        var itemID: (IndexPath) -> String?
        var height: (String) -> CGFloat
        var didMeasure: (String, CGFloat) -> Void
    }

    final class Invalidation: UICollectionViewLayoutInvalidationContext {
        /// Геометрия уже поправлена на месте — полная пересборка не нужна.
        var keepsGeometry = false
    }

    var source: Source?

    /// Высота даты дня — по размеру шрифта, без замера: заголовок прилипает и
    /// перекладывается на каждом кадре прокрутки, и замер SwiftUI-вида каждый кадр
    /// тормозил ленту.
    private var headerHeight: CGFloat = MessageTimelineLayout.dayHeaderHeight()

    static func dayHeaderHeight() -> CGFloat {
        // Капсула: строка `footnote` и поля 4 + 4, вокруг — по 6 сверху и снизу.
        let line = UIFont.preferredFont(forTextStyle: .footnote).lineHeight
        return (line + 8 + 12).rounded(.up)
    }
    private var sectionTops: [CGFloat] = []
    private var itemFrames: [[CGRect]] = []
    private var contentHeight: CGFloat = 0
    private var width: CGFloat = 0
    private var needsRebuild = true

    private static let headerKind = UICollectionView.elementKindSectionHeader

    override class var invalidationContextClass: AnyClass { Invalidation.self }

    override var collectionViewContentSize: CGSize {
        CGSize(width: width, height: contentHeight)
    }

    /// Пересобрать всё по высотам из источника: сменился размер шрифта или правила.
    func rebuildAll() {
        headerHeight = Self.dayHeaderHeight()
        needsRebuild = true
        invalidateLayout()
    }

    /// Сменились отступы ленты (клавиатура, плашка закреплённого) — прилипшая дата
    /// встаёт к новому верху. Без этого она оставалась на прежнем месте посреди экрана,
    /// поверх пузырей.
    func invalidatePinnedHeaders() {
        guard let collectionView else { return }
        let headers = (layoutAttributesForElements(in: collectionView.bounds) ?? [])
            .filter { $0.representedElementCategory == .supplementaryView }
            .map(\.indexPath)
        guard !headers.isEmpty else { return }
        let context = Invalidation()
        context.keepsGeometry = true
        context.invalidateSupplementaryElements(ofKind: Self.headerKind, at: headers)
        invalidateLayout(with: context)
    }

    override func prepare() {
        super.prepare()
        guard let collectionView else { return }
        let currentWidth = collectionView.bounds.width
        if abs(currentWidth - width) > 0.5 {
            width = currentWidth
            needsRebuild = true
        }
        guard needsRebuild else { return }
        needsRebuild = false
        rebuild(collectionView)
    }

    private func rebuild(_ collectionView: UICollectionView) {
        var y: CGFloat = 0
        let sections = collectionView.numberOfSections
        sectionTops = []
        sectionTops.reserveCapacity(sections)
        itemFrames = []
        itemFrames.reserveCapacity(sections)
        for section in 0..<sections {
            sectionTops.append(y)
            y += headerHeight
            let count = collectionView.numberOfItems(inSection: section)
            var frames: [CGRect] = []
            frames.reserveCapacity(count)
            for item in 0..<count {
                let indexPath = IndexPath(item: item, section: section)
                let height = source?.itemID(indexPath).flatMap { id in source?.height(id) } ?? 60
                frames.append(CGRect(x: 0, y: y, width: width, height: height))
                y += height
            }
            itemFrames.append(frames)
        }
        contentHeight = y
    }

    override func invalidateLayout(with context: UICollectionViewLayoutInvalidationContext) {
        let keeps = (context as? Invalidation)?.keepsGeometry ?? false
        if !keeps, context.invalidateEverything || context.invalidateDataSourceCounts {
            needsRebuild = true
        }
        super.invalidateLayout(with: context)
    }

    // MARK: Атрибуты

    private func sectionBottom(_ section: Int) -> CGFloat {
        itemFrames[section].last?.maxY ?? (sectionTops[section] + headerHeight)
    }

    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        var result: [UICollectionViewLayoutAttributes] = []
        for section in sectionTops.indices {
            let top = sectionTops[section]
            let bottom = sectionBottom(section)
            guard bottom > rect.minY else { continue }
            if top >= rect.maxY { break }
            if let header = headerAttributes(section: section) { result.append(header) }
            let frames = itemFrames[section]
            var index = firstIndex(in: frames, below: rect.minY)
            while index < frames.count, frames[index].minY < rect.maxY {
                result.append(itemAttributes(IndexPath(item: index, section: section)))
                index += 1
            }
        }
        return result
    }

    /// Первая ячейка, чей низ ниже `y` — двоичным поиском: дней и сообщений тысячи.
    private func firstIndex(in frames: [CGRect], below y: CGFloat) -> Int {
        var low = 0
        var high = frames.count
        while low < high {
            let mid = (low + high) / 2
            if frames[mid].maxY <= y { low = mid + 1 } else { high = mid }
        }
        return low
    }

    private func itemAttributes(_ indexPath: IndexPath) -> UICollectionViewLayoutAttributes {
        let attributes = UICollectionViewLayoutAttributes(forCellWith: indexPath)
        attributes.frame = itemFrames[indexPath.section][indexPath.item]
        return attributes
    }

    /// Дата дня: на своём месте над первым сообщением дня, а пока листаешь этот день —
    /// прилипает к верху видимого, уступая место дате следующего дня.
    private func headerAttributes(section: Int) -> UICollectionViewLayoutAttributes? {
        guard sectionTops.indices.contains(section) else { return nil }
        let attributes = UICollectionViewLayoutAttributes(
            forSupplementaryViewOfKind: Self.headerKind,
            with: IndexPath(item: 0, section: section)
        )
        let top = sectionTops[section]
        var y = top
        if let collectionView {
            let pinned = collectionView.contentOffset.y + collectionView.adjustedContentInset.top
            y = min(max(top, pinned), sectionBottom(section) - headerHeight)
            y = max(y, top)
        }
        attributes.frame = CGRect(x: 0, y: y, width: width, height: headerHeight)
        attributes.zIndex = 2
        return attributes
    }

    override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        guard itemFrames.indices.contains(indexPath.section),
            itemFrames[indexPath.section].indices.contains(indexPath.item)
        else { return nil }
        return itemAttributes(indexPath)
    }

    override func layoutAttributesForSupplementaryView(
        ofKind elementKind: String,
        at indexPath: IndexPath
    ) -> UICollectionViewLayoutAttributes? {
        guard elementKind == Self.headerKind else { return nil }
        return headerAttributes(section: indexPath.section)
    }

    // MARK: Прилипшая дата

    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool {
        true
    }

    override func invalidationContext(forBoundsChange newBounds: CGRect) -> UICollectionViewLayoutInvalidationContext {
        let context = Invalidation()
        // Сменилась ширина (поворот) — всё заново; иначе двигаются только даты.
        if let collectionView, abs(newBounds.width - collectionView.bounds.width) > 0.5 {
            needsRebuild = true
            return context
        }
        context.keepsGeometry = true
        // Только даты видимых дней — без сборки атрибутов всех видимых ячеек.
        var headers: [IndexPath] = []
        for section in sectionTops.indices {
            guard sectionBottom(section) > newBounds.minY else { continue }
            if sectionTops[section] >= newBounds.maxY { break }
            headers.append(IndexPath(item: 0, section: section))
        }
        if !headers.isEmpty {
            context.invalidateSupplementaryElements(ofKind: Self.headerKind, at: headers)
        }
        return context
    }

    // MARK: Досчёт высоты

    override func shouldInvalidateLayout(
        forPreferredLayoutAttributes preferred: UICollectionViewLayoutAttributes,
        withOriginalAttributes original: UICollectionViewLayoutAttributes
    ) -> Bool {
        // Ленту ещё не разложили по ширине — замер по нулевой ширине бессмыслен. Дата
        // дня не досчитывается: её высота известна заранее.
        guard width > 1, original.representedElementCategory == .cell else { return false }
        if original.representedElementCategory == .cell,
            let id = source?.itemID(original.indexPath)
        {
            source?.didMeasure(id, preferred.size.height)
        }
        return abs(preferred.size.height - original.size.height) > 0.5
    }

    override func invalidationContext(
        forPreferredLayoutAttributes preferred: UICollectionViewLayoutAttributes,
        withOriginalAttributes original: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutInvalidationContext {
        let context = super.invalidationContext(forPreferredLayoutAttributes: preferred, withOriginalAttributes: original)
        fill(context, resizing: original.indexPath, to: preferred.size.height, originalFrame: original.frame)
        return context
    }

    /// Высота ячейки сменилась вне досчёта (правка, реакция): поправить раскладку так же.
    func resize(_ indexPath: IndexPath, to height: CGFloat) {
        guard itemFrames.indices.contains(indexPath.section),
            itemFrames[indexPath.section].indices.contains(indexPath.item)
        else { return }
        let frame = itemFrames[indexPath.section][indexPath.item]
        guard abs(frame.height - height) > 0.5 else { return }
        let context = Invalidation()
        context.invalidateItems(at: [indexPath])
        fill(context, resizing: indexPath, to: height, originalFrame: frame)
        invalidateLayout(with: context)
    }

    /// Поменять высоту ячейки на месте и решить, куда уйдёт разница: выше видимого и у
    /// нижнего края — смещением прокрутки (видимое не двигается), иначе — вниз.
    private func fill(
        _ context: UICollectionViewLayoutInvalidationContext,
        resizing indexPath: IndexPath,
        to height: CGFloat,
        originalFrame: CGRect
    ) {
        guard let collectionView,
            itemFrames.indices.contains(indexPath.section),
            itemFrames[indexPath.section].indices.contains(indexPath.item)
        else { return }
        let inset = collectionView.adjustedContentInset
        let visibleTop = collectionView.contentOffset.y + inset.top
        let maxOffset = max(-inset.top, contentHeight - collectionView.bounds.height + inset.bottom)
        let atBottom = collectionView.contentOffset.y >= maxOffset - 1
            && contentHeight + inset.top + inset.bottom > collectionView.bounds.height

        let delta = setHeight(height, at: indexPath)
        guard abs(delta) > 0.01 else { return }
        (context as? Invalidation)?.keepsGeometry = true
        context.contentSizeAdjustment = CGSize(width: 0, height: delta)
        if originalFrame.minY < visibleTop - 0.5 || atBottom {
            context.contentOffsetAdjustment = CGPoint(x: 0, y: delta)
        }
    }

    /// Новая высота ячейки; всё ниже неё сдвигается. Возвращает разницу.
    private func setHeight(_ height: CGFloat, at indexPath: IndexPath) -> CGFloat {
        let section = indexPath.section
        let item = indexPath.item
        let delta = height - itemFrames[section][item].height
        guard abs(delta) > 0.01 else { return 0 }
        itemFrames[section][item].size.height = height
        for index in (item + 1)..<itemFrames[section].count {
            itemFrames[section][index].origin.y += delta
        }
        for next in (section + 1)..<itemFrames.count {
            sectionTops[next] += delta
            for index in itemFrames[next].indices {
                itemFrames[next][index].origin.y += delta
            }
        }
        contentHeight += delta
        return delta
    }
}

/// Ячейка ленты, которая сама меряет свою высоту по ширине ленты: SwiftUI-пузырь внутри
/// (`UIHostingConfiguration`) знает её только после раскладки.
///
/// Замер дорогой (раскладка SwiftUI), поэтому запоминается до смены содержимого или
/// ширины: UIKit спрашивает высоту при каждом обновлении атрибутов, и без этого лента
/// перемеряла видимые пузыри на ходу прокрутки.
class SelfSizingTimelineCell: UICollectionViewCell {
    private var measured: (width: CGFloat, height: CGFloat)?

    /// Содержимое сменилось — прежний замер недействителен.
    func invalidateMeasurement() {
        measured = nil
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        measured = nil
    }

    override func preferredLayoutAttributesFitting(
        _ layoutAttributes: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutAttributes {
        guard let attributes = layoutAttributes.copy() as? UICollectionViewLayoutAttributes else {
            return layoutAttributes
        }
        attributes.size.height = fittingHeight(width: layoutAttributes.size.width)
        return attributes
    }

    func fittingHeight(width: CGFloat) -> CGFloat {
        if let measured, abs(measured.width - width) < 0.5 { return measured.height }
        let size = contentView.systemLayoutSizeFitting(
            CGSize(width: width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
        let height = size.height.rounded(.up)
        measured = (width, height)
        return height
    }
}

final class MessageTimelineCell: SelfSizingTimelineCell {}

/// Дата дня: высота известна заранее (`MessageTimelineLayout.dayHeaderHeight`), замера нет.
final class DayHeaderCell: UICollectionViewCell {
    override func preferredLayoutAttributesFitting(
        _ layoutAttributes: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutAttributes {
        layoutAttributes
    }
}
