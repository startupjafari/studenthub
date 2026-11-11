import SwiftUI

// Актуальное историй: полоса в профиле, список с правкой, просмотр, добавление
// истории в актуальное и «кто посмотрел» (`/stories/highlights/*`, `/stories/:id/viewers`).

// MARK: - Полоса в профиле

/// Кружки актуального под шапкой профиля. Пустая полоса не рисуется вовсе.
struct CommunityHighlightsStrip: View {
    let userID: String

    @State private var highlights: [CommunityHighlightDTO] = []
    @State private var playing: CommunityHighlightTarget?
    /// Чья полоса уже загружена. Полоса живёт в ленивом стеке профиля и появляется
    /// заново при каждом возврате к верху — перезапрашивать её при этом незачем.
    @State private var loadedFor: String?

    var body: some View {
        Group {
            if !highlights.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: Spacing.lg) {
                        ForEach(highlights) { highlight in
                            Button {
                                playing = CommunityHighlightTarget(id: highlight.id)
                            } label: {
                                CommunityHighlightBubble(highlight: highlight)
                            }
                            .buttonStyle(.plain)
                        }
                        NavigationLink(value: AppRoute.community(.highlights(userID: userID))) {
                            VStack(spacing: Spacing.xs) {
                                Image(systemName: "ellipsis")
                                    .font(.title3)
                                    .frame(width: 60, height: 60)
                                    .background(Palette.muted, in: Circle())
                                Text(String(localized: "home.all", defaultValue: "Все"))
                                    .font(.caption)
                            }
                            .foregroundStyle(Palette.mutedForeground)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, Spacing.xl)
                }
            }
        }
        .task(id: userID) {
            guard !userID.isEmpty, loadedFor != userID else { return }
            // Сбой не запоминаем: при следующем появлении полоса спросит снова.
            guard let loaded = try? await CommunityAPI().highlights(ownerID: userID) else { return }
            highlights = loaded
            loadedFor = userID
        }
        .fullScreenCover(item: $playing) { target in
            CommunityHighlightPlayer(highlightID: target.id) {
                Task { highlights = (try? await CommunityAPI().highlights(ownerID: userID)) ?? [] }
            }
        }
    }
}

struct CommunityHighlightTarget: Identifiable, Hashable {
    let id: String
}

private struct CommunityHighlightBubble: View {
    let highlight: CommunityHighlightDTO

    var body: some View {
        VStack(spacing: Spacing.xs) {
            cover
                .frame(width: 60, height: 60)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(Palette.border, lineWidth: 2))
            Text(highlight.title)
                .font(.caption)
                .foregroundStyle(Palette.foreground)
                .lineLimit(1)
                .frame(maxWidth: 72)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var cover: some View {
        if let media = highlight.cover?.media {
            let url = media.poster?.first?.url ?? media.sources?.first?.url ?? media.url
            RemoteImage(url: url.flatMap(URL.init(string:)), cacheKey: "highlight:\(media.id)", placeholder: media.placeholder)
        } else {
            ZStack {
                StoryBackground.gradient(highlight.cover?.background)
                Text(verbatim: String((highlight.cover?.text ?? highlight.title).prefix(2)))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
            }
        }
    }
}

// MARK: - Список

struct CommunityHighlightsView: View {
    let userID: String

    @Environment(\.viewerID) private var viewerID
    @State private var highlights: [CommunityHighlightDTO]?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var playing: CommunityHighlightTarget?
    @State private var editingID: CommunityHighlightTarget?
    @State private var deleting: CommunityHighlightDTO?
    @State private var actionFailure: String?

    private let api = CommunityAPI()
    private var isMine: Bool { userID == viewerID }

