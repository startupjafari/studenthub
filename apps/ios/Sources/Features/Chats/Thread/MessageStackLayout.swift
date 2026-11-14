import UIKit

/// Своя раскладка ленты с кешем высот (шаг 2.5 плана аудита, флаг `chatHeightCache`).
///
/// Список `UICollectionViewCompositionalLayout` знает высоту ячейки только после показа и
/// до того считает каждую строку в 44 pt — отсюда прыжки при прокрутке вверх и цепочка
/// компенсаций в `MessageListViewController`. Здесь высота строки известна заранее: из
/// кеша замеров (`MessageHeightCache`, ключ — содержимое, ширина, шрифт), а для ни разу
/// не показанной — из оценки по тексту и вложениям. Ячейка всё равно меряет себя
/// (`UIHostingConfiguration`), но разница теперь — единицы точек и только один раз.
///
/// Геометрия — `MessageStackGeometry`, проверенная тестами; здесь только мост к UIKit.
final class MessageStackLayout: UICollectionViewLayout {
    /// Ключ замера строки; `nil` — строки нет (лента уже другая).
    var key: (IndexPath, CGFloat) -> MessageHeightKey? = { _, _ in nil }
    /// Оценка высоты ни разу не показанной строки.
    var estimate: (IndexPath, CGFloat) -> CGFloat = { _, _ in 44 }
    var headerHeight: () -> CGFloat = { 30 }

    let cache = MessageHeightCache()
    private var geometry = MessageStackGeometry(sections: [])
    private var width: CGFloat = 0

    override func prepare() {
        super.prepare()
        guard let collectionView else { return }
        width = collectionView.bounds.width
        let header = Double(headerHeight())
        var sections: [MessageStackGeometry.Section] = []
        for section in 0..<collectionView.numberOfSections {
            let heights = (0..<collectionView.numberOfItems(inSection: section)).map { item -> Double in
                let indexPath = IndexPath(item: item, section: section)
                if let key = key(indexPath, width), let known = cache.height(for: key) { return known }
                return Double(estimate(indexPath, width))
            }
            sections.append(.init(headerHeight: header, itemHeights: heights))
        }
        geometry = MessageStackGeometry(sections: sections)
    }

    override var collectionViewContentSize: CGSize {
        CGSize(width: width, height: geometry.contentHeight)
    }

    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        let band = geometry.elements(from: Double(rect.minY), to: Double(rect.maxY))
        var result: [UICollectionViewLayoutAttributes] = []
        result.reserveCapacity(band.headers.count + band.items.count)
        for section in band.headers {
            if let header = layoutAttributesForSupplementaryView(
                ofKind: UICollectionView.elementKindSectionHeader,
                at: IndexPath(item: 0, section: section)
            ) {
                result.append(header)
            }
        }
        for (section, item) in band.items {
            if let cell = layoutAttributesForItem(at: IndexPath(item: item, section: section)) { result.append(cell) }
        }
        return result
    }

    override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        guard geometry.itemFrames.indices.contains(indexPath.section),
            geometry.itemFrames[indexPath.section].indices.contains(indexPath.item)
        else { return nil }
        let frame = geometry.itemFrames[indexPath.section][indexPath.item]
        let attributes = UICollectionViewLayoutAttributes(forCellWith: indexPath)
        attributes.frame = CGRect(x: 0, y: frame.minY, width: width, height: frame.height)
        return attributes
    }

    override func layoutAttributesForSupplementaryView(
        ofKind elementKind: String,
        at indexPath: IndexPath
    ) -> UICollectionViewLayoutAttributes? {
        guard elementKind == UICollectionView.elementKindSectionHeader,
            geometry.headerFrames.indices.contains(indexPath.section)
        else { return nil }
        let frame = geometry.headerFrames[indexPath.section]
        let attributes = UICollectionViewLayoutAttributes(forSupplementaryViewOfKind: elementKind, with: indexPath)
        attributes.frame = CGRect(x: 0, y: frame.minY, width: width, height: frame.height)
        return attributes
    }

    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool {
        abs(newBounds.width - width) > 0.5
    }

    override func shouldInvalidateLayout(
        forPreferredLayoutAttributes preferred: UICollectionViewLayoutAttributes,
        withOriginalAttributes original: UICollectionViewLayoutAttributes
    ) -> Bool {
        guard original.representedElementCategory == .cell else { return false }
        // Замер запоминаем всегда — и совпавший с раскладкой: в следующий раз строка
        // встанет сразу своей высоты.
        if let key = key(original.indexPath, width) {
            cache.store(Double(preferred.frame.height), for: key)
        }
        return abs(preferred.frame.height - original.frame.height) > 0.5
    }

    override func invalidationContext(
        forPreferredLayoutAttributes preferred: UICollectionViewLayoutAttributes,
        withOriginalAttributes original: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutInvalidationContext {
        let context = super.invalidationContext(forPreferredLayoutAttributes: preferred, withOriginalAttributes: original)
        let indexPath = original.indexPath
        let delta = geometry.setHeight(Double(preferred.frame.height), section: indexPath.section, item: indexPath.item)
        guard let collectionView, delta != 0 else { return context }
        Signposts.chats.emitEvent("CellRemeasure")
        // Выросла строка целиком выше видимого — то, что под пальцем, не двигается.
        let top = collectionView.contentOffset.y + collectionView.adjustedContentInset.top
        ScrollJankMonitor.shared.noteRemeasure(above: original.frame.minY < top - 0.5)
        let shift = MessageStackGeometry.offsetAdjustment(itemMinY: Double(original.frame.minY), delta: delta, visibleTop: Double(top))
        if shift != 0 {
            context.contentOffsetAdjustment = CGPoint(x: 0, y: max(CGFloat(shift), -(collectionView.contentOffset.y + collectionView.adjustedContentInset.top)))
        }
        context.contentSizeAdjustment = CGSize(width: 0, height: CGFloat(delta))
        return context
    }
}
