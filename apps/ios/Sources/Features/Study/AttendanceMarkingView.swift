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
    @State private var query = ""

    static let statuses = ["PRESENT", "LATE", "ABSENT", "EXCUSED"]

    var body: some View {
        List {
            if let failure = model?.failure, model?.isLoaded == true {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let model, model.isLoaded {
                if query.isEmpty {
                    Section {
                        AttendanceMarkingSummary(model: model)
                        Button {
                            model.markAllPresent()
                        } label: {
                            Label(
                                String(localized: "study.markAllPresent", defaultValue: "Все присутствуют"),
                                systemImage: "checkmark.circle.fill"
                            )
                        }
                        .disabled(model.students.isEmpty)
                    } footer: {
                        Text(String(localized: "study.attendance.hint", defaultValue: "Отметьте всех присутствующими и поправьте исключения. Свайп по строке — быстрая отметка, нажатие на имя — примечание."))
                    }
                }

                if model.students.isEmpty {
                    EmptyStateView(
                        title: String(localized: "teaching.attendance.noStudents", defaultValue: "В группе нет студентов"),
                        symbol: "person.3"
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(visibleStudents(model)) { student in
                            studentRow(student, model: model)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(model?.isLoaded != true) {
            if let model, let failure = model.failure {
                // Список не пришёл — не только полоса, но и повтор.
                ErrorStateView(message: failure, isOffline: model.isOffline) { await model.load(keepEdits: true) }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(model?.subject ?? String(localized: "study.attendance", defaultValue: "Посещаемость")))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: Text(String(localized: "group.search", defaultValue: "Найти по имени")))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showsQR = true
                } label: {
                    Image(systemName: "qrcode")
                }
                .accessibilityLabel(Text(String(localized: "teaching.attendance.qr.open", defaultValue: "Показать QR для самоотметки")))
            }
            ToolbarItem(placement: .confirmationAction) {
                if model?.isSaving == true {
                    ProgressView()
                } else {
                    Button {
                        Task { await model?.save() }
                    } label: {
                        Text(String(localized: "common.save", defaultValue: "Сохранить"))
                            .fontWeight(.semibold)
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
        .pullToRefresh { await model?.load(keepEdits: true) }
        .task {
            // `.task` срабатывает и при возврате на экран (переключили вкладку, открыли
            // карточку студента): чистая загрузка там стёрла бы несохранённые отметки.
            if let model {
                if !model.isLoaded { await model.load(keepEdits: true) }
                return
            }
            let created = TeachingAttendanceModel(pairID: pairID, date: date)
            model = created
            await created.load()
        }
    }

    private func visibleStudents(_ model: TeachingAttendanceModel) -> [TeachingAttendanceRosterDTO.Student] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return needle.isEmpty ? model.students : model.students.filter { $0.name.lowercased().contains(needle) }
    }

    /// Студент: аватар и имя (нажатие — примечание), под ним — четыре статуса в одну
    /// дорожку. Свайпы и долгое нажатие — те же статусы, как действия над чатом.
    private func studentRow(_ student: TeachingAttendanceRosterDTO.Student, model: TeachingAttendanceModel) -> some View {
        let current = model.statuses[student.id]
        return VStack(alignment: .leading, spacing: Spacing.md) {
            Button {
                noteText = model.notes[student.id] ?? ""
                noteFor = student
            } label: {
                HStack(spacing: Spacing.lg) {
                    AvatarView(url: student.avatarUrl, name: student.name, size: 40)
                        .overlay(alignment: .bottomTrailing) {
                            if let current {
                                Circle()
                                    .fill(AttendanceStatus.color(current))
                                    .frame(width: 12, height: 12)
                                    .overlay(Circle().stroke(Palette.card, lineWidth: 2))
                                    .accessibilityHidden(true)
                            }
                        }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(student.name)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Palette.foreground)
                            .lineLimit(2)
                        if let note = model.notes[student.id], !note.isEmpty {
                            Label(note, systemImage: "text.bubble")
                                .font(.subheadline)
                                .foregroundStyle(Palette.mutedForeground)
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text(String(localized: "teaching.attendance.note", defaultValue: "Примечание")))

            AttendanceStatusTrack(selection: current) { model.statuses[student.id] = $0 }
        }
        .padding(.vertical, Spacing.xs)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button {
                model.statuses[student.id] = "PRESENT"
            } label: {
                Label(AttendanceStatus.title("PRESENT"), systemImage: "checkmark")
            }
            .tint(Palette.success)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button {
                model.statuses[student.id] = "ABSENT"
            } label: {
                Label(AttendanceStatus.title("ABSENT"), systemImage: "xmark")
            }
            .tint(Palette.destructive)
            Button {
                model.statuses[student.id] = "LATE"
            } label: {
                Label(AttendanceStatus.title("LATE"), systemImage: "clock")
            }
            .tint(Palette.warning)
        }
        .contextMenu {
            ForEach(Self.statuses, id: \.self) { status in
                Button {
                    model.statuses[student.id] = status
                } label: {
                    Label(AttendanceStatus.title(status), systemImage: AttendanceStatus.symbol(status))
                }
            }
            Divider()
            Button {
                noteText = model.notes[student.id] ?? ""
                noteFor = student
            } label: {
                Label(String(localized: "teaching.attendance.note", defaultValue: "Примечание"), systemImage: "text.bubble")
            }
        }
    }
}

/// Сводка ведомости: сколько отмечено и полоса долей по статусам.
private struct AttendanceMarkingSummary: View {
    let model: TeachingAttendanceModel

    var body: some View {
        let total: Int = max(model.students.count, 1)
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                Text(String(localized: "teaching.attendance.markedCount", defaultValue: "Отмечено \(model.markedCount.formatted()) из \(model.students.count.formatted())"))
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
            }
            GeometryReader { proxy in
                HStack(spacing: 2) {
                    ForEach(AttendanceMarkingView.statuses, id: \.self) { status in
                        let count: Int = model.students.filter { model.statuses[$0.id] == status }.count
                        if count > 0 {
                            Rectangle()
                                .fill(AttendanceStatus.color(status))
                                .frame(width: Self.segmentWidth(proxy.size.width, count: count, total: total))
                        }
                    }
                    Spacer(minLength: 0)
                }
                .background(Palette.muted)
                .clipShape(Capsule())
            }
            .frame(height: 8)
            .accessibilityHidden(true)
            HStack(spacing: Spacing.lg) {
                ForEach(AttendanceMarkingView.statuses, id: \.self) { status in
                    let count = model.students.filter { model.statuses[$0.id] == status }.count
                    HStack(spacing: Spacing.xs) {
                        Circle().fill(AttendanceStatus.color(status)).frame(width: 8, height: 8)
                        Text(verbatim: "\(AttendanceStatus.title(status)) \(count.formatted())")
                            .font(.caption)
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(1)
                    }
                }
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

extension AttendanceMarkingSummary {
    /// Ширина доли статуса в полосе; зазор между долями — 2 pt.
    fileprivate static func segmentWidth(_ width: CGFloat, count: Int, total: Int) -> CGFloat {
        let share: CGFloat = CGFloat(count) / CGFloat(max(total, 1))
        let value: CGFloat = width * share - 2
        return Swift.max(value, 2)
    }
}

/// Четыре статуса одной дорожкой, как сегменты: выбранный залит своим цветом.
private struct AttendanceStatusTrack: View {
    let selection: String?
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(AttendanceMarkingView.statuses, id: \.self) { status in
                let isOn = selection == status
                let tint = AttendanceStatus.color(status)
                Button {
                    onSelect(status)
                } label: {
                    Text(AttendanceStatus.title(status))
                        .font(.footnote.weight(isOn ? .semibold : .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.sm)
                        .foregroundStyle(isOn ? Color.white : Palette.mutedForeground)
                        .background(isOn ? tint : Palette.muted, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isOn ? .isSelected : [])
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }
}
