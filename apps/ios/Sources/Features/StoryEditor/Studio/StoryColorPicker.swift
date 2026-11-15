import SwiftUI
import UIKit

/// «Выбор цвета»: палитра, спектр и шкала, непрозрачность 0–100 % и быстрые цвета.
/// Цвет уходит в инструмент сразу, под пальцем; «×» закрывает с выбранным цветом.
struct StoryColorPickerSheet: View {
    let model: StoryStudioModel
    let canvas: CGRect

    enum Tab: String, CaseIterable {
        case grid
        case spectrum
        case sliders

        var title: String {
            switch self {
            case .grid: return String(localized: "stories.color.grid", defaultValue: "Палитра")
            case .spectrum: return String(localized: "stories.color.spectrum", defaultValue: "Спектр")
            case .sliders: return String(localized: "stories.color.sliders", defaultValue: "Шкала")
            }
        }
    }

    @State private var tab: Tab = .grid
    @State private var eyedropping = false
    @State private var dragOffset: CGFloat = 0

    private var color: StoryColor { model.pickerColor }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if eyedropping {
                StoryEyedropper(model: model, canvas: canvas) { picked in
                    if let picked { model.setPickerColor(picked.withAlpha(color.alpha)) }
                    withAnimation(Motion.snappy) { eyedropping = false }
                }
            } else {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                    .onTapGesture { model.confirmTool() }
                sheet
                    .frame(width: canvas.width)
                    .offset(x: canvas.minX, y: max(canvas.maxY + StoryStageLayout.bottomBar - sheetHeight, canvas.minY) + max(dragOffset, 0))
                    .transition(.move(edge: .bottom))
            }
        }
        .environment(\.colorScheme, .dark)
    }

    private var sheetHeight: CGFloat { 560 }

    private var sheet: some View {
        VStack(spacing: Spacing.lg) {
            HStack {
                Button {
                    model.confirmTool()
                } label: {
                    Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).frame(width: 30, height: 30)
                        .background(Circle().fill(Color.white.opacity(0.15)))
                }
                .accessibilityLabel(Text(String(localized: "stories.close", defaultValue: "Закрыть")))
                .accessibilityIdentifier("story.color.close")
                Spacer()
                Text(String(localized: "stories.color.title", defaultValue: "Выбор цвета")).font(.headline)
                Spacer()
                Button {
                    withAnimation(Motion.snappy) { eyedropping = true }
                } label: {
                    Image(systemName: "eyedropper").font(.system(size: 16, weight: .semibold)).frame(width: 30, height: 30)
                }
                .accessibilityLabel(Text(String(localized: "stories.color.eyedropper", defaultValue: "Пипетка")))
                .accessibilityIdentifier("story.color.eyedropper")
            }
            .foregroundStyle(.white)
            .contentShape(Rectangle())
            .gesture(DragGesture()
                .onChanged { dragOffset = $0.translation.height }
                .onEnded { drag in
                    if drag.translation.height > 120 { model.confirmTool() }
                    withAnimation(Motion.snappy) { dragOffset = 0 }
                })

            Picker("", selection: $tab) {
                ForEach(Tab.allCases, id: \.self) { item in Text(item.title).tag(item) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("story.color.tabs")

            Group {
                switch tab {
                case .grid: PaletteGrid(color: color) { model.setPickerColor($0.withAlpha(color.alpha)) }
                case .spectrum: SpectrumPicker(color: color) { model.setPickerColor($0.withAlpha(color.alpha)) }
                case .sliders: ChannelSliders(color: color) { model.setPickerColor($0) }
                }
            }
            .frame(height: 230)

            OpacitySlider(color: color) { model.setPickerColor(color.withAlpha($0)) }

            HStack(spacing: Spacing.md) {
                ZStack {
                    Checkerboard().clipShape(RoundedRectangle(cornerRadius: 10))
                    RoundedRectangle(cornerRadius: 10).fill(color.swiftUIColor)
                }
                .frame(width: 52, height: 52)
                .accessibilityElement()
                .accessibilityLabel(Text(String(localized: "stories.color.preview", defaultValue: "Выбранный цвет")))
                .accessibilityIdentifier("story.color.preview")
                .accessibilityValue(Text(verbatim: "\(color.hex) \(Int((color.alpha * 100).rounded()))%"))
                Rectangle().fill(Color.white.opacity(0.2)).frame(width: 1, height: 36)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.md) {
                        ForEach(StoryColor.presets, id: \.self) { preset in
                            Button {
                                Haptics.tap()
                                // Быстрый цвет — целиком, вместе с непрозрачностью.
                                model.setPickerColor(preset)
                            } label: {
                                Circle().fill(preset.swiftUIColor)
                                    .frame(width: 30, height: 30)
                                    .overlay(Circle().stroke(.white, lineWidth: preset.matches(color) ? 3 : 1))
                            }
                            .accessibilityLabel(Text(verbatim: preset.hex))
                            .accessibilityIdentifier("story.color.preset.\(preset.hex)")
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                }
            }
        }
        .padding(Spacing.xl)
        .frame(height: sheetHeight, alignment: .top)
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24, style: .continuous)
                .fill(Color(white: 0.12))
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("story.color.sheet")
    }
}

