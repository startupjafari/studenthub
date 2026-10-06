import SwiftUI

/// Оболочка приложения: пять вкладок, у каждой свой стек.
///
/// Наполнение вкладок приходит из ролей, а структура — нет: ни одна роль MVP не
/// теряет и не добавляет вкладку. Экраны разделов появятся в Ф1–Ф4; пока за
/// вкладками стоят заглушки, и это видно по названию.
struct AppShellView: View {
    let session: AppSessionModel
    /// Разобранный токен: из него берутся роль для состава разделов и свой
    /// идентификатор — по нему лента отличает свои сообщения от чужих.
    let viewer: AccessToken

    @State private var router = AppRouter()

    private var role: Role { viewer.role }

    var body: some View {
        TabView(selection: $router.selectedTab) {
            ForEach(AppTab.allCases) { tab in
                NavigationStack(path: $router.stacks.stack(for: tab)) {
                    root(for: tab)
                        .navigationDestination(for: AppRoute.self) { route in
                            destination(for: route)
                        }
                }
                .tabItem {
                    Label(tab.title, systemImage: tab.symbol)
                }
                .tag(tab)
            }
        }
        .tint(Palette.primary)
        .task {
            // Соединение живёт, пока человек внутри приложения: вход в него делает
            // сессия, выход — её конец.
            AppServices.realtime.start()
        }
        // Ссылку, которую приложение не знает, не перехватываем: её откроет браузер,
        // где работает полная версия.
        .onOpenURL { url in
            router.open(url, for: role)
        }
    }

    @ViewBuilder
    private func root(for tab: AppTab) -> some View {
        switch tab {
        case .chats:
            ChatListView()
        case .more:
            MoreView(session: session, role: role)
        default:
            PlaceholderScreen(title: tab.title)
        }
    }

    @ViewBuilder
    private func destination(for route: AppRoute) -> some View {
        switch route {
        case .section(let section):
            PlaceholderScreen(title: section.title)
        case .chat(let id):
            ChatThreadView(chatID: id, viewerID: viewer.subject)
        case .post(let id):
            PlaceholderScreen(title: String(localized: "shell.post", defaultValue: "Публикация"), reference: id)
        case .application(let id):
            PlaceholderScreen(title: String(localized: "shell.application", defaultValue: "Заявка"), reference: id)
        case .event(let id):
            PlaceholderScreen(title: String(localized: "shell.event", defaultValue: "Событие"), reference: id)
        case .lesson(let id):
            PlaceholderScreen(title: String(localized: "shell.lesson", defaultValue: "Пара"), reference: id)
        }
    }
}

/// Путь внутри вкладки хранится в словаре, а `NavigationStack` просит привязку к
/// массиву. Этот переходник и есть вся разница между ними.
extension Binding where Value == [AppTab: [AppRoute]] {
    func stack(for tab: AppTab) -> Binding<[AppRoute]> {
        Binding<[AppRoute]>(
            get: { wrappedValue[tab] ?? [] },
            set: { wrappedValue[tab] = $0 }
        )
    }
}

/// Заглушка раздела. Нужна до Ф1–Ф4 и исчезнет вместе с ними: пустой экран без
/// объяснения человек читает как поломку.
struct PlaceholderScreen: View {
    let title: String
    var reference: String?

    var body: some View {
        VStack(spacing: Spacing.md) {
            Text(title)
                .font(Typography.pageTitle)
                .foregroundStyle(Palette.foreground)
            Text(String(
                localized: "shell.placeholder",
                defaultValue: "Этот раздел появится в следующем обновлении"
            ))
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
            .multilineTextAlignment(.center)
            #if DEBUG
                // Идентификатор из ссылки — единственный способ убедиться, что
                // диплинк довёл до нужной записи, пока экрана записи нет.
                if let reference {
                    Text(verbatim: reference)
                        .font(Typography.tabular(Typography.meta))
                        .foregroundStyle(Palette.mutedForeground)
                }
            #endif
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
        .navigationTitle(Text(title))
        .navigationBarTitleDisplayMode(.inline)
    }
}
