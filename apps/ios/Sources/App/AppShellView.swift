import SwiftUI
import os

/// Оболочка приложения: до пяти вкладок, у каждой свой стек.
///
/// Структура одна на всех — «Главная», «Чаты», «Разделы», «Лента», «Поиск»; роль решает,
/// какие из них у неё есть и что лежит на «Главной» (`AppTab.tabs(for:)`).
///
/// Панель вкладок одна на всё приложение и видна всегда — на корнях вкладок и на всех
/// вложенных экранах: профиле, настройках, правке профиля. При прокрутке она не
/// сворачивается: свёрнутая панель iOS 26 превращалась в одинокий стеклянный круг с
/// иконкой вкладки в углу, который читался как отдельная кнопка «Домой». Прячут панель
/// только полноэкранные сценарии со своей нижней панелью: открытая переписка и выбор
/// чатов в списке. Содержимое панель не перекрывает: прокрутка получает её высоту
/// безопасной областью.
struct AppShellView: View {
    let session: AppSessionModel
    /// Разобранный токен: из него берутся роль для состава разделов и свой
    /// идентификатор — по нему лента отличает свои сообщения от чужих.
    let viewer: AccessToken

    /// Общий маршрутизатор: по нему же ходит переход из уведомления.
    @Bindable private var router = AppServices.router
    @Environment(\.scenePhase) private var scenePhase

    /// Действует ли согласие на обработку ПДн: без него приложение закрыто экраном
    /// согласия, как окном `ConsentGate` в вебе.
    @State private var consent = ConsentGateModel()
    @State private var chatBadge = ChatBadgeModel()
    @State private var viewerProfile = ViewerProfileModel()

    private var role: Role { viewer.role }