/// Сетка оттенков: ведёшь пальцем — цвет меняется под ним, ячейка в рамке.
private struct PaletteGrid: View {
    let color: StoryColor
    let onPick: (StoryColor) -> Void
    private let grid = StoryColor.paletteGrid(columns: 12, rows: 10)

    var body: some View {
        GeometryReader { proxy in
            let rows = grid.count
            let columns = grid.first?.count ?? 1
            let cell = CGSize(width: proxy.size.width / CGFloat(columns), height: proxy.size.height / CGFloat(rows))
            let selected = selectedCell
            ZStack(alignment: .topLeading) {
                Canvas { context, _ in
                    for (row, line) in grid.enumerated() {
                        for (column, item) in line.enumerated() {
                            let rect = CGRect(x: CGFloat(column) * cell.width, y: CGFloat(row) * cell.height, width: cell.width + 0.5, height: cell.height + 0.5)
                            context.fill(Path(rect), with: .color(item.swiftUIColor))
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 10))
                if let selected {
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(.white, lineWidth: 3)
                        .frame(width: cell.width + 2, height: cell.height + 2)
                        .shadow(radius: 2)
                        .offset(x: CGFloat(selected.column) * cell.width - 1, y: CGFloat(selected.row) * cell.height - 1)
                        .allowsHitTesting(false)
                }
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                let column = Int((drag.location.x / cell.width).clamped(to: 0...CGFloat(columns - 1)))
                let row = Int((drag.location.y / cell.height).clamped(to: 0...CGFloat(rows - 1)))
                let picked = grid[row][column]
                if !picked.matches(color) {
                    Haptics.tap()
                    onPick(picked)
                }
            })
        }
        .accessibilityElement()
        .accessibilityLabel(Text(String(localized: "stories.color.grid", defaultValue: "Палитра")))
        .accessibilityIdentifier("story.color.grid")
        .accessibilityValue(Text(verbatim: color.hex))
    }

    private var selectedCell: (row: Int, column: Int)? {
        for (row, line) in grid.enumerated() {
            if let column = line.firstIndex(where: { $0.matches(color) }) { return (row, column) }
        }
        return nil
    }
}

