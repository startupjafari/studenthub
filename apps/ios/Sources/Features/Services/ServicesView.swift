import SwiftUI

/// Вкладка «Сервисы»: каталог разделов веба, сгруппированный по смыслу, с поиском.
///
/// Состав разделов берётся из одного места с разбором диплинков
/// (`MoreSection.sections(for:)`) — иначе ссылка открывала бы раздел, которого в
/// списке нет, и наоборот. Группы — только подача: роль решает, что в них попадёт,
/// пустая группа не рисуется.
struct ServicesView: View {
    let session: AppSessionModel
    let role: Role

    /// Включённые вузом модули: пункт выключенного не показываем вовсе.
    @State private var enabledModules: Set<MoreSection> = []
    @State private var query = ""

    var body: some View {
        List {
            ForEach(visibleGroups, id: \.group) { entry in
                Section {
                    ForEach(entry.sections) { section in
                        NavigationLink(value: AppRoute.section(section)) {
                            IconRow(
                                title: section.title,
                                symbol: section.symbol,
                                tint: ServiceGroup.tint(for: section),
                                subtitle: query.isEmpty ? ServiceGroup.hint(for: section) : nil
                            )
                        }
                        .accessibilityIdentifier("services.\(section.rawValue)")
                    }
                } header: {
                    Text(entry.group.title)
                }
                .listRowBackground(Palette.card)
            }

            if visibleGroups.isEmpty {
                EmptyStateView(
                    title: String(localized: "services.notFound", defaultValue: "Ничего не нашлось"),
                    symbol: "magnifyingglass",
                    hint: String(localized: "services.notFound.hint", defaultValue: "Попробуйте другое слово")
                )
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(AppTab.services.title))
        .searchable(
            text: $query,
            prompt: Text(String(localized: "services.search", defaultValue: "Поиск сервиса"))
        )
        .task { await loadModules() }
    }

    /// Разделы роли и включённые модули.
    private var sections: [MoreSection] {
        MoreSection.sections(for: role) + MoreSection.modules(for: role).filter(enabledModules.contains)
    }

    private var visibleGroups: [(group: ServiceGroup, sections: [MoreSection])] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let matching = sections.filter { section in
            needle.isEmpty
                || section.title.lowercased().contains(needle)
                || (ServiceGroup.hint(for: section)?.lowercased().contains(needle) ?? false)
        }
        return ServiceGroup.allCases.compactMap { group in
            let items = group.order.filter(matching.contains)
            return items.isEmpty ? nil : (group, items)
        }
    }

    /// Спрашиваем при каждом показе вкладки: админ вуза включает модуль, когда
    /// захочет, и пункт должен появиться без перезапуска приложения. Отказ сети пункт
    /// не прячет — прошлое знание лучше мигания.
    private func loadModules() async {
        guard MoreSection.modules(for: role).contains(.library) else { return }
        guard let settings = try? await LibraryAPI().settings() else { return }
        if settings.enabled {
            enabledModules.insert(.library)
        } else {
            enabledModules.remove(.library)
        }
    }
}

/// Группы каталога. Порядок внутри группы задан здесь, а не ролью: одинаковые
/// разделы у разных ролей стоят на одних местах.
enum ServiceGroup: CaseIterable {
    case university
    case documents
    case growth
    case community
    case account

    var title: String {
        switch self {
        case .university: return String(localized: "services.group.university", defaultValue: "Университет")
        case .documents: return String(localized: "services.group.documents", defaultValue: "Документы и заявки")
        case .growth: return String(localized: "services.group.growth", defaultValue: "Личное развитие")
        case .community: return String(localized: "services.group.community", defaultValue: "Сообщество")
        case .account: return String(localized: "services.group.account", defaultValue: "Аккаунт")
        }
    }

    var order: [MoreSection] {
        switch self {
        case .university: return [.deanery, .consultations, .campusMap, .subjects, .groups]
        case .documents: return [.applications, .serviceCatalog, .documents, .library]
        case .growth: return [.portfolio]
        case .community: return [.events, .classmates]
        case .account: return [.profile, .settings]
        }
    }

    static func tint(for section: MoreSection) -> Color {
        switch section {
        case .deanery: return TileTint.indigo
        case .consultations: return TileTint.teal
        case .campusMap: return TileTint.green
        case .applications, .serviceCatalog: return TileTint.blue
        case .documents: return TileTint.orange
        case .library: return TileTint.yellow
        case .portfolio: return TileTint.purple
        case .events: return TileTint.red
        case .classmates, .groups, .subjects: return TileTint.teal
        case .profile: return TileTint.blue
        default: return TileTint.gray
        }
    }

    /// Подсказка под названием: по ней же ищет поиск — «справка» находит заявки.
    static func hint(for section: MoreSection) -> String? {
        switch section {
        case .deanery:
            return String(localized: "services.deanery.hint", defaultValue: "Запись на приём")
        case .consultations:
            return String(localized: "services.consultations.hint", defaultValue: "Запись к преподавателю")
        case .campusMap:
            return String(localized: "services.campusMap.hint", defaultValue: "Корпуса, этажи, аудитории")
        case .applications:
            return String(localized: "services.applications.hint", defaultValue: "Справки и обращения")
        case .serviceCatalog:
            return String(localized: "services.catalog.hint", defaultValue: "Все услуги вуза")
        case .documents:
            return String(localized: "services.documents.hint", defaultValue: "Ваши файлы и запросы")
        case .library:
            return String(localized: "services.library.hint", defaultValue: "Каталог и мои книги")
        case .portfolio:
            return String(localized: "services.portfolio.hint", defaultValue: "Опыт, проекты, сертификаты")
        case .events:
            return String(localized: "services.events.hint", defaultValue: "Мероприятия и запись")
        default:
            return nil
        }
    }
}
