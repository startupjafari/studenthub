import SwiftUI

/// Отметка посещаемости преподавателем.
///
/// Экран сделан под один жест: пришли все, кроме двоих. Поэтому сверху кнопка
/// «все присутствуют», а дальше правятся исключения — так короче, чем отмечать
/// тридцать человек по одному. Примечание — по нажатию на имя, QR для самоотметки —
/// в панели: так же, как ведомость занятия в вебе.
struct AttendanceMarkingView: View {
    let pairID: String
    /// День занятия — тот, что выбран в расписании.
    var date = Date()

    @State private var model: TeachingAttendanceModel?
    @State private var showsQR = false
    @State private var noteFor: TeachingAttendanceRosterDTO.Student?
    @State private var noteText = ""

    private static let statuses = ["PRESENT", "LATE", "ABSENT", "EXCUSED"]

    var body: some View {
        List {
            if let failure = model?.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let model, model.isLoaded {
                Section {
                    Button {
                        model.markAllPresent()
                    } label: {
                        Label(
                            String(localized: "study.markAllPresent", defaultValue: "Все присутствуют"),
                            systemImage: "checkmark.circle.fill"
                        )
                    }
                    Button {
                        showsQR = true
                    } label: {
                        Label(
                            String(localized: "teaching.attendance.qr.open", defaultValue: "Показать QR для самоотметки"),
                            systemImage: "qrcode"
                        )
                    }
                } footer: {
                    Text(String(localized: "teaching.attendance.markedCount", defaultValue: "Отмечено \(model.markedCount.formatted()) из \(model.students.count.formatted())"))
                }

                if model.students.isEmpty {
                    EmptyStateView(
                        title: String(localized: "teaching.attendance.noStudents", defaultValue: "В группе нет студентов"),
                        symbol: "person.3"
                    )
                    .listRowBackground(Color.clear)
                }

                ForEach(model.students) { student in
                    studentRow(student, model: model)
                }
            } else if model?.failure == nil {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(model?.subject ?? String(localized: "study.attendance", defaultValue: "Посещаемость")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if model?.isSaving == true {
                    ProgressView()
                } else {
                    Button {
                        Task { await model?.save() }
                    } label: {
                        Text(String(localized: "common.save", defaultValue: "Сохранить"))
                    }
                    .disabled(model?.statuses.isEmpty ?? true)
                }
            }
        }
        .sheet(isPresented: $showsQR) {
            TeachingAttendanceQRView(pairID: pairID, date: date) {
                await model?.load(keepEdits: true)
            }
        }
        .reasonPrompt(
            Binding(get: { noteFor != nil }, set: { if !$0 { noteFor = nil } }),
            title: noteFor?.name ?? "",
            placeholder: String(localized: "teaching.attendance.note", defaultValue: "Примечание"),
            actionTitle: String(localized: "teaching.done", defaultValue: "Готово"),
            text: $noteText
        ) {
            if let student = noteFor { model?.notes[student.id] = noteText }
            noteFor = nil
        }
        .sensoryFeedback(.success, trigger: model?.savedAt)
        .refreshable { await model?.load(keepEdits: true) }
        .task {
            if model == nil {
                model = TeachingAttendanceModel(pairID: pairID, date: date)
            }
            await model?.load()
        }
    }

    private func studentRow(_ student: TeachingAttendanceRosterDTO.Student, model: TeachingAttendanceModel) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Button {
                noteText = model.notes[student.id] ?? ""
                noteFor = student
            } label: {
                HStack(spacing: Spacing.md) {
                    AvatarView(url: student.avatarUrl, name: student.name, size: 28)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(student.name)
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                        if let note = model.notes[student.id], !note.isEmpty {
                            Text(note)
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "text.bubble")
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .accessibilityLabel(Text(String(localized: "teaching.attendance.note", defaultValue: "Примечание")))
                }
            }
            .buttonStyle(.plain)
            HStack(spacing: Spacing.sm) {
                ForEach(Self.statuses, id: \.self) { status in
                    let isOn = model.statuses[student.id] == status
                    Button {
                        model.statuses[student.id] = status
                    } label: {
                        Text(AttendanceStatus.title(status))
                            .font(Typography.meta)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .padding(.horizontal, Spacing.md)
                            .padding(.vertical, Spacing.sm)
                            .background(isOn ? AttendanceStatus.color(status).opacity(0.15) : Palette.muted, in: Capsule())
                            .foregroundStyle(isOn ? AttendanceStatus.color(status) : Palette.mutedForeground)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isOn ? .isSelected : [])
                }
            }
        }
        .padding(.vertical, Spacing.xs)
    }
}
