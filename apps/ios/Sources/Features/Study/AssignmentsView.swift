import SwiftUI

/// Задания студента: что сдано, что на проверке, что просрочено.
struct AssignmentsView: View {
    @State private var model = StudySectionModel<[AssignmentDTO]> {
        try await StudyAPI().assignments().items
    }
    @State private var busyID: String?

    private let api = StudyAPI()

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            ForEach(model.value ?? []) { assignment in
                NavigationLink(value: AppRoute.assignment(id: assignment.id)) {
                    AssignmentRow(assignment: assignment)
                }
                .listRowBackground(Palette.card)
            }

            if model.value?.isEmpty ?? false {
                EmptyRow(text: String(localized: "study.noAssignments", defaultValue: "Заданий пока нет"))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "study.assignments", defaultValue: "Задания")))
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
    }
}

private struct AssignmentRow: View {
    let assignment: AssignmentDTO

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(assignment.title)
                .font(Typography.cardTitle)
                .foregroundStyle(Palette.foreground)

            HStack(spacing: Spacing.md) {
                if let subject = assignment.subject {
                    Text(subject)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                if let dueAt = assignment.dueAt {
                    Label(
                        dueAt.formatted(date: .abbreviated, time: .shortened),
                        systemImage: "clock"
                    )
                    .font(Typography.meta)
                    // Просроченное выделяем цветом: это единственное, что человек
                    // ищет в списке глазами.
                    .foregroundStyle(dueAt < Date() ? Palette.destructive : Palette.mutedForeground)
                }
            }

            Text(SubmissionState.of(assignment).title)
                .font(Typography.meta)
                .foregroundStyle(Palette.primary)
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

/// Карточка задания со сдачей: текст и ссылка — то, что принимает сервер.
struct AssignmentDetailView: View {
    let assignmentID: String

    @State private var model: StudySectionModel<[AssignmentDTO]>?
    @State private var text = ""
    @State private var link = ""
    @State private var isSending = false
    @State private var failure: String?

    private let api = StudyAPI()

    private var assignment: AssignmentDTO? {
        model?.value?.first { $0.id == assignmentID }
    }

    var body: some View {
        Form {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
            }

            if let assignment {
                Section {
                    Text(assignment.title)
                        .font(Typography.sectionTitle)
                    if let description = assignment.description, !description.isEmpty {
                        Text(description)
                            .font(Typography.body)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    Text(SubmissionState.of(assignment).title)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.primary)
                }
                .listRowBackground(Palette.card)

                Section {
                    TextField(text: $text, axis: .vertical) {
                        Text(verbatim: String(localized: "study.answer", defaultValue: "Ответ"))
                    }
                    .lineLimit(3...10)
                    TextField(text: $link) {
                        Text(verbatim: String(localized: "study.link", defaultValue: "Ссылка"))
                    }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)

                    Button {
                        Task { await submit() }
                    } label: {
                        Text(isSending
                            ? String(localized: "study.sending", defaultValue: "Отправляем…")
                            : String(localized: "study.submit", defaultValue: "Сдать работу"))
                    }
                    .disabled(isSending)
                } header: {
                    Text(String(localized: "study.yourWork", defaultValue: "Ваша работа"))
                }
                .listRowBackground(Palette.card)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "study.assignment", defaultValue: "Задание")))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if model == nil {
                model = StudySectionModel<[AssignmentDTO]> { try await StudyAPI().assignments().items }
            }
            await model?.refresh()
            if let submission = assignment?.mySubmission {
                text = submission.text ?? ""
                link = submission.linkUrl ?? ""
            }
        }
    }

    /// Сначала сохраняем черновик, потом отправляем: на сервере это два шага, и
    /// отправка без сохранения отправила бы пустую работу.
    private func submit() async {
        guard !isSending else { return }
        isSending = true
        defer { isSending = false }
        do {
            try await api.saveSubmissionDraft(
                assignmentID: assignmentID,
                text: text.isEmpty ? nil : text,
                linkURL: link.isEmpty ? nil : link
            )
            try await api.submit(assignmentID: assignmentID)
            await model?.refresh()
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }
}

/// Материалы: список с файлами, открытие — системным просмотрщиком по ссылке.
struct MaterialsView: View {
    @State private var model = StudySectionModel<[MaterialDTO]> {
        try await StudyAPI().materials().items
    }

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            ForEach(model.value ?? []) { material in
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(material.title)
                        .font(Typography.cardTitle)
                    if let subject = material.subject {
                        Text(subject)
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(material.files ?? []) { file in
                        Label(
                            file.name ?? String(localized: "chats.file", defaultValue: "Файл"),
                            systemImage: "doc"
                        )
                        .font(Typography.meta)
                        .foregroundStyle(Palette.primary)
                    }
                }
                .padding(.vertical, Spacing.xs)
                .listRowBackground(Palette.card)
            }

            if model.value?.isEmpty ?? false {
                EmptyRow(text: String(localized: "study.noMaterials", defaultValue: "Материалов пока нет"))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "study.materials", defaultValue: "Материалы")))
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
    }
}
