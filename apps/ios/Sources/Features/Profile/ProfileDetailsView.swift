import SwiftUI

/// Сведения профиля, которым не место в карточке под шапкой: учёба или работа,
/// навыки и интересы. Контакты — в самой карточке (`ProfileContact`), как телефон и
/// имя пользователя в профиле Telegram.
///
/// Показываем только то, что сервер отдал: чужие почту, телефон и оценки он уже
/// вырезал по правам смотрящего, а пустые поля здесь просто не рисуются.
struct ProfileDetailsView: View {
    let profile: UserProfileDTO
    let isMine: Bool

    @Environment(\.dismiss) private var dismiss

    /// Есть ли что показать — иначе строку «Подробнее» в карточке не рисуют.
    static func hasDetails(_ profile: UserProfileDTO) -> Bool {
        !studyRows(profile).isEmpty || !(profile.skills ?? []).isEmpty || !(profile.interests ?? []).isEmpty
    }

    var body: some View {
        List {
            let study = Self.studyRows(profile)
            if !study.isEmpty {
                Section {
                    ForEach(study, id: \.title) { row in
                        DetailRow(title: row.title, value: row.value, symbol: row.symbol)
                    }
                } header: {
                    Text(profile.role == "TEACHER"
                        ? String(localized: "profile.work", defaultValue: "Работа")
                        : String(localized: "profile.study", defaultValue: "Учёба"))
                }
            }

            if let skills = profile.skills, !skills.isEmpty {
                Section {
                    TagCloud(tags: skills)
                } header: {
                    Text(String(localized: "profile.skills", defaultValue: "Навыки"))
                }
            }

            if let interests = profile.interests, !interests.isEmpty {
                Section {
                    TagCloud(tags: interests)
                } header: {
                    Text(String(localized: "profile.interests", defaultValue: "Интересы"))
                }
            }

            if !Self.hasDetails(profile) {
                EmptyStateView(
                    title: String(localized: "profile.details.empty", defaultValue: "Сведений пока нет"),
                    symbol: "person.text.rectangle",
                    hint: isMine
                        ? String(localized: "profile.details.emptyHint", defaultValue: "Заполните их в «Изменить профиль»")
                        : nil
                )
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(String(localized: "profile.details", defaultValue: "Подробнее")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(String(localized: "common.done", defaultValue: "Готово")) { dismiss() }
            }
        }
    }

    private struct Row {
        let title: String
        let value: String
        let symbol: String
    }

    private static func studyRows(_ profile: UserProfileDTO) -> [Row] {
        var rows: [Row] = []
        func add(_ title: String, _ value: String?, _ symbol: String) {
            if let value, !value.isEmpty { rows.append(Row(title: title, value: value, symbol: symbol)) }
        }
        add(String(localized: "profile.university", defaultValue: "Вуз"), profile.universityName, "building.columns")
        add(String(localized: "profile.faculty", defaultValue: "Факультет"), profile.facultyName, "building.2")
        add(String(localized: "profile.specialty", defaultValue: "Специальность"), profile.specialty, "graduationcap")
        add(String(localized: "profile.group", defaultValue: "Группа"), profile.groupName, "person.3")
        if let course = profile.course {
            add(String(localized: "profile.courseTitle", defaultValue: "Курс"), String(course), "number")
        }
        if let gpa = profile.gpa {
            add(String(localized: "profile.gpa", defaultValue: "Средний балл (GPA)"), gpa.formatted(.number.precision(.fractionLength(2))), "chart.line.uptrend.xyaxis")
        }
        add(String(localized: "profile.position", defaultValue: "Должность"), profile.position, "briefcase")
        add(String(localized: "profile.department", defaultValue: "Кафедра"), profile.department, "building.2")
        add(String(localized: "profile.degree", defaultValue: "Учёная степень"), profile.academicDegree, "rosette")
        add(String(localized: "profile.officeRoom", defaultValue: "Кабинет"), profile.officeRoom, "door.left.hand.open")
        add(String(localized: "profile.officeHours", defaultValue: "Часы приёма"), profile.officeHours, "clock")
        if let languages = profile.languages, !languages.isEmpty {
            add(String(localized: "profile.languages", defaultValue: "Языки"), languages.joined(separator: ", "), "globe")
        }
        return rows
    }
}

/// Контакт в карточке профиля: значок, значение и куда ведёт касание (письмо,
/// звонок, Telegram, сайт).
struct ProfileContact {
    let title: String
    let value: String
    let symbol: String
    let url: URL?

