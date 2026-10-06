import SwiftUI

/// Мои заявки: что подано и в каком состоянии.
///
/// Статусы приезжают в реальном времени (`application.status.changed`): человек
/// ждёт справку и не должен обновлять экран, чтобы узнать, что она готова.
struct ApplicationsView: View {
    @State private var model = StudySectionModel<[ApplicationDTO]> {
        try await ApplicationsAPI().applications().items
    }

    private var realtime: RealtimeCoordinator { AppServices.realtime }

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            Section {
                NavigationLink(value: AppRoute.section(.serviceCatalog)) {
                    Label(
                        String(localized: "applications.new", defaultValue: "Заказать услугу"),
                        systemImage: "plus.circle"
                    )
                }
            }
            .listRowBackground(Palette.card)

            Section {
                ForEach(model.value ?? []) { application in
                    NavigationLink(value: AppRoute.application(id: application.id)) {
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(application.serviceName ?? String(
                                localized: "applications.service",
                                defaultValue: "Услуга"
                            ))
                            .font(Typography.cardTitle)
                            HStack(spacing: Spacing.md) {
                                Text(ApplicationStatus.title(application.status))
                                    .font(Typography.meta)
                                    .foregroundStyle(
                                        ApplicationStatus.isOpen(application.status)
                                            ? Palette.primary
                                            : Palette.mutedForeground
                                    )
                                Text(verbatim: application.createdAt.formatted(date: .abbreviated, time: .omitted))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                        }
                    }
                }

                if model.value?.isEmpty ?? false {
                    EmptyRow(text: String(localized: "applications.empty", defaultValue: "Заявок пока нет"))
                }
            } header: {
                Text(String(localized: "applications.mine", defaultValue: "Мои заявки"))
            }
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "more.applications", defaultValue: "Заявки")))
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
        .onChange(of: realtime.applicationStatus) {
            Task { await model.refresh() }
        }
    }
}

/// Каталог услуг: категории и услуги внутри них.
struct ServiceCatalogView: View {
    @State private var model = StudySectionModel<[ServiceCategoryDTO]> {
        try await ApplicationsAPI().categories()
    }

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            ForEach(model.value ?? []) { category in
                Section {
                    ForEach(category.services) { service in
                        NavigationLink(value: AppRoute.service(id: service.id)) {
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Text(service.name)
                                    .font(Typography.body)
                                if let days = service.processingDays {
                                    Text(String(
                                        localized: "applications.days",
                                        defaultValue: "Срок: \(days) раб. дн."
                                    ))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                                }
                            }
                        }
                    }
                } header: {
                    Text(category.name)
                }
                .listRowBackground(Palette.card)
            }

            if model.value?.isEmpty ?? false {
                EmptyRow(text: String(
                    localized: "applications.noServices",
                    defaultValue: "Вуз пока не завёл услуги"
                ))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "applications.catalog", defaultValue: "Каталог услуг")))
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.refresh() }
    }
}
