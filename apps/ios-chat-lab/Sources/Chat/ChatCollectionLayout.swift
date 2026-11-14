import UIKit

/// Раскладка перевёрнутой ленты: строки стопкой снизу вверх (индекс 0 — самое новое, y = 0).
/// Высоты приходят готовыми из `MessageLayoutEngine`; здесь только смещения, поиск видимых
/// и анимации вставки/удаления по образцу Telegram (ListView):
/// - новая строка «вырастает» снизу: начальное смещение −1,6 высоты;
/// - удаляемая — гаснет и сжимается до 0,1 за 0,15 с, соседи съезжают за 0,4 с.
final class ChatCollectionLayout: UICollectionViewLayout {
    var heights: [CGFloat] = [] {
        didSet {
            needsOffsets = true
            previousHeights = oldValue
            previousOffsets = offsets
        }
    }

    /// Раскладка до обновления — для рамок удаляемых строк.
    private var previousHeights: [CGFloat] = []
    private var previousOffsets: [CGFloat] = []

    /// Строки, которые надо анимировать как «новые снизу» (входящие/отправка), а не просто появить.
    var animateInsertionsFromBottom = true
    /// Вставка без собственной анимации строки (своё отправленное: его ведёт полёт из поля ввода).
    var plainInsertions = false

    private var offsets: [CGFloat] = []
    private var needsOffsets = true
    private var contentHeight: CGFloat = 0
    private var insertedItems: Set<IndexPath> = []
    private var deletedItems: Set<IndexPath> = []
    private var cachedAttributes: [Int: UICollectionViewLayoutAttributes] = [:]

    override class var layoutAttributesClass: AnyClass { UICollectionViewLayoutAttributes.self }

    override func prepare() {
        super.prepare()
        guard needsOffsets else { return }
        needsOffsets = false
        cachedAttributes.removeAll(keepingCapacity: true)
        offsets = []
        offsets.reserveCapacity(heights.count)
        var y: CGFloat = 0
        for height in heights {
            offsets.append(y)
            y += height
        }
        contentHeight = y
    }

    override func invalidateLayout(with context: UICollectionViewLayoutInvalidationContext) {
        if context.invalidateEverything || context.invalidateDataSourceCounts { needsOffsets = true }
        super.invalidateLayout(with: context)
    }

    override var collectionViewContentSize: CGSize {
        CGSize(width: collectionView?.bounds.width ?? 0, height: contentHeight)
    }

    private func attributes(at index: Int) -> UICollectionViewLayoutAttributes? {
        guard index >= 0, index < heights.count, index < offsets.count else { return nil }
        if let cached = cachedAttributes[index] { return cached }
        let attributes = UICollectionViewLayoutAttributes(forCellWith: IndexPath(item: index, section: 0))
        attributes.frame = CGRect(x: 0, y: offsets[index], width: collectionView?.bounds.width ?? 0, height: heights[index])
        // Новые строки рисуются поверх старых, пока едут.
        attributes.zIndex = 0
        cachedAttributes[index] = attributes
        return attributes
    }

    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        guard !offsets.isEmpty else { return [] }
        // Двоичный поиск первой строки, нижний край которой в прямоугольнике.
        var low = 0
        var high = offsets.count - 1
        while low < high {
            let mid = (low + high) / 2
            if offsets[mid] + heights[mid] < rect.minY { low = mid + 1 } else { high = mid }
        }
        var result: [UICollectionViewLayoutAttributes] = []
        var index = low
        while index < offsets.count, offsets[index] <= rect.maxY {
            if let attributes = attributes(at: index) { result.append(attributes) }
            index += 1
        }
        return result
    }

    override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        attributes(at: indexPath.item)
    }

    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool {
        newBounds.width != collectionView?.bounds.width
    }

    func frameForItem(_ index: Int) -> CGRect? { attributes(at: index)?.frame }

    func indexForItem(atContentY y: CGFloat) -> Int? {
        guard !offsets.isEmpty else { return nil }
        var low = 0
        var high = offsets.count - 1
        while low < high {
            let mid = (low + high) / 2
            if offsets[mid] + heights[mid] <= y { low = mid + 1 } else { high = mid }
        }
        return low
    }

    // MARK: Анимации обновлений

    override func prepare(forCollectionViewUpdates updateItems: [UICollectionViewUpdateItem]) {
        super.prepare(forCollectionViewUpdates: updateItems)
        insertedItems.removeAll()
        deletedItems.removeAll()
        for item in updateItems {
            switch item.updateAction {
            case .insert: if let path = item.indexPathAfterUpdate { insertedItems.insert(path) }
            case .delete: if let path = item.indexPathBeforeUpdate { deletedItems.insert(path) }
            default: break
            }
        }
    }

    override func finalizeCollectionViewUpdates() {
        super.finalizeCollectionViewUpdates()
        insertedItems.removeAll()
        deletedItems.removeAll()
    }

    override func initialLayoutAttributesForAppearingItem(at itemIndexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        guard let attributes = attributes(at: itemIndexPath.item)?.copy() as? UICollectionViewLayoutAttributes else { return nil }
        guard insertedItems.contains(itemIndexPath), !plainInsertions else { return attributes }
        if animateInsertionsFromBottom, itemIndexPath.item < 3 {
            // Снизу (в перевёрнутой ленте — меньшие y): Telegram сдвигает новую строку на −1,6 высоты.
            attributes.frame.origin.y -= attributes.frame.height * 1.6
            attributes.alpha = 0
        } else {
            attributes.alpha = 0
        }
        return attributes
    }

    override func finalLayoutAttributesForDisappearingItem(at itemIndexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        let index = itemIndexPath.item
        guard deletedItems.contains(itemIndexPath), index < previousOffsets.count, index < previousHeights.count else {
            return super.finalLayoutAttributesForDisappearingItem(at: itemIndexPath)
        }
        let attributes = UICollectionViewLayoutAttributes(forCellWith: itemIndexPath)
        attributes.frame = CGRect(x: 0, y: previousOffsets[index], width: collectionView?.bounds.width ?? 0, height: previousHeights[index])
        attributes.alpha = 0
        attributes.transform = CGAffineTransform(scaleX: 0.1, y: 0.1)
        return attributes
    }
}