    var body: some View {
        List {
            if let highlights {
                if highlights.isEmpty {
                    EmptyStateView(
                        title: String(localized: "community.highlights.empty", defaultValue: "Актуального пока нет"),
                        symbol: "sparkles",
                        hint: isMine
                            ? String(localized: "community.highlights.empty.hint", defaultValue: "Откройте свою историю и выберите «В актуальное» — она останется в профиле")
                            : nil
                    )
                    .centeredInScreen()
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                } else {
                    Section {
                        ForEach(highlights) { highlight in
                            Button {
                                playing = CommunityHighlightTarget(id: highlight.id)
                            } label: {
                                HStack(spacing: Spacing.lg) {
                                    CommunityHighlightBubble(highlight: highlight)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(highlight.title).font(.body.weight(.semibold)).foregroundStyle(Palette.foreground)
                                        Text(String(localized: "community.highlights.count", defaultValue: "Историй: \((highlight.itemsCount ?? 0).formatted())"))
                                            .font(Typography.meta)
                                            .foregroundStyle(Palette.mutedForeground)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                            .swipeActions {
                                if isMine {
                                    Button(role: .destructive) {
                                        deleting = highlight
                                    } label: {
                                        Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                                    }
                                    Button {
                                        editingID = CommunityHighlightTarget(id: highlight.id)
                                    } label: {
                                        Label(String(localized: "feed.edit", defaultValue: "Редактировать"), systemImage: "pencil")
                                    }
                                }
                            }
                            .contextMenu {
                                if isMine {
                                    Button {
                                        editingID = CommunityHighlightTarget(id: highlight.id)
                                    } label: {
                                        Label(String(localized: "feed.edit", defaultValue: "Редактировать"), systemImage: "pencil")
                                    }
                                    Button(role: .destructive) {
                                        deleting = highlight
                                    } label: {
                                        Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                                    }
                                }
                            }
                        }
                        .onMove(perform: isMine ? move : nil)
                    } footer: {
                        if isMine, highlights.count > 1 {
                            Text(String(localized: "community.highlights.reorder", defaultValue: "Порядок меняется кнопкой «Править»"))
                        }
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(CommunityScreen.highlights(userID: userID).title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isMine, (highlights?.count ?? 0) > 1 {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .fullScreenCover(item: $playing) { target in
            CommunityHighlightPlayer(highlightID: target.id) { Task { await load() } }
        }
        .sheet(item: $editingID) { target in
            CommunityHighlightEditor(highlightID: target.id) { Task { await load() } }
        }
        .confirmDestructive(
            $deleting,
            title: { String(localized: "community.highlights.delete.title", defaultValue: "Удалить «\($0.title)»?") },
            actionTitle: String(localized: "feed.delete", defaultValue: "Удалить")
        ) { highlight in
            do {
                try await api.deleteHighlight(id: highlight.id)
                highlights?.removeAll { $0.id == highlight.id }
            } catch {
                actionFailure = error.userMessage
            }
        }
        .actionFailureAlert($actionFailure)
    }

    @MainActor
    private func load() async {
        do {
            highlights = try await api.highlights(ownerID: userID)
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    private func move(from source: IndexSet, to destination: Int) {
        guard var list = highlights else { return }
        let snapshot = list
        list.move(fromOffsets: source, toOffset: destination)
        highlights = list
        Task {
            do {
                try await api.reorderHighlights(ids: list.map(\.id))
            } catch {
                highlights = snapshot
                actionFailure = error.userMessage
            }
        }
    }
}

// MARK: - Правка

/// Название, обложка, состав и порядок историй одного актуального.
struct CommunityHighlightEditor: View {
    let highlightID: String
    let changed: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var detail: CommunityHighlightDetailDTO?
    @State private var title = ""
    /// Ошибка действия — над формой; ошибка загрузки — на месте формы, с повтором.
    @State private var failure: String?
    @State private var loadFailure: String?
    @State private var isOffline = false

    private let api = CommunityAPI()

    var body: some View {
        NavigationStack {
            List {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if let detail {
                    Section {
                        TextField(String(localized: "community.highlights.title", defaultValue: "Название"), text: $title)
                        Button(String(localized: "community.highlights.rename", defaultValue: "Сохранить название")) {
                            Task { await rename() }
                        }
                        .disabled(trimmed.isEmpty || trimmed.count > 30 || trimmed == detail.title)
                    }

                    Section {
                        ForEach(detail.items) { item in
                            HStack(spacing: Spacing.lg) {
                                CommunityStoryCanvas(story: item, paused: true, muted: true)
                                    .frame(width: 45, height: 80)
                                    .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                                    .allowsHitTesting(false)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(DisplayFormat.dateTime(item.createdAt))
                                        .font(Typography.body)
                                    if detail.coverItemId == item.id {
                                        Text(String(localized: "community.highlights.isCover", defaultValue: "Обложка"))
                                            .font(Typography.meta)
                                            .foregroundStyle(Palette.primary)
                                    }
                                }
                                Spacer()
                            }
                            .swipeActions {
                                Button(role: .destructive) {
                                    Task { await remove(item) }
                                } label: {
                                    Label(String(localized: "community.highlights.removeItem", defaultValue: "Убрать"), systemImage: "minus.circle")
                                }
                                Button {
                                    Task { await setCover(item) }
                                } label: {
                                    Label(String(localized: "community.highlights.makeCover", defaultValue: "Сделать обложкой"), systemImage: "photo")
                                }
                                .tint(Palette.primary)
                            }
                        }
                        .onMove(perform: move)
                    } header: {
                        Text(String(localized: "community.highlights.items", defaultValue: "Истории"))
                    } footer: {
                        Text(String(localized: "community.highlights.items.hint", defaultValue: "Смахните влево, чтобы убрать историю или сделать её обложкой"))
                    }
                } else if let loadFailure {
                    ErrorStateView(message: loadFailure, isOffline: isOffline) { await load() }
                        .listRowBackground(Color.clear)
                } else {
                    LoadingStateView().listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .environment(\.editMode, .constant(.active))
            .navigationTitle(Text(String(localized: "feed.edit", defaultValue: "Редактировать")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "common.done", defaultValue: "Готово")) {
                        changed()
                        dismiss()
                    }
                }
            }
            .task { await load() }
        }
    }

    private var trimmed: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }

    @MainActor
    private func load() async {
        do {
            let loaded = try await api.highlight(id: highlightID)
            detail = loaded
            title = loaded.title
            loadFailure = nil
        } catch is CancellationError {
            return
        } catch {
            loadFailure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func rename() async {
        do {
            detail = try await api.renameHighlight(id: highlightID, title: trimmed)
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func setCover(_ item: StoryDTO) async {
        do {
            detail = try await api.setHighlightCover(id: highlightID, itemID: item.id)
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func remove(_ item: StoryDTO) async {
        do {
            let removedAll = try await api.removeFromHighlight(id: highlightID, itemID: item.id)
            if removedAll {
                changed()
                dismiss()
            } else {
                detail?.items.removeAll { $0.id == item.id }
            }
        } catch {
            failure = error.userMessage
        }
    }

    private func move(from source: IndexSet, to destination: Int) {
        guard var items = detail?.items else { return }
        let snapshot = items
        items.move(fromOffsets: source, toOffset: destination)
        detail?.items = items
        Task {
            do {
                try await api.reorderHighlightItems(id: highlightID, ids: items.map(\.id))
            } catch {
                detail?.items = snapshot
                failure = error.userMessage
            }
        }
    }
}

// MARK: - Просмотр

/// Полноэкранный просмотр актуального: те же кадры, что у историй, без реакций и ответа.
struct CommunityHighlightPlayer: View {
    let highlightID: String
    var changed: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @Environment(\.viewerID) private var viewerID
    @State private var detail: CommunityHighlightDetailDTO?
    @State private var failure: String?
    @State private var index = 0
    @State private var progress: Double = 0
    @State private var holding = false
    @State private var muted = false
    @State private var editing = false

    private static let frameSeconds = 6.0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let detail, detail.items.indices.contains(index) {
                let story = detail.items[index]
                CommunityStoryCanvas(story: story, paused: holding || editing, muted: muted)
                    .ignoresSafeArea()
                    .overlay(tapZones(count: detail.items.count))
                    .overlay(alignment: .top) { header(detail) }
                    .id(story.id)
                    .task(id: story.id) { await run(story, count: detail.items.count) }
            } else if let failure {
                VStack(spacing: Spacing.lg) {
                    Text(failure).foregroundStyle(.white).multilineTextAlignment(.center)
                    RetryButton { await load() }
                    Button(String(localized: "common.close", defaultValue: "Закрыть")) { dismiss() }
                        .foregroundStyle(.white)
                }
                .padding(Spacing.xxl)
            } else {
                ProgressView().tint(.white)
            }
        }
        .statusBarHidden()
        .preferredColorScheme(.dark)
        .task { await load() }
        .sheet(isPresented: $editing, onDismiss: {
            Task { await load() }
        }) {
            CommunityHighlightEditor(highlightID: highlightID) { changed() }
        }
    }

    private func header(_ detail: CommunityHighlightDetailDTO) -> some View {
        VStack(spacing: Spacing.md) {
            HStack(spacing: Spacing.xs) {
                ForEach(detail.items.indices, id: \.self) { item in
                    GeometryReader { proxy in
                        Capsule().fill(.white.opacity(0.3))
                            .overlay(alignment: .leading) {
                                Capsule().fill(.white)
                                    .frame(width: proxy.size.width * (item < index ? 1 : item > index ? 0 : min(progress, 1)))
                            }
                    }
                    .frame(height: 2.5)
                }
            }
            .accessibilityHidden(true)
            HStack(spacing: Spacing.md) {
                AvatarView(url: detail.owner.avatar, name: detail.owner.name, size: 32)
                VStack(alignment: .leading, spacing: 0) {
                    Text(detail.title).font(Typography.meta.weight(.semibold)).lineLimit(1)
                    Text(DisplayFormat.date(detail.items[index].createdAt)).font(.caption2).opacity(0.8)
                }
                Spacer()
                if detail.items[index].media?.mime?.hasPrefix("video/") == true {
                    Button {
                        muted.toggle()
                    } label: {
                        Image(systemName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                            .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                    }
                    .accessibilityLabel(Text(String(localized: "stories.sound", defaultValue: "Звук")))
                }
                if detail.canEdit == true || detail.owner.id == viewerID {
                    Button {
                        editing = true
                    } label: {
                        Image(systemName: "pencil")
                            .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                    }
                    .accessibilityLabel(Text(String(localized: "feed.edit", defaultValue: "Редактировать")))
                }
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                }
                .accessibilityLabel(Text(String(localized: "common.close", defaultValue: "Закрыть")))
            }
            .foregroundStyle(.white)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.top, Spacing.md)
        .background(
            LinearGradient(colors: [.black.opacity(0.45), .clear], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
        )
    }

    private func tapZones(count: Int) -> some View {
        HStack(spacing: 0) {
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { if index > 0 { index -= 1 } else { progress = 0 } }
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { advance(count: count) }
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in holding = true }
                .onEnded { value in
                    holding = false
                    if value.translation.height > 120 { dismiss() }
                }
        )
    }

    private func advance(count: Int) {
        if index + 1 < count { index += 1 } else { dismiss() }
    }

    private func run(_ story: StoryDTO, count: Int) async {
        progress = 0
        let seconds = story.media?.durationMs.map { min(Double($0) / 1000, 120) } ?? Self.frameSeconds
        let step = 0.05
        while progress < 1 {
            try? await Task.sleep(for: .milliseconds(Int(step * 1000)))
            if Task.isCancelled { return }
            if !holding && !editing { progress += step / max(seconds, 1) }
        }
        advance(count: count)
    }

    @MainActor
    private func load() async {
        do {
            let loaded = try await CommunityAPI().highlight(id: highlightID)
            if loaded.items.isEmpty { return dismiss() }
            detail = loaded
            failure = nil
            index = min(index, loaded.items.count - 1)
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Добавить историю в актуальное

struct CommunityHighlightPicker: View {
    let storyID: String
    let ownerID: String

    @Environment(\.dismiss) private var dismiss
    @State private var highlights: [CommunityHighlightDTO]?
    /// Список актуального не загрузился — секция «существующее» не пропадает молча.
    @State private var listFailure: String?
    @State private var newTitle = ""
    @State private var failure: String?
    @State private var busy = false
    @State private var done = 0

    private let api = CommunityAPI()

    var body: some View {
        NavigationStack {
            List {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    TextField(String(localized: "community.highlights.newTitle", defaultValue: "Название нового актуального"), text: $newTitle)
                    Button(String(localized: "community.highlights.create", defaultValue: "Создать и добавить")) {
                        Task { await run { _ = try await api.createHighlight(title: trimmed, storyID: storyID) } }
                    }
                    .disabled(trimmed.isEmpty || trimmed.count > 30 || busy)
                } header: {
                    Text(String(localized: "community.highlights.new", defaultValue: "Новое"))
                }

                if let highlights, !highlights.isEmpty {
                    Section {
                        ForEach(highlights) { highlight in
                            Button {
                                Task { await run { _ = try await api.addToHighlight(id: highlight.id, storyID: storyID) } }
                            } label: {
                                HStack(spacing: Spacing.lg) {
                                    CommunityHighlightBubble(highlight: highlight)
                                    Spacer()
                                    Image(systemName: "plus.circle").foregroundStyle(Palette.primary)
                                }
                            }
                            .buttonStyle(.plain)
                            .disabled(busy)
                        }
                    } header: {
                        Text(String(localized: "community.highlights.existing", defaultValue: "Добавить в существующее"))
                    }
                } else if highlights == nil, let listFailure {
                    Section {
                        DashboardFailurePlaceholder(message: listFailure) { await loadHighlights() }
                    } header: {
                        Text(String(localized: "community.highlights.existing", defaultValue: "Добавить в существующее"))
                    }
                } else if highlights == nil {
                    LoadingStateView().listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Text(String(localized: "community.highlights.add", defaultValue: "В актуальное")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .sensoryFeedback(.success, trigger: done)
            .task { await loadHighlights() }
        }
    }

    private var trimmed: String { newTitle.trimmingCharacters(in: .whitespacesAndNewlines) }

    @MainActor
    private func loadHighlights() async {
        do {
            highlights = try await api.highlights(ownerID: ownerID)
            listFailure = nil
        } catch is CancellationError {
            return
        } catch {
            listFailure = error.userMessage
        }
    }

    @MainActor
    private func run(_ action: () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do {
            try await action()
            done += 1
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Кто посмотрел

struct CommunityStoryViewersView: View {
    let storyID: String

    @Environment(\.dismiss) private var dismiss
    @State private var loader: PagedLoader<CommunityStoryViewerDTO>

    init(storyID: String) {
        self.storyID = storyID
        _loader = State(initialValue: PagedLoader(limit: 30) { request in
            try await CommunityAPI().storyViewers(storyID: storyID, cursor: request.cursor)
        })
    }

    var body: some View {
        NavigationStack {
            PagedList(
                loader: loader,
                empty: EmptyStateView(
                    title: String(localized: "community.viewers.empty", defaultValue: "Пока никто не посмотрел"),
                    symbol: "eye"
                )
            ) { viewer in
                // Без перехода в профиль: список открыт поверх полноэкранной истории.
                PersonRow(
                    name: viewer.user.name,
                    subtitle: DisplayFormat.relative(viewer.createdAt),
                    avatarURL: viewer.user.avatar,
                    trailing: (viewer.reactions ?? []).joined()
                )
            }
            .navigationTitle(Text(String(localized: "community.viewers.title", defaultValue: "Просмотры")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "common.done", defaultValue: "Готово")) { dismiss() }
                }
            }
        }
    }
}