/// Спектр: тон по горизонтали, сверху светлое, снизу тёмное. Маркер — текущая точка.
private struct SpectrumPicker: View {
    let color: StoryColor
    let onPick: (StoryColor) -> Void
    @State private var marker: CGPoint?

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack(alignment: .topLeading) {
                Canvas { context, canvasSize in
                    let columns = 72
                    let rows = 40
                    let cw = canvasSize.width / CGFloat(columns)
                    let ch = canvasSize.height / CGFloat(rows)
                    for column in 0..<columns {
                        for row in 0..<rows {
                            let item = Self.color(at: CGPoint(x: (CGFloat(column) + 0.5) / CGFloat(columns), y: (CGFloat(row) + 0.5) / CGFloat(rows)))
                            context.fill(Path(CGRect(x: CGFloat(column) * cw, y: CGFloat(row) * ch, width: cw + 0.5, height: ch + 0.5)), with: .color(item.swiftUIColor))
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 10))
                let position = marker ?? Self.position(of: color)
                Circle()
                    .stroke(.white, lineWidth: 3)
                    .background(Circle().fill(color.opaque.swiftUIColor))
                    .frame(width: 28, height: 28)
                    .shadow(radius: 3)
                    .position(x: position.x * size.width, y: position.y * size.height)
                    .allowsHitTesting(false)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { drag in
                    let point = CGPoint(
                        x: (drag.location.x / max(size.width, 1)).clamped(to: 0...1),
                        y: (drag.location.y / max(size.height, 1)).clamped(to: 0...1)
                    )
                    marker = point
                    onPick(Self.color(at: point))
                }
                .onEnded { _ in marker = nil })
        }
        .accessibilityElement()
        .accessibilityLabel(Text(String(localized: "stories.color.spectrum", defaultValue: "Спектр")))
        .accessibilityIdentifier("story.color.spectrum")
        .accessibilityValue(Text(verbatim: color.hex))
    }

    /// Верхняя половина — от белёсого к чистому тону, нижняя — от чистого к тёмному.
    static func color(at point: CGPoint) -> StoryColor {
        let hue = Double(point.x)
        let y = Double(point.y)
        if y < 0.5 {
            return StoryColor(hue: hue, saturation: 0.15 + y * 1.7, brightness: 1)
        }
        return StoryColor(hue: hue, saturation: 1, brightness: 1 - (y - 0.5) * 1.6)
    }

    static func position(of color: StoryColor) -> CGPoint {
        let hsb = color.hsb
        let y = hsb.brightness >= 0.999 ? (hsb.saturation - 0.15) / 1.7 : 0.5 + (1 - hsb.brightness) / 1.6
        return CGPoint(x: hsb.hue, y: y.clamped(to: 0...1))
    }
}

/// «Шкала»: красный, зелёный, синий и код цвета.
private struct ChannelSliders: View {
    let color: StoryColor
    let onPick: (StoryColor) -> Void

    var body: some View {
        VStack(spacing: Spacing.lg) {
            channel(String(localized: "stories.curves.red", defaultValue: "Красный"), value: color.red, from: color.withRed(0), to: color.withRed(1), id: "red") {
                onPick(color.withRed($0))
            }
            channel(String(localized: "stories.curves.green", defaultValue: "Зелёный"), value: color.green, from: color.withGreen(0), to: color.withGreen(1), id: "green") {
                onPick(color.withGreen($0))
            }
            channel(String(localized: "stories.curves.blue", defaultValue: "Синий"), value: color.blue, from: color.withBlue(0), to: color.withBlue(1), id: "blue") {
                onPick(color.withBlue($0))
            }
            HStack {
                Text(String(localized: "stories.color.hex", defaultValue: "Код цвета")).foregroundStyle(.white.opacity(0.6))
                Spacer()
                Text(verbatim: color.hex).font(.body.monospaced()).foregroundStyle(.white)
            }
        }
    }

    private func channel(_ title: String, value: Double, from: StoryColor, to: StoryColor, id: String, onChange: @escaping (Double) -> Void) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack {
                Text(title).font(.footnote).foregroundStyle(.white.opacity(0.7))
                Spacer()
                Text(verbatim: "\(Int((value * 255).rounded()))").font(.footnote.monospacedDigit()).foregroundStyle(.white)
            }
            GradientTrack(value: value, colors: [from.opaque.swiftUIColor, to.opaque.swiftUIColor], onChange: onChange)
                .accessibilityIdentifier("story.color.channel.\(id)")
        }
    }
}

