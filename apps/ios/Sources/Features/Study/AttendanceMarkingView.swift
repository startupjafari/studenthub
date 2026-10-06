import SwiftUI

/// Отметка посещаемости преподавателем.
///
/// Экран сделан под один жест: пришли все, кроме двоих. Поэтому сверху кнопка
/// «все присутствуют», а дальше правятся исключения — так короче, чем отмечать
/// тридцать человек по одному.
struct AttendanceMarkingView: View {
    let pairID: String

    @State private var model: AttendanceMarkingModel?

    private static let statuses = ["PRESENT", "LATE", "ABSENT", "EXCUSED"]

    var body: some View {
        List {
            if let failure = model?.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            Section {
                Button {
                    model?.markAllPresent()
                } label: {
                    Label(
                        String(localized: "study.markAllPresent", defaultValue: "Все присутствуют"),
                        systemImage: "checkmark.circle.fill"
                    )
                }
            }
            .listRowBackground(Palette.card)

            ForEach(model?.students ?? []) { student in
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text(student.name)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                    HStack(spacing: Spacing.sm) {
                        ForEach(Self.statuses, id: \.self) { status in
                            Button {
                                model?.set(status, for: student.id)
                            } label: {
                                Text(AttendanceStatus.title(status))
                                    .font(Typography.meta)
                                    .padding(.horizontal, Spacing.md)
                                    .frame(height: ControlHeight.sm)
                                    .background(
                                        model?.statuses[student.id] == status
                                            ? AttendanceStatus.color(status).opacity(0.15)
                                            : Palette.muted,
                                        in: Capsule()
                                    )
                                    .foregroundStyle(
                                        model?.statuses[student.id] == status
                                            ? AttendanceStatus.color(status)
                                            : Palette.mutedForeground
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.vertical, Spacing.xs)
                .listRowBackground(Palette.card)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "study.attendance", defaultValue: "Посещаемость")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await model?.save() }
                } label: {
                    Text(String(localized: "common.save", defaultValue: "Сохранить"))
                }
                .disabled(model?.isSaving ?? true)
            }
        }
        .task {
            if model == nil {
                model = AttendanceMarkingModel(pairID: pairID)
            }
            await model?.load()
        }
    }
}
