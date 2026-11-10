import SwiftUI

/// Экран загрузки — вторая половина пары с системным Launch Screen.
///
/// Системный экран (`UILaunchScreen` в project.yml) статичен и рисуется до первой
/// строки кода: только цвет `LaunchBackground`, чисто белый или чисто чёрный. Знака на
/// нём нет намеренно. Первый кадр этого вида совпадает с системным экраном пиксель в
/// пиксель, и знак прорисовывается уже из пустоты — без скачка от статичной картинки к
/// анимированной.
///
/// Запуск вид не задерживает: он держится, пока корневому экрану нечего показать, и
/// уходит в тот же момент, даже если знак ещё не дорисован (`RootView`).
struct LaunchLoadingView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var progress: CGFloat = 0

    var body: some View {
        ZStack {
            LaunchPalette.background
                .ignoresSafeArea()
            // С «уменьшением движения» знак сразу стоит на месте: ни прорисовки, ни
            // приближения — только конечный кадр.
            DrawnGlyph(progress: reduceMotion ? 1 : progress, size: LaunchMetrics.glyph)
                .frame(width: LaunchMetrics.glyph, height: LaunchMetrics.glyph)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "StudentHub"))
        .onAppear {
            guard !reduceMotion else { return }
            // Время линейное, а кривые — у каждой дорожки свои (`DrawnGlyph`): так
            // штрих, заливка и масштаб едут от одного часового механизма и не
            // расходятся по кадрам.
            withAnimation(.linear(duration: LaunchMetrics.duration)) { progress = 1 }
        }
    }

    /// Уход экрана: знак чуть приближается и растворяется, как у Threads. С
    /// «уменьшением движения» — только растворение: смена прозрачности не движение.
    static func exitTransition(reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 1.06))
    }

    static func exitAnimation(reduceMotion: Bool) -> Animation {
        reduceMotion ? .easeOut(duration: Motion.Duration.layer) : Motion.calm
    }
}

/// Фон пары «Launch Screen + экран загрузки». Тот же, что `LaunchBackground` в каталоге
/// ассетов, но в коде: сборка через xtool каталог не компилирует, а системный экран без
/// цвета там и так берёт системный фон — тот же белый и чёрный.
enum LaunchPalette {
    static let background = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? .black : .white
    })
    /// Фирменный синий плашки знака: на чисто чёрном и чисто белом читается одинаково.
    static let mark = AuthPalette.brandBlue
}

private enum LaunchMetrics {
    /// Знак — без плашки, как в Threads: на пустом экране плашка лишняя.
    static let glyph: CGFloat = 84
    static let duration: TimeInterval = 0.7
}

/// Знак, который прорисовывается: штрих обводит ромб, тулью и кисточку, затем
/// заливка проявляется, а штрих растворяется в ней. `progress` от 0 до 1 —
/// общее время; у каждой дорожки свой отрезок и своя кривая.
private struct DrawnGlyph: View, Animatable {
    var progress: CGFloat
    var size: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    var body: some View {
        let fill = Easing.inOut(Self.segment(progress, 0.45, 1))
        ZStack {
            ForEach(StudentHubGlyph.Part.allCases, id: \.self) { part in
                let window = Self.strokeWindow(part)
                StudentHubGlyph(part)
                    .trim(from: 0, to: Easing.inOut(Self.segment(progress, window.start, window.end)))
                    .stroke(LaunchPalette.mark, style: StrokeStyle(lineWidth: size / 24 * 0.6, lineCap: .round, lineJoin: .round))
            }
            .opacity(1 - fill)
            StudentHubGlyph()
                .fill(LaunchPalette.mark)
                .opacity(fill)
        }
        .scaleEffect(0.94 + 0.06 * Easing.out(progress))
    }

    /// Части начинают с лёгким сдвигом: ромб, за ним тулья, последней кисточка — как
    /// одно движение руки, а не три одновременных.
    private static func strokeWindow(_ part: StudentHubGlyph.Part) -> (start: CGFloat, end: CGFloat) {
        switch part {
        case .board: return (0, 0.5)
        case .crown: return (0.08, 0.55)
        case .tassel: return (0.16, 0.6)
        }
    }

    /// Доля отрезка `[start, end]`, пройденная к моменту `t`, — от 0 до 1.
    private static func segment(_ t: CGFloat, _ start: CGFloat, _ end: CGFloat) -> CGFloat {
        min(max((t - start) / (end - start), 0), 1)
    }
}

private enum Easing {
    /// Плавный разгон и торможение — для штриха и заливки.
    static func inOut(_ x: CGFloat) -> CGFloat {
        x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2
    }

    /// Быстрый старт и мягкая посадка — для приближения знака.
    static func out(_ x: CGFloat) -> CGFloat {
        1 - pow(1 - x, 3)
    }
}
