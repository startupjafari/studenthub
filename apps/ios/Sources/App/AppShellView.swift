import SwiftUI

/// Оболочка приложения: пять вкладок, у каждой свой стек.
///
/// Наполнение вкладок приходит из ролей, а структура — нет: ни одна роль MVP не
/// теряет и не добавляет вкладку.
struct AppShellView: View {
    let session: AppSessionModel
    /// Разобранный токен: из него берутся роль для состава разделов и свой
    /// идентификатор — по нему лента отличает свои сообщения от чужих.
    let viewer: AccessToken

    /// Общий маршрутизатор: по нему же ходит переход из уведомления.
    @Bindable private var router = AppServices.router

    /// Действует ли согласие на обработку ПДн: без него приложение закрыто экраном
    /// согласия, как окном `ConsentGate` в вебе.
    @State private var consent = ConsentGateModel()
    @State private var chatBadge = ChatBadgeModel()
    @State private var viewerProfile = ViewerProfileModel()

    private var role: Role { viewer.role }

    var body: some View {
        tabs
        .minimizesTabBarOnScroll()
        .tint(Palette.primary)
        .environment(\.viewerID, viewer.subject)
        .environment(\.viewerRole, role)
        .environment(viewerProfile)
        .fullScreenCover(isPresented: Binding(get: { consent.isRequired }, set: { _ in })) {
            ConsentGateView(model: consent, session: session)
        }
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
            // Пуш, нажатый на холодном старте, ждал роли — теперь она есть.
            router.openPending(for: role)
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
    }

    /// Панель вкладок. С iOS 18 — API вкладок (`Tab`): поиск становится отдельной кнопкой
    /// у края панели, на iOS 26 — стеклянной, как в приложениях Apple. На iOS 17 —
    /// прежние `tabItem`.
    @ViewBuilder
    private var tabs: some View {
        if #available(iOS 18, *) {
            TabView(selection: $router.selectedTab) {
                ForEach(AppTab.tabs(for: role)) { tab in
                    Tab(value: tab, role: tab == .search ? .search : nil) {
                        stack(for: tab)
                    } label: {
                        Label(tab.title(for: role), systemImage: tab.symbol(for: role))
                    }
                    // Ноль бейдж прячет: у остальных вкладок счётчика нет.
                    .badge(tab == .chats ? chatBadge.unread : 0)
                }
            }
        } else {
            TabView(selection: $router.selectedTab) {
                ForEach(AppTab.tabs(for: role)) { tab in
                    stack(for: tab)
                        .tabItem {
                            Label(tab.title(for: role), systemImage: tab.symbol(for: role))
                        }
                        .badge(tab == .chats ? chatBadge.unread : 0)
                        .tag(tab)
                }
            }
        }
    }

    /// Стек вкладки: у каждой свой путь, профиль в верхней панели корня.
    private func stack(for tab: AppTab) -> some View {
        NavigationStack(path: $router.stacks.stack(for: tab)) {
            root(for: tab)
                .profileToolbarItem()
                .frostedTopBar()
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                        .frostedTopBar()
                }
        }
    }

    @ViewBuilder
    private func root(for tab: AppTab) -> some View {
        switch tab {
        case .chats:
            ChatListView()
        case .schedule:
            // У декана расписание — весь факультет: без выбора группы общий дневной вид
            // смешал бы сотни пар. Его вкладка — расписание факультета, как `/dean/schedule`.
            if role == .dean {
                DeanScreen.schedule.destination
            } else {
                ScheduleView()
            }
        case .study:
            StudyView(role: role)
        case .home:
            HomeView(role: role)
        case .services:
            ServicesView(session: session, role: role)
        case .dashboard:
            RoleDashboardView(role: role)
        case .workspace:
            WorkspaceView(role: role)
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
            ClassmatesView()
        case .section(.campusMap):
            CampusMapView()
        case .chat(let id):
            ChatThreadView(chatID: id, viewerID: viewer.subject)
        case .post(let id):
            PostDetailView(postID: id)
        case .profile(let id):
            ProfileView(userID: id)
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