/// Непрозрачность: шахматка под градиентом и проценты рядом.
private struct OpacitySlider: View {
    let color: StoryColor
    let onChange: (Double) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(String(localized: "stories.color.opacity", defaultValue: "Непрозрачность")).font(.footnote).foregroundStyle(.white.opacity(0.7))
            HStack(spacing: Spacing.md) {
                GradientTrack(value: color.alpha, colors: [color.withAlpha(0).swiftUIColor, color.opaque.swiftUIColor], checkered: true, onChange: onChange)
                    .accessibilityIdentifier("story.color.opacity")
                Text(verbatim: "\(Int((color.alpha * 100).rounded()))%")
                    .font(.body.monospacedDigit())
                    .foregroundStyle(.white)
                    .frame(width: 56, alignment: .trailing)
                    .accessibilityIdentifier("story.color.opacityValue")
            }
        }
    }
}

/// Полоса с градиентом и круглым бегунком (0…1).
private struct GradientTrack: View {
    let value: Double
    let colors: [Color]
    var checkered = false
    let onChange: (Double) -> Void

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            ZStack(alignment: .leading) {
                if checkered { Checkerboard().clipShape(Capsule()) }
                Capsule().fill(LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing))
                Circle()
                    .stroke(.white, lineWidth: 3)
                    .frame(width: 26, height: 26)
                    .shadow(radius: 2)
                    .offset(x: CGFloat(value) * (width - 26))
            }
            .frame(height: 30)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                onChange(Double(((drag.location.x - 13) / max(width - 26, 1)).clamped(to: 0...1)))
            })
        }
        .frame(height: 30)
        .accessibilityElement()
        .accessibilityValue(Text(verbatim: "\(Int((value * 100).rounded()))"))
        .accessibilityAdjustableAction { direction in
            onChange((value + (direction == .increment ? 0.05 : -0.05)).clamped(to: 0...1))
        }
    }
}

/// Шахматный фон под прозрачным цветом.
struct Checkerboard: View {
    var body: some View {
        Canvas { context, size in
            let side: CGFloat = 6
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.white))
            for row in 0..<Int(size.height / side + 1) {
                for column in 0..<Int(size.width / side + 1) where (row + column).isMultiple(of: 2) {
                    context.fill(Path(CGRect(x: CGFloat(column) * side, y: CGFloat(row) * side, width: side, height: side)), with: .color(Color(white: 0.8)))
                }
            }
        }
    }
}

/// Пипетка: палец по холсту, над ним — круглая лупа с сеткой пикселей и цветным
/// ободком. Отпустил — цвет взят. Сама лупа — вид поверх, в историю не попадает.
private struct StoryEyedropper: View {
    let model: StoryStudioModel
    let canvas: CGRect
    let onFinish: (StoryColor?) -> Void

    @State private var snapshot: UIImage?
    @State private var location: CGPoint?
    @State private var sample: StoryColor?

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.001)
                .frame(width: canvas.width, height: canvas.height)
                .offset(x: canvas.minX, y: canvas.minY)
                .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { drag in
                        let point = CGPoint(x: drag.location.x.clamped(to: 0...canvas.width), y: drag.location.y.clamped(to: 0...canvas.height))
                        location = point
                        sample = color(at: point)
                    }
                    .onEnded { _ in
                        Haptics.tap()
                        onFinish(sample)
                    })
                .accessibilityIdentifier("story.color.eyedropperArea")
            if let location, let snapshot {
                Loupe(image: snapshot, point: location, canvasSize: canvas.size, ring: sample ?? .white)
                    .frame(width: 120, height: 120)
                    .position(x: canvas.minX + location.x, y: canvas.minY + location.y - 90)
                    .allowsHitTesting(false)
                    .accessibilityIdentifier("story.color.loupe")
            } else {
                Text(String(localized: "stories.color.eyedropperHint", defaultValue: "Ведите пальцем по фото"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
                    .background(Capsule().fill(.black.opacity(0.55)))
                    .frame(width: canvas.width)
                    .offset(x: canvas.minX, y: canvas.minY + 24)
                    .allowsHitTesting(false)
            }
        }
        .onAppear { snapshot = model.previewImage(width: 540) }
    }

    private func color(at point: CGPoint) -> StoryColor? {
        guard let cgImage = snapshot?.cgImage, canvas.width > 0 else { return nil }
        let x = Int(point.x / canvas.width * CGFloat(cgImage.width))
        let y = Int(point.y / canvas.height * CGFloat(cgImage.height))
        return StoryPixelSampler.color(in: cgImage, x: x, y: y)
    }
}

