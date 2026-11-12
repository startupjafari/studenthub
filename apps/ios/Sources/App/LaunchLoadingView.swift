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
            // С «уменьшением движения» плитка сразу стоит на месте: ни прорисовки, ни
            // приближения — только конечный кадр.
            LaunchTile(progress: reduceMotion ? 1 : progress, size: LaunchMetrics.tile)
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
        reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 1.08))
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
    /// Фирменный синий плитки: на чисто чёрном и чисто белом читается одинаково.
    static let mark = AuthPalette.brandBlue
    /// Светлый край градиента плитки — тот же синий, приподнятый к свету.
    static let markLight = Color(red: 92 / 255, green: 156 / 255, blue: 1)
    /// Тёмный край — синий, уведённый в глубину.
    static let markDeep = Color(red: 28 / 255, green: 88 / 255, blue: 204 / 255)
}

private enum LaunchMetrics {
    /// Плитка как иконка на рабочем столе: человек узнаёт её с первого кадра.
    static let tile: CGFloat = 112
    static let duration: TimeInterval = 0.9
}

/// Плитка знака, как иконка приложения: скругление в пропорции иконок iOS с плавными
/// (continuous) углами, синий градиент от света к глубине, мягкий блик сверху, тонкая
/// светлая кромка и синее свечение под плиткой. Сначала проявляется плитка, затем
/// внутри прорисовывается белый знак.
private struct LaunchTile: View, Animatable {
    var progress: CGFloat
    var size: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    /// Доля скругления у иконок iOS.
    private static let cornerRatio: CGFloat = 0.2237

    var body: some View {
        let appear = Easing.out(DrawnGlyph.segment(progress, 0, 0.4))
        let shape = RoundedRectangle(cornerRadius: size * Self.cornerRatio, style: .continuous)
        ZStack {
            shape.fill(
                LinearGradient(
                    colors: [LaunchPalette.markLight, LaunchPalette.mark, LaunchPalette.markDeep],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            // Блик сверху — свет падает на плитку, как на стекло иконки.
            shape.fill(
                LinearGradient(
                    colors: [.white.opacity(0.22), .white.opacity(0)],
                    startPoint: .top,
                    endPoint: .center
                )
            )
            shape.strokeBorder(.white.opacity(0.16), lineWidth: 1)
            DrawnGlyph(progress: DrawnGlyph.segment(progress, 0.15, 1), size: size * 0.6)
                .frame(width: size * 0.6, height: size * 0.6)
        }
        .frame(width: size, height: size)
        .shadow(color: LaunchPalette.mark.opacity(0.35 * appear), radius: size * 0.22, y: size * 0.09)
        .scaleEffect(0.86 + 0.14 * appear)
        .opacity(appear)
    }
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
                    .stroke(.white, style: StrokeStyle(lineWidth: size / 24 * 0.7, lineCap: .round, lineJoin: .round))
            }
            .opacity(1 - fill)
            StudentHubGlyph()
                .fill(.white)
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
    static func segment(_ t: CGFloat, _ start: CGFloat, _ end: CGFloat) -> CGFloat {
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
