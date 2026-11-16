import SwiftUI

/// Кольцо с долей выполненного — загрузка файлов, отправка, долгая операция на экране.
/// Пустое кольцо — дорожка, заполненная часть — фирменный цвет; доля растёт плавно.
struct ProgressRing: View {
    /// 0…1.
    let progress: Double
    var lineWidth: CGFloat = 2.5

    @Environment(\.motionReduced) private var reduceMotion

    var body: some View {
        ZStack {
            Circle()
                .stroke(Palette.muted, lineWidth: lineWidth)
            Circle()
                // Чуть-чуть с самого начала: видно, что работа пошла.
                .trim(from: 0, to: max(0.04, min(progress, 1)))
                .stroke(Palette.primary, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .animation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion), value: progress)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(localized: "common.loading", defaultValue: "Загрузка")))
        .accessibilityValue(Text(progress, format: .percent.precision(.fractionLength(0))))
    }
}

extension View {
    /// Заголовок экрана, а слева от него — кольцо загрузки, пока что-то грузится
    /// (`progress` 0…1; `nil` — ничего не грузится). Состояние видно в шапке, где его ищут,
    /// и не сдвигает содержимое экрана строкой «Загружаем…».
    func navigationTitle(_ title: String, progress: Double?) -> some View {
        modifier(NavigationTitleProgress(title: title, progress: progress))
    }
}

private struct NavigationTitleProgress: ViewModifier {
    let title: String
    let progress: Double?

    @Environment(\.motionReduced) private var reduceMotion

    func body(content: Content) -> some View {
        content
            // Заголовок для стрелки «назад» следующего экрана и для VoiceOver.
            .navigationTitle(Text(title))
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: Spacing.sm) {
                        if let progress {
                            ProgressRing(progress: progress)
                                .frame(width: 16, height: 16)
                                .transition(.scale(scale: 0.5).combined(with: .opacity))
                        }
                        Text(title)
                            .font(.headline)
                            .foregroundStyle(Palette.foreground)
                            .lineLimit(1)
                    }
                    .animation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion), value: progress != nil)
                }
            }
    }
}