    var body: some View {
        tabs
        .tint(Palette.primary)
        .environment(\.viewerID, viewer.subject)
        .environment(\.viewerRole, role)
        .environment(viewerProfile)
        .fullScreenCover(isPresented: Binding(get: { consent.isRequired }, set: { _ in })) {
            ConsentGateView(model: consent, session: session)
        }
        // Первый кадр оболочки — конец холодного старта для человека (App Launch покажет
        // и время до него от запуска процесса).
        .onAppear { Signposts.launch.emitEvent("ShellFirstFrame") }
        .task {
            router.adopt(role: role)
            // Чатов у охраны и библиотеки нет (`hasChats` в вебе): и счётчик им не нужен.
            if !role.isRestricted { chatBadge.start() }
            async let profile: Void = viewerProfile.refresh()
            async let consentState: Void = consent.load()
            _ = await (profile, consentState)
        }
        .task {
            // Соединение живёт, пока человек внутри приложения: вход в него делает
            // сессия, выход — её конец.
            AppServices.realtime.start()
            // Неотправленное с прошлого запуска уходит само, не дожидаясь, пока человек
            // откроет тот чат; дальше — на каждую смену сети.
            await AppServices.outbox.start()
            Task { await AppServices.outbox.kick() }
            // Пуш, нажатый на холодном старте, ждал роли — теперь она есть.
            router.openPending(for: role)
            // Замер плавности ленты (`ScrollBenchmark`, только Debug): чат открывается сам —
            // ссылка через `simctl openurl` упиралась в системный вопрос «Открыть в…».
            if let chat = ScrollBenchmark.chatToOpen {
                _ = router.open(.chat(id: chat), for: role)
            }
            // Разрешение спрашиваем здесь, а не на экране входа: до входа уведомлять
            // человека не о чем, и запрос выглядел бы попрошайничеством.
            await PushRegistrar().requestAuthorization()
            await AppServices.pushSync.catchUp()
        }
        // Ссылку, которую приложение не знает, не перехватываем: её откроет браузер,
        // где работает полная версия.
        .onOpenURL { url in
            router.open(url, for: role)
        }
        // Вернулись в приложение: сокет, порванный в фоне, поднимаем сразу, а
        // пропущенное за это время догоняем — пуши могли прийти не все.
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: AppLifecycle.shared.enterBackground()
            case .active: AppLifecycle.shared.becomeActive()
            default: break
            }
            guard phase == .active else { return }
            Task {
                await AppServices.realtime.resume()
                await AppServices.pushSync.catchUp()
                await AppServices.outbox.kick()
            }
        }
        // Сокет поднялся заново — связь есть: досылаем то, что не ушло без неё.
        .onChange(of: AppServices.realtime.connectionEpoch) {
            Task { await AppServices.outbox.kick() }
        }
    }

    /// Панель вкладок. С iOS 18 — API вкладок (`Tab`): поиск становится отдельной кнопкой
    /// у края панели, на iOS 26 — стеклянной, как в приложениях Apple. На iOS 17 —
    /// прежние `tabItem`.
    @ViewBuilder
    private var tabs: some View {
        if #available(iOS 18, *) {
            TabView(selection: tabSelection) {
                ForEach(AppTab.tabs(for: role)) { tab in
                    Tab(value: tab, role: tab == .search ? .search : nil) {
                        stack(for: tab)
                    } label: {
                        Label(tab.title, systemImage: tab.symbol)
                    }
                    // Ноль бейдж прячет: у остальных вкладок счётчика нет.
                    .badge(tab == .chats ? chatBadge.unread : 0)
                }
            }
        } else {
            TabView(selection: tabSelection) {
                ForEach(AppTab.tabs(for: role)) { tab in
                    stack(for: tab)
                        .tabItem {
                            Label(tab.title, systemImage: tab.symbol)
                        }
                        .badge(tab == .chats ? chatBadge.unread : 0)
                        .tag(tab)
                }
            }
        }
    }

    /// Выбор вкладки. Нажатие на уже открытую вкладку возвращает её стек к корню, как в
    /// Telegram и системных приложениях: `TabView` зовёт сеттер и с тем же значением, а
    /// у `NavigationStack` с внешним `path` сама система этого не делает.
    private var tabSelection: Binding<AppTab> {
        Binding(
            get: { router.selectedTab },
            set: { tab in
                if tab == router.selectedTab {
                    guard !router.path(for: tab).routes.isEmpty else { return }
                    // Переход назад анимирует сам стек — своей кривой ему не нужно.
                    router.popToRoot(tab)
                } else {
                    router.selectedTab = tab
                }
            }
        )
    }

    /// Стек вкладки: у каждой свой путь, профиль в верхней панели корня.
    private func stack(for tab: AppTab) -> some View {
        NavigationStack(path: Bindable(router.path(for: tab)).routes) {
            root(for: tab)
                // В чатах левый край занят «Изм.», как в Telegram: профиль — с других вкладок.
                .profileToolbarItem(isHidden: tab == .chats)
                // Как в Telegram: компактный заголовок по центру панели, кнопки по краям
                // в стекле. Вложенные экраны наследуют режим (`.automatic`).
                .navigationBarTitleDisplayMode(.inline)
                .softTopEdge()
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                        .softTopEdge()
                }
        }
    }

    @ViewBuilder
    private func root(for tab: AppTab) -> some View {
        switch tab {
        case .home:
            RoleHomeView(role: role)
        case .chats:
            ChatListView()
        case .workspace:
            WorkspaceView(role: role)
        case .feed:
            FeedView(role: role)
        case .search:
            SearchView()
        }
    }

    @ViewBuilder
    private func destination(for route: AppRoute) -> some View {
        switch route {
        case .section(.grades):
            StudentGradesView()
        case .section(.attendance):
            StudentAttendanceView()
        case .section(.assignments):
            AssignmentsView(isStudent: role != .teacher)
        case .section(.materials):
            MaterialsView()
        case .section(.notifications):
            NotificationsView(role: role)
        case .section(.events):
            EventsView()
        case .section(.profile):
            ProfileView(userID: nil)
        case .section(.applications):
            ApplicationsView()
        case .section(.serviceCatalog):
            ServiceCatalogView()
        case .section(.documents):
            DocumentsView()
        case .section(.library):
            LibraryCatalogView()
        case .section(.settings):
            SettingsView(session: session)
        case .section(.schedule):
            // У декана расписание — весь факультет: без выбора группы общий дневной вид
            // смешал бы сотни пар. Его раздел — расписание факультета, как `/dean/schedule`.
            if role == .dean {
                DeanScreen.schedule.destination
            } else {
                ScheduleView()
            }
        case .section(.consultations):
            ConsultationsView(role: role)
        case .section(.deanery):
            DeaneryView()
        case .section(.portfolio):
            PortfolioView()
        case .section(.subjects):
            CoursesView(role: role)
        case .section(.groups):
            TeacherGroupsView()
        case .section(.classmates):
            // «Одногруппники» — у старосты это его «Моя группа»: тот же состав группы
            // плюс его действия. Старые ссылки ведут туда же, второго экрана нет.
            StarostaScreen.myGroup.destination
        case .section(.campusMap):
            CampusMapView()
        case .chat(let id):
            ChatThreadView(chatID: id, viewerID: viewer.subject)
        case .post(let id):
            PostDetailView(postID: id)
        case .profile(let id):
            // Своё имя в шапке поста или в комментарии ведёт в свой профиль — с «Изменить»
            // и настройками, а не в чужой с «Написать» самому себе.
            ProfileView(userID: id == viewer.subject ? nil : id)
        case .application(let id):
            ApplicationDetailView(applicationID: id)
        case .service(let id):
            ApplicationFormView(serviceID: id)
        case .event(let id):
            CommunityScreen.event(id: id).destination
        case .lesson(let id, let date):
            // Преподаватель с занятия идёт отмечать посещаемость — это главное,
            // зачем он вообще открывает пару на телефоне.
            if role == .teacher {
                AttendanceMarkingView(pairID: id, date: date ?? Date())
            } else {
                LessonDetailView(pairID: id, date: date ?? Date())
            }
        case .assignment(let id):
            AssignmentDetailView(assignmentID: id, isStudent: role != .teacher)
        case .myBooks:
            MyBooksView()
        case .libraryClearance:
            LibraryClearanceView()
        case .book(let id):
            LibraryBookView(bookID: id)
        case .bookCopy(let code):
            LibraryCopyView(code: code)
        case .search:
            SearchView()
        case .chatInfo(let id):
            ChatInfoView(chatID: id)
        case .campusRoom(let roomID):
            CampusMapView(focusRoomID: roomID)
        case .legal(let document):
            LegalDocumentView(inApp: document)
        case .student(let screen):
            screen.destination
        case .community(let screen):
            screen.destination
        case .teacher(let screen):
            screen.destination
        case .starosta(let screen):
            screen.destination
        case .career(let screen):
            screen.destination
        case .dean(let screen):
            screen.destination
        case .uniAdmin(let screen):
            screen.destination
        case .staff(let screen):
            screen.destination
        case .admin(let screen):
            screen.destination
        case .security(let screen):
            screen.destination
        case .librarian(let screen):
            screen.destination
        }
    }
}

/// Кто смотрит: своё от чужого отличают лента, комментарии и истории. Ключ окружения,
/// а не параметр — иначе id протаскивался бы через каждый промежуточный экран.
private struct ViewerIDKey: EnvironmentKey {
    static let defaultValue = ""
}

extension EnvironmentValues {
    var viewerID: String {
        get { self[ViewerIDKey.self] }
        set { self[ViewerIDKey.self] = newValue }
    }
}
