import SwiftUI

/// Экран загрузки — тот же, что заставка веба (`apps/web/src/shared/ui/app-splash.tsx`,
/// globals.css «Заставка запуска»): полотно с вигнеткой, по центру контурная шапочка и
/// «StudentHub», за шапочкой медленно разгорается синий ореол, внизу — подпись.
///
/// Глубина — светом, а не движением: вигнетка уводит края назад, ореол ставит за знаком
/// источник света, тень своего цвета отрывает знак от полотна. Сам знак после короткого
/// появления стоит неподвижно — бегущая дуга читалась бы как индикатор ожидания.
///
/// Первый кадр — системный Launch Screen (`UILaunchScreen` в project.yml, чисто чёрный
/// или белый): край вигнетки почти совпадает с ним, и полотно проступает без скачка.
/// Запуск вид не задерживает: он держится, пока корневому экрану нечего показать
/// (`RootView`).
struct LaunchLoadingView: View {
    @Environment(\.motionReduced) private var reduceMotion
    @State private var markShown = false
    @State private var haloShown = false

    var body: some View {
        ZStack {
            LaunchPalette.vignette
                .ignoresSafeArea()

            HStack(spacing: LaunchMetrics.gap) {
                ZStack {
                    // Ореол — источник света за знаком: радиальный градиент гаснет в
                    // прозрачность задолго до края, заход на «S» читается подсветкой слова.
                    Circle()
                        .fill(
                            RadialGradient(
                                stops: [
                                    .init(color: LaunchPalette.halo1, location: 0),
                                    .init(color: LaunchPalette.halo2, location: 0.38),
                                    .init(color: LaunchPalette.halo3, location: 0.62),
                                    .init(color: .clear, location: 0.78),
                                ],
                                center: .center,
                                startRadius: 0,
                                endRadius: LaunchMetrics.icon * 2
                            )
                        )
                        .frame(width: LaunchMetrics.icon * 4, height: LaunchMetrics.icon * 4)
                        .scaleEffect(haloShown ? 1 : 0.82)
                        .opacity(haloShown ? 1 : 0)
                        .allowsHitTesting(false)

                    GraduationCapOutline()
                        .stroke(
                            LaunchPalette.brand,
                            style: StrokeStyle(
                                lineWidth: LaunchMetrics.icon / 12,
                                lineCap: .round,
                                lineJoin: .round
                            )
                        )
                        .frame(width: LaunchMetrics.icon, height: LaunchMetrics.icon)
                        // Тень своего цвета: на тёмном полотне чёрная невидима, а цветная
                        // читается отсветом знака на поверхности под ним.
                        .shadow(color: LaunchPalette.iconShadow, radius: 12, y: 5.6)
                }
                .frame(width: LaunchMetrics.icon, height: LaunchMetrics.icon)

                Text(verbatim: "StudentHub")
                    .font(.system(size: LaunchMetrics.title, weight: .bold))
                    .tracking(-0.75)
                    .foregroundStyle(LaunchPalette.foreground)
            }
            .scaleEffect(markShown ? 1 : 0.94)
        }
        .overlay(alignment: .bottom) {
            // Подпись внизу — тихим тоном и без движения; имя, марка и год одинаковы во
            // всех языках, как и в вебе.
            Text(verbatim: "© StudentHub 2026 · Мехман Джафари")
                .font(.caption)
                .foregroundStyle(LaunchPalette.muted)
                .padding(.bottom, Spacing.xxl)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "StudentHub"))
        .onAppear {
            guard !reduceMotion else {
                markShown = true
                haloShown = true
                return
            }
            withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.42)) { markShown = true }
            withAnimation(.timingCurve(0.32, 0.72, 0.28, 1, duration: 1.28).delay(0.12)) { haloShown = true }
        }
    }

    /// Уход экрана: полотно растворяется, знак чуть приближается. С «уменьшением
    /// движения» — только растворение: смена прозрачности не движение.
    static func exitTransition(reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 1.04))
    }

    static func exitAnimation(reduceMotion: Bool) -> Animation {
        reduceMotion ? .easeOut(duration: Motion.Duration.layer) : .easeOut(duration: 0.3)
    }
}

/// Цвета заставки — те же литералы, что в globals.css (`.sh-splash` и `.dark .sh-splash`),
/// в обеих темах.
enum LaunchPalette {
    /// Под экраном загрузки, пока поднимается сессия, — край вигнетки: при уходе
    /// заставки не мелькнёт другой цвет.
    static let background = token(light: OKLCH(0.955, 0.004, 264.5), dark: OKLCH(0.142, 0.007, 264.3))