    static func rows(for profile: UserProfileDTO) -> [ProfileContact] {
        var rows: [ProfileContact] = []
        if let phone = profile.phone, !phone.isEmpty {
            let digits = phone.filter { $0.isNumber || $0 == "+" }
            rows.append(ProfileContact(
                title: String(localized: "profile.phone", defaultValue: "Телефон"),
                value: DisplayFormat.phone(phone),
                symbol: "phone",
                url: URL(string: "tel:\(digits)")
            ))
        }
        if let email = profile.email, !email.isEmpty {
            rows.append(ProfileContact(
                title: String(localized: "profile.email", defaultValue: "Почта"),
                value: email,
                symbol: "envelope",
                url: URL(string: "mailto:\(email)")
            ))
        }
        if let telegram = profile.telegram, !telegram.isEmpty {
            let handle = telegram.trimmingCharacters(in: CharacterSet(charactersIn: "@"))
            rows.append(ProfileContact(title: "Telegram", value: "@\(handle)", symbol: "paperplane", url: URL(string: "https://t.me/\(handle)")))
        }
        if let instagram = profile.instagram, !instagram.isEmpty {
            let handle = instagram.trimmingCharacters(in: CharacterSet(charactersIn: "@"))
            rows.append(ProfileContact(title: "Instagram", value: "@\(handle)", symbol: "camera", url: URL(string: "https://instagram.com/\(handle)")))
        }
        if let website = profile.website, !website.isEmpty {
            rows.append(ProfileContact(
                title: String(localized: "profile.website", defaultValue: "Сайт"),
                value: website,
                symbol: "link",
                url: URL(string: website.hasPrefix("http") ? website : "https://\(website)")
            ))
        }
        return rows
    }
}

/// Метки в несколько строк: навыки, интересы. Переносятся целиком, без обрезки.
struct TagCloud: View {
    let tags: [String]

    var body: some View {
        FlowLayout(spacing: Spacing.sm) {
            ForEach(tags, id: \.self) { tag in
                Text(tag)
                    .font(Typography.meta.weight(.medium))
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
                    .background(Palette.primary.opacity(0.12), in: Capsule())
                    .foregroundStyle(Palette.primary)
            }
        }
        .padding(.vertical, Spacing.xs)
    }
}

/// Раскладка «строками с переносом» — как текст, только из вью.
struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxX: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(maxX, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// Сохранённые публикации — та же лента со срезом `filter=SAVED`.
struct SavedPostsView: View {
    @Environment(\.viewerID) private var viewerID
    @State private var feed = FeedModel(api: FeedAPI(scope: .saved))

    var body: some View {
        PostActionsHost(model: feed) { actions in
            ScrollView {
                LazyVStack(spacing: Spacing.lg) {
                    if !feed.posts.isEmpty {
                        ForEach(feed.posts) { post in
                            PostCardView(post: post, model: feed, viewerID: viewerID, actions: actions)
                                .onAppear {
                                    if post.id == feed.posts.last?.id { Task { await feed.loadMore() } }
                                }
                        }
                    }
                }
                .padding(Spacing.xl)
            }
            .screenState(feed.posts.isEmpty) {
                if !feed.hasLoaded {
                    LoadingStateView()
                } else if let failure = feed.failure {
                    ErrorStateView(message: failure, isOffline: feed.isOffline) { await feed.refresh() }
                } else {
                    EmptyStateView(
                        title: String(localized: "saved.empty", defaultValue: "Сохранённого пока нет"),
                        symbol: "bookmark",
                        hint: String(localized: "saved.empty.hint", defaultValue: "Нажмите на закладку под публикацией, чтобы вернуться к ней позже")
                    )
                }
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "saved.title", defaultValue: "Сохранённое")))
        .navigationBarTitleDisplayMode(.inline)
        .pullToRefresh { await feed.refresh() }
        .task { await feed.refresh() }
    }
}