/// Лупа: увеличенный участок под пальцем, сетка пикселей и ободок выбранного цвета.
private struct Loupe: View {
    let image: UIImage
    let point: CGPoint
    let canvasSize: CGSize
    let ring: StoryColor

    var body: some View {
        Canvas { context, size in
            guard let cgImage = image.cgImage, canvasSize.width > 0 else { return }
            let pixels = 11
            let cx = Int(point.x / canvasSize.width * CGFloat(cgImage.width))
            let cy = Int(point.y / canvasSize.height * CGFloat(cgImage.height))
            let cell = size.width / CGFloat(pixels)
            for row in 0..<pixels {
                for column in 0..<pixels {
                    let sample = StoryPixelSampler.color(in: cgImage, x: cx + column - pixels / 2, y: cy + row - pixels / 2) ?? .black
                    context.fill(Path(CGRect(x: CGFloat(column) * cell, y: CGFloat(row) * cell, width: cell + 0.5, height: cell + 0.5)), with: .color(sample.opaque.swiftUIColor))
                }
            }
            var grid = Path()
            for index in 1..<pixels {
                let offset = CGFloat(index) * cell
                grid.move(to: CGPoint(x: offset, y: 0))
                grid.addLine(to: CGPoint(x: offset, y: size.height))
                grid.move(to: CGPoint(x: 0, y: offset))
                grid.addLine(to: CGPoint(x: size.width, y: offset))
            }
            context.stroke(grid, with: .color(.black.opacity(0.25)), lineWidth: 0.5)
            let center = CGRect(x: CGFloat(pixels / 2) * cell, y: CGFloat(pixels / 2) * cell, width: cell, height: cell)
            context.stroke(Path(center), with: .color(.white), lineWidth: 2)
        }
        .clipShape(Circle())
        .overlay(Circle().stroke(ring.opaque.swiftUIColor, lineWidth: 8))
        .overlay(Circle().stroke(.white, lineWidth: 2))
        .shadow(radius: 6)
    }
}

/// Цвет пикселя растра (sRGB, 8 бит).
enum StoryPixelSampler {
    static func color(in image: CGImage, x: Int, y: Int) -> StoryColor? {
        guard x >= 0, y >= 0, x < image.width, y < image.height else { return nil }
        var pixel = [UInt8](repeating: 0, count: 4)
        guard let context = CGContext(
            data: &pixel,
            width: 1,
            height: 1,
            bitsPerComponent: 8,
            bytesPerRow: 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.draw(image, in: CGRect(x: -x, y: y - image.height + 1, width: image.width, height: image.height))
        let alpha = Double(pixel[3]) / 255
        guard alpha > 0 else { return StoryColor(white: 0, alpha: 0) }
        return StoryColor(red: Double(pixel[0]) / 255 / alpha, green: Double(pixel[1]) / 255 / alpha, blue: Double(pixel[2]) / 255 / alpha)
    }
}

extension StoryColor {
    func withRed(_ value: Double) -> StoryColor { StoryColor(red: value, green: green, blue: blue, alpha: alpha) }
    func withGreen(_ value: Double) -> StoryColor { StoryColor(red: red, green: value, blue: blue, alpha: alpha) }
    func withBlue(_ value: Double) -> StoryColor { StoryColor(red: red, green: green, blue: value, alpha: alpha) }
}
