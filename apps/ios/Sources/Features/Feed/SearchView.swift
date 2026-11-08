import SwiftUI

/// Поиск из верхней панели главной: люди и события.
///
/// Курсы, задания и материалы веб тоже находит, но их экраны в приложении живут в
/// «Учёбе», и переход из поиска в чужую вкладку путал бы навигацию. Поэтому здесь —
/// то, что открывается во вкладке «Главная».
struct SearchView: View {
    @State private var query = ""
    @State private var results: SearchResultsDTO?
    @State private var isSearching = false
    @State private var failure: String?

    private let api: FeedFetching = FeedAPI()

    var body: some View {
        List {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let people = results?.people, !people.isEmpty {
                Section(String(localized: "search.section.people", defaultValue: "Люди")) {
                    ForEach(people) { person in
                        NavigationLink(value: AppRoute.profile(id: person.id)) {
                            HStack(spacing: Spacing.lg) {
                                AvatarView(url: person.avatarUrl, name: person.name, size: 36)
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(person.name.isEmpty ? (person.username ?? "") : person.name)
                                        .foregroundStyle(Palette.foreground)
                                    if let role = person.role.flatMap(Role.init(rawValue:))?.feedTitle {
                                        Text(role)
                                            .font(Typography.meta)
                                            .foregroundStyle(Palette.mutedForeground)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let events = results?.events, !events.isEmpty {
                Section(String(localized: "more.events", defaultValue: "События")) {
                    ForEach(events) { event in
                        NavigationLink(value: AppRoute.community(.event(id: event.id))) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(event.title).foregroundStyle(Palette.foreground)
                                Text(event.startsAt, format: .dateTime.day().month().hour().minute())
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                        }
                    }
                }
            }
        }
        .overlay {
            if isEmpty, !isSearching {
                ContentUnavailableView(
                    query.trimmingCharacters(in: .whitespaces).count < 2
                        ? String(localized: "search.hint", defaultValue: "Введите хотя бы две буквы")
                        : String(localized: "search.empty", defaultValue: "Никого не нашли"),
                    systemImage: "magnifyingglass"
                )
            } else if isSearching, isEmpty {
                ProgressView()
            }
        }
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text(String(localized: "search.prompt", defaultValue: "Люди и события"))
        )
        .navigationTitle(Text(String(localized: "search.title", defaultValue: "Поиск")))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: query) { await search() }
    }

    private var isEmpty: Bool {
        (results?.people ?? []).isEmpty && (results?.events ?? []).isEmpty
    }

    /// Запрос — после паузы в наборе: на каждую букву сервер не дёргаем.
    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            results = nil
            failure = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        isSearching = true
        defer { isSearching = false }
        do {
            results = try await api.search(String(trimmed.prefix(100)))
            failure = nil
        } catch {
            guard !Task.isCancelled else { return }
            failure = (error as? APIError)?.displayMessage
        }
    }
}
