import UIKit

/// Растягиваемые картинки пузырей: тело со скруглениями по положению в серии и хвост у
/// последнего. Рисуются один раз на сочетание (сторона × серия × тема × подсветка).
@MainActor
enum BubbleImages {
    struct Key: Hashable {
        var outgoing: Bool
        var mergeTop: Bool
        var mergeBottom: Bool
        var highlighted: Bool
        var dark: Bool
    }

    private static var cache: [Key: UIImage] = [:]

    static func image(outgoing: Bool, merge: MergeFlags, highlighted: Bool, traits: UITraitCollection) -> UIImage {
        let key = Key(
            outgoing: outgoing, mergeTop: merge.top, mergeBottom: merge.bottom, highlighted: highlighted,
            dark: traits.userInterfaceStyle == .dark
        )
        if let image = cache[key] { return image }
        let color = (highlighted
            ? (outgoing ? Palette.outgoingBubbleHighlighted : Palette.incomingBubbleHighlighted)
            : Palette.bubble(outgoing: outgoing)).resolvedColor(with: traits)
        let image = render(key: key, color: color)
        cache[key] = image
        return image
    }

    /// Ширина, на которую картинка выходит за тело пузыря со стороны хвоста.
    static let tailOverhang = BubbleMetrics.tailWidth

    private static func render(key: Key, color: UIColor) -> UIImage {
        let radius = BubbleMetrics.cornerRadius
        let small = BubbleMetrics.mergedCornerRadius
        let tail = BubbleMetrics.tailWidth
        let bodyWidth = radius * 2 + 2
        let size = CGSize(width: bodyWidth + tail, height: radius * 2 + 2)
        let hasTail = !key.mergeBottom
        let format = UIGraphicsImageRendererFormat()
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let image = renderer.image { context in
            let cg = context.cgContext
            if !key.outgoing {
                // Входящий — зеркало исходящего.
                cg.translateBy(x: size.width, y: 0)
                cg.scaleBy(x: -1, y: 1)
            }
            let topRight = key.mergeTop ? small : radius
            let bottomRight = key.mergeBottom ? small : (hasTail ? 0 : radius)
            let topLeft = radius
            let bottomLeft = radius
            let right = bodyWidth
            let h = size.height
            let path = UIBezierPath()
            path.move(to: CGPoint(x: topLeft, y: 0))
            path.addLine(to: CGPoint(x: right - topRight, y: 0))
            path.addArc(withCenter: CGPoint(x: right - topRight, y: topRight), radius: topRight, startAngle: -.pi / 2, endAngle: 0, clockwise: true)
            if hasTail {
                // Хвост: правая кромка плавно уходит в остриё у нижнего края, затем дуга
                // обратно под тело — форма хвоста Telegram.
                path.addLine(to: CGPoint(x: right, y: h - 13))
                path.addCurve(to: CGPoint(x: right + tail, y: h), controlPoint1: CGPoint(x: right, y: h - 4), controlPoint2: CGPoint(x: right + tail * 0.5, y: h - 0.5))
                path.addQuadCurve(to: CGPoint(x: right - 8, y: h), controlPoint: CGPoint(x: right, y: h))
            } else {
                path.addLine(to: CGPoint(x: right, y: h - bottomRight))
                path.addArc(withCenter: CGPoint(x: right - bottomRight, y: h - bottomRight), radius: bottomRight, startAngle: 0, endAngle: .pi / 2, clockwise: true)
            }
            path.addLine(to: CGPoint(x: bottomLeft, y: h))
            path.addArc(withCenter: CGPoint(x: bottomLeft, y: h - bottomLeft), radius: bottomLeft, startAngle: .pi / 2, endAngle: .pi, clockwise: true)
            path.addLine(to: CGPoint(x: 0, y: topLeft))
            path.addArc(withCenter: CGPoint(x: topLeft, y: topLeft), radius: topLeft, startAngle: .pi, endAngle: .pi * 1.5, clockwise: true)
            path.close()
            color.setFill()
            path.fill()
        }
        let capRight = radius + 1 + tail
        let insets = key.outgoing
            ? UIEdgeInsets(top: radius, left: radius, bottom: radius, right: capRight)
            : UIEdgeInsets(top: radius, left: capRight, bottom: radius, right: radius)
        return image.resizableImage(withCapInsets: insets, resizingMode: .stretch)
    }

    /// Рамка картинки пузыря относительно тела: картинка шире на хвост со стороны автора.
    static func imageFrame(for body: CGRect, outgoing: Bool) -> CGRect {
        outgoing
            ? CGRect(x: body.minX, y: body.minY, width: body.width + tailOverhang, height: body.height)
            : CGRect(x: body.minX - tailOverhang, y: body.minY, width: body.width + tailOverhang, height: body.height)
    }

    /// Путь тела пузыря (для маски медиа и снимка в контекстном меню).
    static func bodyPath(size: CGSize, outgoing: Bool, merge: MergeFlags) -> UIBezierPath {
        let radius = BubbleMetrics.cornerRadius
        let small = BubbleMetrics.mergedCornerRadius
        var corners: (tl: CGFloat, tr: CGFloat, bl: CGFloat, br: CGFloat) = (radius, radius, radius, radius)
        if outgoing {
            corners.tr = merge.top ? small : radius
            corners.br = merge.bottom ? small : 4
        } else {
            corners.tl = merge.top ? small : radius
            corners.bl = merge.bottom ? small : 4
        }
        return roundedPath(CGRect(origin: .zero, size: size), corners: corners)
    }

    static func roundedPath(_ rect: CGRect, corners: (tl: CGFloat, tr: CGFloat, bl: CGFloat, br: CGFloat)) -> UIBezierPath {
        let path = UIBezierPath()
        path.move(to: CGPoint(x: rect.minX + corners.tl, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - corners.tr, y: rect.minY))
        path.addArc(withCenter: CGPoint(x: rect.maxX - corners.tr, y: rect.minY + corners.tr), radius: corners.tr, startAngle: -.pi / 2, endAngle: 0, clockwise: true)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - corners.br))
        path.addArc(withCenter: CGPoint(x: rect.maxX - corners.br, y: rect.maxY - corners.br), radius: corners.br, startAngle: 0, endAngle: .pi / 2, clockwise: true)
        path.addLine(to: CGPoint(x: rect.minX + corners.bl, y: rect.maxY))
        path.addArc(withCenter: CGPoint(x: rect.minX + corners.bl, y: rect.maxY - corners.bl), radius: corners.bl, startAngle: .pi / 2, endAngle: .pi, clockwise: true)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + corners.tl))
        path.addArc(withCenter: CGPoint(x: rect.minX + corners.tl, y: rect.minY + corners.tl), radius: corners.tl, startAngle: .pi, endAngle: .pi * 1.5, clockwise: true)
        path.close()
        return path
    }
}
