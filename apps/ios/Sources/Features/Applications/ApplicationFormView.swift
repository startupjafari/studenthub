import SwiftUI

/// Подача заявки на услугу.
///
/// Форма строится по ответу сервера, а не по захардкоженным полям: состав полей
/// задаёт вуз, и каждая новая услуга иначе требовала бы релиза приложения.
struct ApplicationFormView: View {
    let serviceID: String

    @Environment(\.dismiss) private var dismiss

    @State private var service: ServiceDTO?
    @State private var draft: ApplicationDTO?
    @State private var values: [String: String] = [:]
    @State private var isSubmitting = false
    @State private var failure: String?
    @State private var submitted = false

    private let api = ApplicationsAPI()

    var body: some View {
        Form {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
            }

            if submitted {
                Section {
                    Label(
                        String(localized: "applications.sent", defaultValue: "Заявка подана"),
                        systemImage: "checkmark.circle.fill"
                    )
                    .foregroundStyle(Palette.success)
                }
                .listRowBackground(Palette.card)
            }

            if let service {
                Section {
                    Text(service.name).font(Typography.sectionTitle)
                    if let description = service.description, !description.isEmpty {
                        Text(description)
                            .font(Typography.body)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                .listRowBackground(Palette.card)

                Section {
                    ForEach(service.formFields ?? []) { field in
                        FormFieldView(
                            field: field,
                            value: Binding(
                                get: { values[field.key] ?? "" },
                                set: { values[field.key] = $0 }
                            )
                        )
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        Text(isSubmitting
                            ? String(localized: "applications.sending", defaultValue: "Отправляем…")
                            : String(localized: "applications.submit", defaultValue: "Подать заявку"))
                    }
                    .disabled(isSubmitting || submitted || !isComplete)
                } footer: {
                    if !isComplete {
                        Text(String(
                            localized: "applications.fillRequired",
                            defaultValue: "Заполните обязательные поля"
                        ))
                    }
                }
                .listRowBackground(Palette.card)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "applications.new", defaultValue: "Заказать услугу")))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var isComplete: Bool {
        (service?.formFields ?? [])
            .filter { $0.required == true }
            .allSatisfy { !(values[$0.key] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private func load() async {
        do {
            service = try await api.service(id: serviceID)
            // Черновик заводим сразу: человек может уйти с экрана и вернуться, а
            // заполненное останется на сервере, а не пропадёт вместе с экраном.
            draft = try await api.createDraft(serviceID: serviceID)
            values = draft?.formData ?? [:]
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }

    private func submit() async {
        guard let draft, !isSubmitting else { return }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await api.updateDraft(id: draft.id, formData: values)
            try await api.submit(id: draft.id)
            submitted = true
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }
}

/// Одно поле формы. Тип приходит с сервера, и под каждый — свой контрол: дата
/// текстом приводит к тому, что половина заявок возвращается на уточнение.
private struct FormFieldView: View {
    let field: FormFieldDTO
    @Binding var value: String

    var body: some View {
        switch field.type {
        case "SELECT":
            Picker(selection: $value) {
                Text(verbatim: "—").tag("")
                ForEach(field.options ?? [], id: \.self) { option in
                    Text(option).tag(option)
                }
            } label: {
                Text(label)
            }
        case "DATE":
            DatePicker(
                selection: Binding(
                    get: { ISO8601DateFormatter().date(from: value) ?? Date() },
                    set: { value = ISO8601DateFormatter().string(from: $0) }
                ),
                displayedComponents: .date
            ) {
                Text(label)
            }
        case "TEXTAREA":
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(label).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                TextField(text: $value, axis: .vertical) { Text(verbatim: field.label) }
                    .lineLimit(3...8)
            }
        case "NUMBER":
            HStack {
                Text(label)
                Spacer()
                TextField(text: $value) { Text(verbatim: field.label) }
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
            }
        default:
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(label).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                TextField(text: $value) { Text(verbatim: field.label) }
            }
        }
    }

    /// Звёздочка у обязательного поля — единственный способ объяснить, почему
    /// кнопка не нажимается, до того как человек на неё нажмёт.
    private var label: String {
        field.required == true ? "\(field.label) *" : field.label
    }
}

/// Карточка заявки: статус, история и выданный документ.
struct ApplicationDetailView: View {
    let applicationID: String

    @State private var application: ApplicationDTO?
    @State private var failure: String?

    private let api = ApplicationsAPI()
    private var realtime: RealtimeCoordinator { AppServices.realtime }

    var body: some View {
        List {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let application {
                Section {
                    Text(application.serviceName ?? String(
                        localized: "applications.service",
                        defaultValue: "Услуга"
                    ))
                    .font(Typography.sectionTitle)
                    Text(ApplicationStatus.title(application.status))
                        .font(Typography.body)
                        .foregroundStyle(
                            ApplicationStatus.isOpen(application.status)
                                ? Palette.primary
                                : Palette.mutedForeground
                        )
                }
                .listRowBackground(Palette.card)

                if let history = application.history, !history.isEmpty {
                    Section {
                        ForEach(history) { event in
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Text(ApplicationStatus.title(event.status))
                                    .font(Typography.body)
                                if let comment = event.comment, !comment.isEmpty {
                                    Text(comment)
                                        .font(Typography.meta)
                                        .foregroundStyle(Palette.mutedForeground)
                                }
                                Text(verbatim: event.createdAt.formatted(date: .abbreviated, time: .shortened))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                            .padding(.vertical, Spacing.xs)
                        }
                    } header: {
                        Text(String(localized: "applications.history", defaultValue: "История"))
                    }
                    .listRowBackground(Palette.card)
                }

                if application.documentId != nil {
                    Section {
                        NavigationLink(value: AppRoute.section(.documents)) {
                            Label(
                                String(localized: "applications.openDocument", defaultValue: "Готовый документ"),
                                systemImage: "doc.text"
                            )
                        }
                    }
                    .listRowBackground(Palette.card)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "shell.application", defaultValue: "Заявка")))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: realtime.applicationStatus) {
            // Статус сменился на сервере — перечитываем карточку, не трогая экран.
            Task { await load() }
        }
    }

    private func load() async {
        do {
            application = try await api.application(id: applicationID)
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }
}