    static let foreground = token(light: OKLCH(0.145, 0, 0), dark: OKLCH(0.967, 0.003, 264.5))
    static let brand = token(light: OKLCH(0.546, 0.215, 262.9), dark: OKLCH(0.573, 0.188, 259.8))
    static let muted = token(light: OKLCH(0.545, 0.023, 264.4), dark: OKLCH(0.714, 0.019, 261.3))

    static let halo1 = token(light: OKLCH(0.546, 0.215, 262.9), dark: OKLCH(0.573, 0.188, 259.8), alpha: (0.18, 0.28))
    static let halo2 = token(light: OKLCH(0.546, 0.215, 262.9), dark: OKLCH(0.573, 0.188, 259.8), alpha: (0.07, 0.1))
    static let halo3 = token(light: OKLCH(0.546, 0.215, 262.9), dark: OKLCH(0.573, 0.188, 259.8), alpha: (0.02, 0.02))
    static let iconShadow = token(light: OKLCH(0.546, 0.215, 262.9), dark: OKLCH(0.573, 0.188, 259.8), alpha: (0.28, 0.45))

    /// Вигнетка, а не заливка: центр чуть светлее, края темнее — полотно становится
    /// пространством, а не плоским прямоугольником (`radial-gradient(120% 90% at 50% 46%)`).
    static var vignette: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let height = proxy.size.height
            // Эллипс с полуосями 120 % ширины и 90 % высоты и центром на 46 % высоты —
            // ровно как в CSS: рамка градиента вдвое больше полуосей, край эллипса — её край.
            EllipticalGradient(
                stops: [
                    .init(color: token(light: OKLCH(1, 0, 0), dark: OKLCH(0.221, 0.014, 264.3)), location: 0),
                    .init(color: token(light: OKLCH(0.985, 0.002, 264.5), dark: OKLCH(0.177, 0.009, 264.3)), location: 0.52),
                    .init(color: Self.background, location: 1),
                ],
                center: .center,
                startRadiusFraction: 0,
                endRadiusFraction: 1
            )
            .frame(width: width * 2.4, height: height * 1.8)
            .position(x: width * 0.5, y: height * 0.46)
        }
        .background(Self.background)
        .clipped()
    }

    private static func token(light: OKLCH, dark: OKLCH, alpha: (Double, Double) = (1, 1)) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? dark.uiColor.withAlphaComponent(alpha.1)
                : light.uiColor.withAlphaComponent(alpha.0)
        })
    }
}

private enum LaunchMetrics {
    /// Иконка `size-12` и текст `text-4xl` веба на широком экране, `size-10`/`text-3xl` — на узком.
    static let icon: CGFloat = 44
    static let title: CGFloat = 33
    static let gap: CGFloat = 18
}

/// Шапочка — тот же контур, что `GraduationCap` из lucide в заставке веба (сетка 24,
/// штрих 2, скруглённые концы и стыки).
private struct GraduationCapOutline: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        let ox = rect.midX - 12 * s
        let oy = rect.midY - 12 * s
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }

        var path = Path()
        // Ромб-верх со скруглёнными углами.
        path.move(to: p(21.42, 10.922))
        path.addQuadCurve(to: p(21.401, 9.084), control: p(22.05, 10))
        path.addLine(to: p(12.83, 5.18))
        path.addQuadCurve(to: p(11.17, 5.18), control: p(12, 4.8))
        path.addLine(to: p(2.6, 9.08))
        path.addQuadCurve(to: p(2.6, 10.912), control: p(1.95, 10))
        path.addLine(to: p(11.17, 14.82))
        path.addQuadCurve(to: p(12.83, 14.82), control: p(12, 15.2))
        path.closeSubpath()
        // Кисточка.
        path.move(to: p(22, 10))
        path.addLine(to: p(22, 16))
        // Тулья: половина эллипса 6 × 3 под ромбом.
        path.move(to: p(6, 12.5))
        path.addLine(to: p(6, 16))
        path.addCurve(to: p(12, 19), control1: p(6, 17.66), control2: p(8.69, 19))
        path.addCurve(to: p(18, 16), control1: p(15.31, 19), control2: p(18, 17.66))
        path.addLine(to: p(18, 12.5))
        return path
    }
}
