#if DEBUG
    import SwiftUI

    /// Витрина дизайн-ядра: цвет, типографика, радиусы, движение — на устройстве,
    /// в обеих темах и на всех кеглях Dynamic Type. Аналог `/_dev/design-system`
    /// из веба; в релизную сборку не попадает.
    struct TokenGalleryView: View {
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @State private var nudged = false

        private let surfaces: [(String, Color)] = [
            ("background", Palette.background),
            ("card", Palette.card),
            ("muted", Palette.muted),
            ("border", Palette.border),
        ]

        private let actions: [(String, Color)] = [
            ("primary", Palette.primary),
            ("secondary", Palette.secondary),
            ("accent", Palette.accent),
            ("ring", Palette.ring),
        ]

        private let statuses: [(String, Color)] = [
            ("success", Palette.success),
            ("warning", Palette.warning),
            ("info", Palette.info),
            ("destructive", Palette.destructive),
        ]

        var body: some View {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.xxl) {
                        swatches("Поверхности", surfaces)
                        swatches("Действия", actions)
                        swatches("Статусы", statuses)
                        typography
                        radii
                        motion
                    }
                    .padding(Spacing.xl)
                }
                .background(Palette.background)
                .navigationTitle(Text(verbatim: "Дизайн-ядро"))
            }
        }

        private func swatches(_ title: String, _ items: [(String, Color)]) -> some View {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text(verbatim: title)
                    .font(Typography.sectionTitle)
                    .foregroundStyle(Palette.foreground)
                ForEach(items, id: \.0) { name, color in
                    HStack(spacing: Spacing.lg) {
                        RoundedRectangle(cornerRadius: Radius.md)
                            .fill(color)
                            .overlay(
                                RoundedRectangle(cornerRadius: Radius.md)
                                    .strokeBorder(Palette.border, lineWidth: 1)
                            )
                            .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                        Text(verbatim: name)
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                    }
                }
            }
        }

        private var typography: some View {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(verbatim: "Типографика").font(Typography.sectionTitle)
                Text(verbatim: "Заголовок экрана").font(Typography.pageTitle)
                Text(verbatim: "Заголовок секции").font(Typography.sectionTitle)
                Text(verbatim: "Основной текст").font(Typography.body)
                Text(verbatim: "Вторичный текст").font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                Text(verbatim: "1 234").font(Typography.tabular(Typography.metric))
            }
            .foregroundStyle(Palette.foreground)
        }

        private var radii: some View {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text(verbatim: "Радиусы").font(Typography.sectionTitle)
                    .foregroundStyle(Palette.foreground)
                HStack(spacing: Spacing.lg) {
                    ForEach([Radius.sm, Radius.md, Radius.xl, Radius.xxl], id: \.self) { radius in
                        RoundedRectangle(cornerRadius: radius)
                            .strokeBorder(Palette.input, lineWidth: 1)
                            .frame(width: ControlHeight.island, height: ControlHeight.island)
                    }
                }
            }
        }

        private var motion: some View {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text(verbatim: "Движение").font(Typography.sectionTitle)
                    .foregroundStyle(Palette.foreground)
                RoundedRectangle(cornerRadius: Radius.xl)
                    .fill(Palette.primary)
                    .frame(width: ControlHeight.island, height: ControlHeight.island)
                    .offset(x: nudged ? 120 : 0)
                Button {
                    withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
                        nudged.toggle()
                    }
                } label: {
                    Text(verbatim: "Толкнуть пружиной")
                        .font(Typography.body)
                        .frame(height: ControlHeight.lg)
                        .padding(.horizontal, Spacing.xl)
                        .background(Palette.secondary, in: RoundedRectangle(cornerRadius: Radius.xl))
                        .foregroundStyle(Palette.secondaryForeground)
                }
            }
        }
    }
#endif
