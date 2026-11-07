import SwiftUI

/// План этажа: стены, помещения, лестницы и подписи — с масштабом щипком, сдвигом
/// пальцем и выбором помещения касанием.
///
/// Рисуется одним `Canvas`: тысячи стен отдельными вью тормозили бы жест. Для
/// VoiceOver план подменяется списком помещений — картинку им не прочитать.
struct FloorPlanCanvas: View {
    let geometry: FloorGeometry
    let selectedRoomID: String?
    let select: (String?) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @GestureState private var pinch: CGFloat = 1
    @GestureState private var drag: CGSize = .zero

    private let maxScale: CGFloat = 8

    var body: some View {
        GeometryReader { proxy in
            let base = baseTransform(in: proxy.size)
            let liveScale = clampScale(scale * pinch)
            let liveOffset = CGSize(width: offset.width + drag.width, height: offset.height + drag.height)
            let transform = CGAffineTransform(translationX: liveOffset.width, y: liveOffset.height)
                .concatenating(.identity)
            let full = base
                .concatenating(CGAffineTransform(translationX: -proxy.size.width / 2, y: -proxy.size.height / 2))
                .concatenating(CGAffineTransform(scaleX: liveScale, y: liveScale))
                .concatenating(CGAffineTransform(translationX: proxy.size.width / 2, y: proxy.size.height / 2))
                .concatenating(transform)

            Canvas { context, _ in
                draw(in: &context, transform: full, scale: base.a * liveScale)
            }
            .contentShape(Rectangle())
            .gesture(
                MagnifyGesture()
                    .updating($pinch) { value, state, _ in state = value.magnification }
                    .onEnded { value in scale = clampScale(scale * value.magnification) }
                    .simultaneously(with:
                        DragGesture(minimumDistance: 4)
                            .updating($drag) { value, state, _ in state = value.translation }
                            .onEnded { value in
                                offset.width += value.translation.width
                                offset.height += value.translation.height
                            }
                    )
            )
            .simultaneousGesture(
                SpatialTapGesture(count: 2).onEnded { _ in
                    withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) {
                        if scale > 1.5 {
                            scale = 1
                            offset = .zero
                        } else {
                            scale = 2.5
                        }
                    }
                }
            )
            .simultaneousGesture(
                SpatialTapGesture().onEnded { value in
                    select(room(at: value.location, transform: full))
                }
            )
            .onAppear { focusSelected(in: proxy.size, base: base) }
            .onChange(of: selectedRoomID) { focusSelected(in: proxy.size, base: base) }
        }
        .clipped()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(String(localized: "campus.planLabel", defaultValue: "План этажа")))
        .accessibilityChildren {
            ForEach(namedRooms) { room in
                Button(room.space.title) { select(room.id) }
                    .accessibilityAddTraits(room.id == selectedRoomID ? .isSelected : [])
            }
        }
    }

    private var namedRooms: [FloorGeometry.Room] {
        geometry.rooms.filter { !$0.space.title.isEmpty }.sorted { $0.space.title < $1.space.title }
    }

    // MARK: Рисование

    private func draw(in context: inout GraphicsContext, transform: CGAffineTransform, scale: CGFloat) {
        // Помещения: заливка по назначению, выбранное — акцентом.
        for room in geometry.rooms where room.outline.count >= 3 {
            var path = Path()
            path.addLines(room.outline.map { $0.applying(transform) })
            path.closeSubpath()
            let selected = room.id == selectedRoomID
            context.fill(path, with: .color(selected ? Palette.primary.opacity(0.35) : fill(for: room.space.kind)))
            if selected {
                context.stroke(path, with: .color(Palette.primary), lineWidth: 2)
            }
        }

        for vertical in geometry.verticals where vertical.outline.count >= 3 {
            var path = Path()
            path.addLines(vertical.outline.map { $0.applying(transform) })
            path.closeSubpath()
            context.fill(path, with: .color(Palette.warning.opacity(0.18)))
            context.stroke(path, with: .color(Palette.warning.opacity(0.6)), lineWidth: 1)
        }

        // Стены — толщиной в масштабе, но не тоньше волоса: при отдалении план не
        // должен рассыпаться в пустоту.
        var walls = Path()
        var glass = Path()
        for segment in geometry.segments {
            let a = segment.a.applying(transform)
            let b = segment.b.applying(transform)
            if segment.isGlass {
                glass.move(to: a)
                glass.addLine(to: b)
            } else {
                walls.move(to: a)
                walls.addLine(to: b)
            }
        }
        let wallWidth = max(1, 200 * scale)
        context.stroke(walls, with: .color(Palette.foreground.opacity(0.85)), style: StrokeStyle(lineWidth: wallWidth, lineCap: .square))
        context.stroke(glass, with: .color(Palette.info.opacity(0.7)), style: StrokeStyle(lineWidth: max(1, wallWidth / 2)))

        // Подписи помещений — когда для них хватает места.
        let showsNames = scale > 0.015
        for room in geometry.rooms {
            let text = showsNames ? room.space.title : (room.space.number ?? "")
            guard !text.isEmpty, scale > 0.004 else { continue }
            let point = CGPoint(x: room.space.label.x, y: room.space.label.y).applying(transform)
            let selected = room.id == selectedRoomID
            context.draw(
                Text(text)
                    .font(.caption2.weight(selected ? .bold : .medium))
                    .foregroundColor(selected ? Palette.primary : Palette.foreground),
                at: point
            )
        }
        for label in geometry.labels where scale > 0.015 {
            context.draw(
                Text(label.text).font(.caption2).foregroundColor(Palette.mutedForeground),
                at: CGPoint(x: label.x, y: label.y).applying(transform)
            )
        }
    }

    private func fill(for kind: String) -> Color {
        switch kind {
        case "corridor", "hall", "elevator_hall": return Palette.muted.opacity(0.6)
        case "auditorium", "lecture_hall", "lab", "computer_lab": return Palette.primary.opacity(0.08)
        case "restroom": return Palette.chart3.opacity(0.12)
        case "canteen", "library": return Palette.chart4.opacity(0.14)
        default: return Palette.card
        }
    }

    // MARK: Преобразования

    /// Вписать план в экран с полями; ось Y плана смотрит вниз, как у экрана.
    private func baseTransform(in size: CGSize) -> CGAffineTransform {
        let inset: CGFloat = 24
        let bounds = geometry.bounds
        let fit = min((size.width - inset * 2) / bounds.width, (size.height - inset * 2) / bounds.height)
        let scale = max(fit, 0.0001)
        let dx = (size.width - bounds.width * scale) / 2 - bounds.minX * scale
        let dy = (size.height - bounds.height * scale) / 2 - bounds.minY * scale
        return CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: dx, ty: dy)
    }

    private func clampScale(_ value: CGFloat) -> CGFloat {
        min(max(value, 0.8), maxScale)
    }

    /// Помещение под пальцем: внутри контура, а без контура — ближайшая метка.
    private func room(at location: CGPoint, transform: CGAffineTransform) -> String? {
        let inverse = transform.inverted()
        let point = location.applying(inverse)
        for room in geometry.rooms where room.outline.count >= 3 {
            var path = Path()
            path.addLines(room.outline)
            path.closeSubpath()
            if path.contains(point), !room.space.title.isEmpty { return room.id }
        }
        let tolerance = 28 / max(transform.a, 0.0001)
        return geometry.rooms
            .filter { !$0.space.title.isEmpty }
            .map { ($0.id, hypot($0.space.label.x - point.x, $0.space.label.y - point.y)) }
            .filter { $0.1 < tolerance }
            .min { $0.1 < $1.1 }?.0
    }

    /// Выбранное помещение — в центр экрана, с приближением.
    private func focusSelected(in size: CGSize, base: CGAffineTransform) {
        guard let room = geometry.rooms.first(where: { $0.id == selectedRoomID }) else { return }
        let target: CGFloat = max(scale, 2.5)
        let point = CGPoint(x: room.space.label.x, y: room.space.label.y).applying(base)
        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) {
            scale = target
            offset = CGSize(
                width: -(point.x - size.width / 2) * target,
                height: -(point.y - size.height / 2) * target
            )
        }
    }
}
