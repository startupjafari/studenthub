import AVKit
import PhotosUI
import SwiftUI

// MARK: - Полоса

/// Полоса историй над лентой: первым — своё кольцо или «добавить», дальше —
/// непросмотренные, затем просмотренные (порядок задаёт сервер).
struct StoriesRail: View {
    let model: StoriesModel
    let viewerID: String
    let viewerName: String?
    let viewerAvatar: String?
    let open: (String) -> Void
    let create: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: Spacing.lg) {
                if let own = model.ownRing(viewerID: viewerID) {
                    StoryAvatar(
                        name: String(localized: "stories.mine", defaultValue: "Моя история"),
                        avatar: own.author.avatarUrl,
                        state: own.hasUnseen ? .unseen : .seen,
                        showsAdd: true,
                        action: { open(own.id) },
                        addAction: create
                    )
                } else {
                    StoryAvatar(
                        name: String(localized: "stories.add", defaultValue: "Добавить"),
                        avatar: viewerAvatar,
                        fallbackName: viewerName,
                        state: .none,
                        showsAdd: true,
                        action: create,
                        addAction: create
                    )
                }
                ForEach(model.rings.filter { $0.author.id != viewerID }) { ring in
                    StoryAvatar(
                        name: ring.author.firstName ?? ring.author.name,
                        avatar: ring.author.avatarUrl,
                        fallbackName: ring.author.name,
                        state: ring.hasUnseen ? .unseen : .seen,
                        action: { open(ring.id) }
                    )
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.xs)
        }
        .scrollClipDisabled()
    }
}

/// Аватар в полосе. Непросмотренное — цветное кольцо, просмотренное — тонкое серое.
struct StoryAvatar: View {
    enum RingState {
        case unseen, seen, none
    }

    let name: String
    let avatar: String?
    var fallbackName: String?
    let state: RingState
    var showsAdd = false
    let action: () -> Void
    var addAction: (() -> Void)?

    private let size: CGFloat = 64

    var body: some View {
        Button(action: action) {
            VStack(spacing: Spacing.sm) {
                ZStack(alignment: .bottomTrailing) {
                    AvatarView(url: avatar, name: fallbackName ?? name, size: size - 8)
                        .padding(4)
                        .overlay {
                            switch state {
                            case .unseen:
                                Circle().strokeBorder(
                                    AngularGradient(
                                        colors: [Palette.primary, Palette.chart3, Palette.primary],
                                        center: .center
                                    ),
                                    lineWidth: 2.5
                                )
                            case .seen:
                                Circle().strokeBorder(Palette.border, lineWidth: 1.5)
                            case .none:
                                EmptyView()
                            }
                        }
                    if showsAdd {
                        Image(systemName: "plus")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Palette.primaryForeground)
                            .frame(width: 22, height: 22)
                            .background(Palette.primary, in: Circle())
                            .overlay(Circle().strokeBorder(Palette.background, lineWidth: 2))
                            .onTapGesture { (addAction ?? action)() }
                            .accessibilityHidden(true)
                    }
                }
                .frame(width: size, height: size)

                Text(name)
                    .font(.caption2)
                    .foregroundStyle(state == .seen ? Palette.mutedForeground : Palette.foreground)
                    .lineLimit(1)
                    .frame(width: size + 8)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(name))
        .accessibilityValue(Text(state == .unseen
            ? String(localized: "stories.unseen", defaultValue: "Есть новые истории")
            : ""))
    }
}

/// Скелет полосы на время первой загрузки.
struct StoriesRailSkeleton: View {
    var body: some View {
        HStack(spacing: Spacing.lg) {
            ForEach(0..<5, id: \.self) { _ in
                VStack(spacing: Spacing.sm) {
                    Circle().fill(Palette.muted).frame(width: 64, height: 64)
                    SkeletonBlock(height: 8, width: 48)
                }
            }
        }
        .padding(.horizontal, Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityHidden(true)
    }
}

// MARK: - Просмотр

/// Полноэкранный просмотр: истории автора по очереди с полосами прогресса.
///
/// Нажатие слева — назад, справа — вперёд, удержание — пауза, смахивание вниз —
/// закрыть, вбок — соседний автор. Пауза ставится и пока человек пишет ответ или
/// выбирает вариант в опросе: история не должна уехать из-под пальца.
struct StoryViewer: View {
    let model: StoriesModel
    let startRingID: String

    @Environment(\.dismiss) private var dismiss
    @Environment(\.viewerID) private var viewerID
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var ringIndex = 0
    @State private var storyIndex = 0
    @State private var progress: Double = 0
    @State private var holding = false
    @State private var pollExpanded = false
    @State private var muted = false
    @State private var reply = ""
    @State private var replySent = 0
    @State private var reporting = false
    @State private var confirmingDelete = false
    @State private var showingViewers = false
    @State private var addingToHighlight = false
    @State private var dragOffset: CGSize = .zero
    @FocusState private var replyFocused: Bool

    /// Кадр без видео и без своей длительности — шесть секунд, как в вебе.
    private static let frameSeconds = 6.0

    private var rings: [StoryRingDTO] { model.rings }

    private var ring: StoryRingDTO? {
        rings.indices.contains(ringIndex) ? rings[ringIndex] : nil
    }

    private var story: StoryDTO? {
        guard let ring, ring.stories.indices.contains(storyIndex) else { return nil }
        return ring.stories[storyIndex]
    }

    private var isOwn: Bool { ring?.author.id == viewerID }

    private var paused: Bool {
        holding || pollExpanded || replyFocused || reporting || confirmingDelete || showingViewers || addingToHighlight
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let story, let ring {
                StoryCanvas(story: story, paused: paused, muted: muted)
                    .ignoresSafeArea()
                    .overlay(tapZones)
                    .overlay(alignment: .top) { header(ring: ring, story: story) }
                    .overlay(alignment: .bottom) { footer(story: story) }
                    .offset(dragOffset)
                    .scaleEffect(1 - min(abs(dragOffset.height) / 2000, 0.1))
                    .gesture(dismissDrag)
                    .id(story.id)
                    .transition(.opacity)
            }
        }
        .statusBarHidden()
        .preferredColorScheme(.dark)
        .sensoryFeedback(.success, trigger: replySent)
        .task(id: story?.id) { await run() }
        .onAppear {
            ringIndex = rings.firstIndex { $0.id == startRingID } ?? 0
            // Своё кольцо и полностью просмотренное — с начала, иначе — с первой
            // непросмотренной, как в вебе.
            storyIndex = ring?.stories.firstIndex { $0.seen != true } ?? 0
        }
        .onChange(of: rings.count) { _, count in
            if count == 0 || ring == nil { dismiss() }
        }
        .sheet(isPresented: $showingViewers) {
            if let story {
                CommunityStoryViewersView(storyID: story.id)
                    .presentationDetents([.medium, .large])
            }
        }
        .sheet(isPresented: $addingToHighlight) {
            if let story {
                CommunityHighlightPicker(storyID: story.id, ownerID: viewerID)
                    .presentationDetents([.medium, .large])
            }
        }
        .confirmationDialog(
            String(localized: "stories.report.title", defaultValue: "Что не так с историей?"),
            isPresented: $reporting,
            titleVisibility: .visible
        ) {
            ForEach(ComplaintReason.allCases) { reason in
                Button(reason.title) {
                    guard let story else { return }
                    Task { _ = await model.report(story, reason: reason.title) }
                }
            }
        }
        .confirmationDialog(
            String(localized: "stories.delete.title", defaultValue: "Удалить историю?"),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(String(localized: "feed.delete", defaultValue: "Удалить"), role: .destructive) {
                guard let story else { return }
                Task { await model.delete(story) }
            }
        }
        .alert(
            String(localized: "feed.actionFailed", defaultValue: "Не получилось"),
            isPresented: Binding(
                get: { model.actionFailure != nil },
                set: { if !$0 { model.dismissActionFailure() } }
            )
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(model.actionFailure ?? "")
        }
    }

    // MARK: Таймер

    private func run() async {
        guard let story else { return }
        progress = 0
        prefetchNeighbours()
        await model.markViewed(story, viewerID: viewerID)
        let seconds = story.media?.durationMs.map { min(Double($0) / 1000, 120) } ?? Self.frameSeconds
        let step = 0.05
        while progress < 1 {
            try? await Task.sleep(for: .milliseconds(Int(step * 1000)))
            if Task.isCancelled { return }
            if !paused { progress += step / max(seconds, 1) }
        }
        advance()
    }

    /// Следующий и предыдущий кадры грузятся заранее: переход не ждёт сети.
    private func prefetchNeighbours() {
        var neighbours: [StoryDTO] = []
        if let ring {
            if ring.stories.indices.contains(storyIndex + 1) { neighbours.append(ring.stories[storyIndex + 1]) }
            if ring.stories.indices.contains(storyIndex - 1) { neighbours.append(ring.stories[storyIndex - 1]) }
        }
        if rings.indices.contains(ringIndex + 1) {
            let next = rings[ringIndex + 1]
            if let first = next.stories.first(where: { $0.seen != true }) ?? next.stories.first { neighbours.append(first) }
        }
        let width = UIScreen.main.bounds.width
        for story in neighbours {
            guard let media = story.media, media.mime?.hasPrefix("video/") != true else { continue }
            guard let url = (media.sources?.best(forPoints: width)?.url ?? media.url).flatMap(URL.init(string:)) else { continue }
            let key = "story:\(media.id)"
            guard ImageMemoryCache.shared.image(for: key) == nil else { continue }
            Task.detached(priority: .utility) { _ = await ImageMemoryCache.shared.load(url, key: key) }
        }
    }

    private func advance() {
        guard let ring else { return dismiss() }
        if storyIndex + 1 < ring.stories.count {
            storyIndex += 1
        } else if ringIndex + 1 < rings.count {
            switchRing(to: ringIndex + 1)
        } else {
            dismiss()
        }
    }

    private func back() {
        if storyIndex > 0 {
            storyIndex -= 1
        } else if ringIndex > 0 {
            switchRing(to: ringIndex - 1)
        } else {
            progress = 0
        }
    }

    private func switchRing(to index: Int) {
        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) {
            ringIndex = index
            storyIndex = rings[index].stories.firstIndex { $0.seen != true } ?? 0
        }
        pollExpanded = false
        reply = ""
    }

    // MARK: Жесты

    private var tapZones: some View {
        HStack(spacing: 0) {
            Color.clear
                .contentShape(Rectangle())
                .frame(maxWidth: .infinity)
                .onTapGesture { back() }
                .accessibilityLabel(Text(String(localized: "stories.previous", defaultValue: "Предыдущая история")))
                .accessibilityAddTraits(.isButton)
            Color.clear
                .contentShape(Rectangle())
                .frame(maxWidth: .infinity)
                .frame(maxWidth: .infinity)
                .onTapGesture { advance() }
                .accessibilityLabel(Text(String(localized: "stories.next", defaultValue: "Следующая история")))
                .accessibilityAddTraits(.isButton)
        }
        .onLongPressGesture(minimumDuration: 0.25, maximumDistance: 30) {
        } onPressingChanged: { pressing in
            holding = pressing
        }
    }

    private var dismissDrag: some Gesture {
        DragGesture(minimumDistance: 24)
            .onChanged { value in
                guard !replyFocused else { return }
                dragOffset = abs(value.translation.height) > abs(value.translation.width)
                    ? CGSize(width: 0, height: max(value.translation.height, 0))
                    : CGSize(width: value.translation.width, height: 0)
            }
            .onEnded { value in
                defer {
                    withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) { dragOffset = .zero }
                }
                if value.translation.height > 140 {
                    dismiss()
                } else if value.translation.width < -80, ringIndex + 1 < rings.count {
                    switchRing(to: ringIndex + 1)
                } else if value.translation.width > 80, ringIndex > 0 {
                    switchRing(to: ringIndex - 1)
                }
            }
    }

    // MARK: Шапка и низ

    private func header(ring: StoryRingDTO, story: StoryDTO) -> some View {
        VStack(spacing: Spacing.md) {
            HStack(spacing: Spacing.xs) {
                ForEach(Array(ring.stories.enumerated()), id: \.element.id) { index, _ in
                    GeometryReader { proxy in
                        Capsule().fill(.white.opacity(0.3))
                            .overlay(alignment: .leading) {
                                Capsule().fill(.white)
                                    .frame(width: proxy.size.width * fill(for: index))
                            }
                    }
                    .frame(height: 2.5)
                }
            }
            .accessibilityHidden(true)

            HStack(spacing: Spacing.md) {
                AvatarView(url: ring.author.avatarUrl, name: ring.author.name, size: 32)
                VStack(alignment: .leading, spacing: 0) {
                    Text(isOwn ? String(localized: "stories.mine", defaultValue: "Моя история") : ring.author.name)
                        .font(Typography.meta.weight(.semibold))
                        .lineLimit(1)
                    Text(story.createdAt, format: .relative(presentation: .named))
                        .font(.caption2)
                        .opacity(0.8)
                }
                Spacer()
                if story.media?.mime?.hasPrefix("video/") == true {
                    iconButton(muted ? "speaker.slash.fill" : "speaker.wave.2.fill",
                               label: String(localized: "stories.sound", defaultValue: "Звук")) {
                        muted.toggle()
                    }
                }
                Menu {
                    if isOwn {
                        Button {
                            addingToHighlight = true
                        } label: {
                            Label(String(localized: "community.highlights.add", defaultValue: "В актуальное"), systemImage: "sparkles")
                        }
                        Button {
                            showingViewers = true
                        } label: {
                            Label(String(localized: "community.viewers.title", defaultValue: "Просмотры"), systemImage: "eye")
                        }
                        if story.canDelete == true {
                            Button(role: .destructive) {
                                confirmingDelete = true
                            } label: {
                                Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                            }
                        }
                    } else {
                        Button {
                            Task { await model.mute(ring.author.id) }
                        } label: {
                            Label(
                                String(localized: "stories.mute", defaultValue: "Не показывать истории автора"),
                                systemImage: "eye.slash"
                            )
                        }
                        Button {
                            reporting = true
                        } label: {
                            Label(String(localized: "feed.report", defaultValue: "Пожаловаться"), systemImage: "exclamationmark.bubble")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(Text(String(localized: "stories.more", defaultValue: "Действия с историей")))
                iconButton("xmark", label: String(localized: "common.close", defaultValue: "Закрыть")) {
                    dismiss()
                }
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

    private func fill(for index: Int) -> Double {
        if index < storyIndex { return 1 }
        if index > storyIndex { return 0 }
        return min(max(progress, 0), 1)
    }

    private func footer(story: StoryDTO) -> some View {
        VStack(spacing: Spacing.lg) {
            // Ссылка и опрос в одной колонке у нижнего края, ссылка выше: так они не
            // накладываются друг на друга и на наклейки по центру кадра.
            if let link = story.linkUrl, let url = URL(string: link) {
                Link(destination: url) {
                    Label(story.linkLabel ?? url.host() ?? link, systemImage: "link")
                        .font(Typography.meta.weight(.semibold))
                        .lineLimit(1)
                        .padding(.horizontal, Spacing.xl)
                        .frame(height: ControlHeight.lg)
                        .foregroundStyle(.white)
                        .floatingGlass(in: Capsule())
                }
            }

            if let poll = story.poll {
                StoryPollView(
                    poll: poll,
                    expanded: $pollExpanded,
                    vote: { option in Task { await model.vote(option, on: story) } }
                )
            }

            if isOwn {
                if let views = story.viewsCount {
                    Button {
                        showingViewers = true
                    } label: {
                        Label {
                            Text(verbatim: String(views))
                        } icon: {
                            Image(systemName: "eye")
                        }
                    }
                    .buttonStyle(.plain)
                    .font(Typography.meta)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityLabel(Text(String(localized: "feed.views", defaultValue: "Просмотры")))
                    .accessibilityValue(Text(verbatim: String(views)))
                }
            } else {
                replyBar(story: story)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.md)
        .background(
            LinearGradient(colors: [.clear, .black.opacity(0.5)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
        )
    }

    private func replyBar(story: StoryDTO) -> some View {
        VStack(spacing: Spacing.md) {
            if !replyFocused {
                HStack(spacing: Spacing.md) {
                    ForEach(StoryReactions.all, id: \.self) { emoji in
                        Button {
                            Task { await model.toggle(emoji, on: story) }
                        } label: {
                            Text(verbatim: emoji)
                                .font(.title3)
                                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                                .background(
                                    model.isMine(emoji, on: story) ? Color.white.opacity(0.25) : .clear,
                                    in: Circle()
                                )
                        }
                        .buttonStyle(.plain)
                        .sensoryFeedback(.impact(weight: .light), trigger: model.isMine(emoji, on: story))
                        .accessibilityLabel(Text(verbatim: emoji))
                        .accessibilityAddTraits(model.isMine(emoji, on: story) ? .isSelected : [])
                    }
                }
            }
            HStack(spacing: Spacing.md) {
                TextField(
                    String(localized: "stories.reply", defaultValue: "Ответить автору"),
                    text: $reply,
                    axis: .vertical
                )
                .lineLimit(1...3)
                .focused($replyFocused)
                .foregroundStyle(.white)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
                .overlay(Capsule().strokeBorder(.white.opacity(0.5)))

                if !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    iconButton("arrow.up.circle.fill", label: String(localized: "chats.send", defaultValue: "Отправить")) {
                        let text = reply.trimmingCharacters(in: .whitespacesAndNewlines)
                        Task {
                            if await model.reply(text, to: story) {
                                reply = ""
                                replyFocused = false
                                replySent += 1
                            }
                        }
                    }
                    .font(.title2)
                }
            }
        }
        .foregroundStyle(.white)
    }

    private func iconButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }
}

// MARK: - Кадр

/// Содержимое кадра: фон, медиа, текст и наклейки.
/// Кадр истории для экранов вне просмотра историй: актуальное, превью в правке.
struct CommunityStoryCanvas: View {
    let story: StoryDTO
    let paused: Bool
    let muted: Bool

    var body: some View {
        StoryCanvas(story: story, paused: paused, muted: muted)
    }
}

private struct StoryCanvas: View {
    let story: StoryDTO
    let paused: Bool
    let muted: Bool

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if let media = story.media {
                    if media.mime?.hasPrefix("video/") == true {
                        StoryVideoView(media: media, paused: paused, muted: muted)
                    } else {
                        RemoteImage(
                            url: (media.sources?.best(forPoints: proxy.size.width)?.url ?? media.url)
                                .flatMap(URL.init(string:)),
                            cacheKey: "story:\(media.id)",
                            placeholder: media.placeholder,
                            contentMode: .fit
                        )
                    }
                } else {
                    StoryBackground.gradient(story.background)
                }

                if let text = story.text, !text.isEmpty {
                    Text(text)
                        .font(story.media == nil ? .title2.weight(.semibold) : Typography.body.weight(.medium))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .shadow(color: .black.opacity(story.media == nil ? 0 : 0.6), radius: 4)
                        .padding(Spacing.xxl)
                        .frame(maxHeight: .infinity, alignment: story.media == nil ? .center : .bottom)
                        .padding(.bottom, story.media == nil ? 0 : 160)
                }

                ForEach(Array((story.elements ?? []).enumerated()), id: \.offset) { _, element in
                    StickerView(element: element)
                        .scaleEffect(min(max(element.scale, 0.4), 3))
                        .rotationEffect(.degrees(element.rotation))
                        .position(x: proxy.size.width * element.x, y: proxy.size.height * element.y)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }
}

/// Наклейка поверх кадра. Упоминание, событие и пост ведут туда же, куда в вебе.
private struct StickerView: View {
    let element: StoryElement

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        switch element.kind {
        case .text(let text, let color, let background):
            Text(text)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color(storyHex: color) ?? .white)
                .padding(.horizontal, background == "none" ? 0 : Spacing.md)
                .padding(.vertical, background == "none" ? 0 : Spacing.xs)
                .background {
                    if background == "solid" {
                        RoundedRectangle(cornerRadius: Radius.md).fill(.black.opacity(0.75))
                    } else if background == "soft" {
                        RoundedRectangle(cornerRadius: Radius.md).fill(.white.opacity(0.25))
                    }
                }
                .multilineTextAlignment(.center)
        case .emoji(let emoji):
            Text(verbatim: emoji).font(.system(size: 56))
        case .mention(let userID, let name):
            chip(symbol: "at", text: name ?? "") {
                open(.profile(id: userID))
            }
        case .event(let id, let title):
            chip(symbol: "calendar", text: title ?? String(localized: "more.events", defaultValue: "События")) {
                open(.community(.event(id: id)))
            }
        case .post(let id, let title):
            chip(symbol: "doc.text", text: title ?? String(localized: "shell.post", defaultValue: "Публикация")) {
                open(.post(id: id))
            }
        case .schedule(let subject, let time):
            chip(symbol: "clock", text: [subject, time].compactMap { $0 }.joined(separator: " · ")) {}
        case .unknown:
            EmptyView()
        }
    }

    private func chip(symbol: String, text: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(text, systemImage: symbol)
                .font(Typography.meta.weight(.semibold))
                .lineLimit(1)
                .foregroundStyle(.white)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.sm)
                .floatingGlass(in: Capsule())
        }
        .buttonStyle(.plain)
    }

    /// Переход из истории: просмотр закрывается, экран открывается во вкладке «Главная».
    private func open(_ route: AppRoute) {
        dismiss()
        AppServices.router.selectedTab = .home
        AppServices.router.stacks[.home, default: []].append(route)
    }
}

private struct StoryVideoView: View {
    let media: StoryDTO.Media
    let paused: Bool
    let muted: Bool

    @State private var player: AVPlayer?

    var body: some View {
        VideoPlayer(player: player)
            .disabled(true)
            .onAppear {
                let raw = media.hls.flatMap(URL.apiRooted) ?? media.url.flatMap(URL.init(string:))
                guard let raw else { return }
                player = AVPlayer(url: raw)
                player?.isMuted = muted
                player?.play()
            }
            .onChange(of: paused) { _, paused in
                if paused { player?.pause() } else { player?.play() }
            }
            .onChange(of: muted) { _, muted in player?.isMuted = muted }
            .onDisappear { player?.pause() }
    }
}

/// Опрос. Два варианта — сразу кнопками. Больше — свёрнутой плашкой: раскрытый список
/// из четырёх вариантов закрыл бы весь кадр, а смотреть пришли на кадр.
private struct StoryPollView: View {
    let poll: StoryDTO.Poll
    @Binding var expanded: Bool
    let vote: (String) -> Void

    private var voted: Bool { poll.myOptionId != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Button {
                withAnimation(Motion.calm) { expanded.toggle() }
            } label: {
                HStack(spacing: Spacing.md) {
                    Image(systemName: "chart.bar.fill")
                    Text(poll.question)
                        .font(Typography.meta.weight(.semibold))
                        .lineLimit(expanded ? 3 : 1)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    if poll.options.count > 2 {
                        Image(systemName: expanded ? "chevron.down" : "chevron.up")
                            .font(.caption.weight(.bold))
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(poll.options.count <= 2)

            if expanded || poll.options.count <= 2 {
                ScrollView {
                    VStack(spacing: Spacing.sm) {
                        ForEach(poll.options) { option in
                            optionRow(option)
                        }
                    }
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(maxHeight: 240)
            }

            if voted {
                Text(String(localized: "stories.poll.votes", defaultValue: "Голосов: \(poll.totalVotes)"))
                    .font(.caption2)
                    .opacity(0.8)
            }
        }
        .foregroundStyle(.white)
        .padding(Spacing.lg)
        .floatingGlass(in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private func optionRow(_ option: StoryDTO.Poll.Option) -> some View {
        let share = poll.totalVotes > 0 ? Double(option.votes) / Double(poll.totalVotes) : 0
        let mine = poll.myOptionId == option.id
        return Button {
            vote(option.id)
        } label: {
            HStack(spacing: Spacing.md) {
                Text(option.text)
                    .font(Typography.meta.weight(mine ? .bold : .medium))
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                if voted {
                    Text(verbatim: share.formatted(.percent.precision(.fractionLength(0))))
                        .font(Typography.tabular(Typography.meta))
                }
                if mine { Image(systemName: "checkmark.circle.fill") }
            }
            .padding(.horizontal, Spacing.lg)
            .frame(minHeight: ControlHeight.lg)
            .background(alignment: .leading) {
                GeometryReader { proxy in
                    Capsule().fill(.white.opacity(voted ? 0.3 : 0))
                        .frame(width: proxy.size.width * share)
                }
            }
            .background(.white.opacity(0.12), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: poll.myOptionId)
        .accessibilityValue(Text(verbatim: voted ? share.formatted(.percent.precision(.fractionLength(0))) : ""))
        .accessibilityAddTraits(mine ? .isSelected : [])
    }
}

/// Градиенты текстовых историй — те же, что в вебе (`STORY_BACKGROUND_CLASS`).
enum StoryBackground {
    static let all = ["sunset", "ocean", "forest", "grape", "graphite", "rose"]

    static func gradient(_ key: String?) -> LinearGradient {
        let colors: [UInt32]
        switch key {
        case "sunset": colors = [0xFB923C, 0xF43F5E, 0xC026D3]
        case "ocean": colors = [0x38BDF8, 0x3B82F6, 0x4F46E5]
        case "forest": colors = [0x34D399, 0x22C55E, 0x0D9488]
        case "grape": colors = [0x8B5CF6, 0x9333EA, 0xA21CAF]
        case "rose": colors = [0xF472B6, 0xF43F5E, 0xEF4444]
        default: colors = [0x475569, 0x334155, 0x0F172A]
        }
        return LinearGradient(
            colors: colors.map(Color.init(rgb:)),
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

extension Color {
    fileprivate init(rgb: UInt32) {
        self.init(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }

    /// Цвет текстовой наклейки (`#rrggbb` из палитры сервера).
    fileprivate init?(storyHex: String?) {
        guard let storyHex, storyHex.hasPrefix("#"), let value = UInt32(storyHex.dropFirst(), radix: 16) else {
            return nil
        }
        self.init(rgb: value)
    }
}

// MARK: - Создание

/// Новая история: фото или видео из галереи либо текст на фоне, и кому показать.
struct StoryComposerView: View {
    let model: StoriesModel

    @Environment(\.dismiss) private var dismiss
    @State private var pick: PhotosPickerItem?
    @State private var media: PreparedMedia?
    @State private var text = ""
    @State private var background = "ocean"
    @State private var audience: StoryAudience = .group
    @State private var isPreparing = false
    @State private var isPublishing = false
    @State private var failure: String?
    // Интерактив: ссылка, опрос, упоминания — как в редакторе историй веба.
    @State private var linkURL = ""
    @State private var linkLabel = ""
    @State private var pollOn = false
    @State private var pollQuestion = ""
    @State private var pollOptions = ["", ""]
    @State private var mentions: [SearchResultsDTO.Person] = []
    @State private var pickingMention = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    preview
                        .frame(maxWidth: .infinity)
                        .aspectRatio(9.0 / 16.0, contentMode: .fit)
                        .frame(maxHeight: 420)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))

                    HStack(spacing: Spacing.lg) {
                        PhotosPicker(selection: $pick, matching: .any(of: [.images, .videos])) {
                            Label(
                                media == nil
                                    ? String(localized: "stories.pickMedia", defaultValue: "Фото или видео")
                                    : String(localized: "stories.replaceMedia", defaultValue: "Заменить"),
                                systemImage: "photo.on.rectangle"
                            )
                        }
                        .buttonStyle(.bordered)
                        if media != nil {
                            Button(role: .destructive) {
                                media = nil
                                pick = nil
                            } label: {
                                Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                            }
                            .buttonStyle(.bordered)
                        }
                    }

                    if media == nil {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Spacing.md) {
                                ForEach(StoryBackground.all, id: \.self) { key in
                                    Button {
                                        background = key
                                    } label: {
                                        Circle()
                                            .fill(StoryBackground.gradient(key))
                                            .frame(width: 36, height: 36)
                                            .overlay(
                                                Circle().strokeBorder(Palette.foreground, lineWidth: background == key ? 2 : 0)
                                            )
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(Text(verbatim: key))
                                    .accessibilityAddTraits(background == key ? .isSelected : [])
                                }
                            }
                        }
                    }

                    TextField(
                        media == nil
                            ? String(localized: "stories.text", defaultValue: "Текст истории")
                            : String(localized: "stories.caption", defaultValue: "Подпись (необязательно)"),
                        text: $text,
                        axis: .vertical
                    )
                    .lineLimit(1...6)
                    .padding(Spacing.lg)
                    .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))

                    Picker(String(localized: "stories.audience", defaultValue: "Кому показать"), selection: $audience) {
                        ForEach(StoryAudience.allCases) { audience in
                            Text(audience.title).tag(audience)
                        }
                    }
                    .pickerStyle(.segmented)

                    interactive

                    if let failure {
                        FormAlert(message: failure)
                    }
                }
                .padding(Spacing.xl)
            }
            .background(Palette.background)
            .sheet(isPresented: $pickingMention) {
                CommunityPersonPicker(title: String(localized: "community.story.mention", defaultValue: "Упомянуть")) { person in
                    if !mentions.contains(where: { $0.id == person.id }), mentions.count < 10 { mentions.append(person) }
                }
            }
            .navigationTitle(Text(String(localized: "stories.new", defaultValue: "Новая история")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "common.cancel", defaultValue: "Отмена")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "stories.publish", defaultValue: "Опубликовать")) {
                        Task { await publish() }
                    }
                    .disabled(!canPublish)
                }
            }
            .task(id: pick) { await load() }
            .interactiveDismissDisabled(isPublishing)
        }
    }

    @ViewBuilder
    private var preview: some View {
        ZStack {
            if let media {
                if let image = media.preview {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Palette.muted
                }
                if media.isVideo {
                    Image(systemName: "play.circle.fill").font(.largeTitle).foregroundStyle(.white)
                }
            } else {
                StoryBackground.gradient(background)
                Text(text.isEmpty ? String(localized: "stories.text", defaultValue: "Текст истории") : text)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white.opacity(text.isEmpty ? 0.6 : 1))
                    .multilineTextAlignment(.center)
                    .padding(Spacing.xxl)
            }
            if isPreparing || isPublishing {
                Color.black.opacity(0.35)
                ProgressView().tint(.white)
            }
        }
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var canPublish: Bool {
        !isPreparing && !isPublishing && (media != nil || !trimmed.isEmpty || !mentions.isEmpty)
            && trimmed.count <= 600 && linkIsValid && pollIsValid
    }

    private var trimmedLink: String { linkURL.trimmingCharacters(in: .whitespaces) }
    private var linkIsValid: Bool {
        trimmedLink.isEmpty || ((trimmedLink.hasPrefix("https://") || trimmedLink.hasPrefix("http://")) && trimmedLink.count <= 500)
    }

    private var pollChoices: [String] {
        pollOptions.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    private var pollIsValid: Bool {
        guard pollOn else { return true }
        let question = pollQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        return !question.isEmpty && question.count <= 200 && pollChoices.count >= 2
            && Set(pollChoices).count == pollChoices.count && pollChoices.allSatisfy { $0.count <= 100 }
    }

    private var extras: CommunityStoryExtras {
        let label = linkLabel.trimmingCharacters(in: .whitespaces)
        // Упоминания встают столбиком у верхней трети кадра — двигать пальцем их пока нельзя.
        let placed = mentions.enumerated().map { index, person in
            CommunityStoryMentionInput(userId: person.id, x: 0.5, y: min(0.2 + Double(index) * 0.08, 0.9))
        }
        return CommunityStoryExtras(
            linkUrl: trimmedLink.isEmpty ? nil : trimmedLink,
            linkLabel: label.isEmpty ? nil : String(label.prefix(60)),
            poll: pollOn ? CommunityStoryPollInput(
                question: pollQuestion.trimmingCharacters(in: .whitespacesAndNewlines),
                options: pollChoices
            ) : nil,
            mentions: placed
        )
    }

    private var interactive: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(String(localized: "community.story.interactive", defaultValue: "Интерактив"))
                .font(Typography.sectionTitle)
            VStack(alignment: .leading, spacing: Spacing.md) {
                Label(String(localized: "community.story.link", defaultValue: "Ссылка"), systemImage: "link")
                    .font(Typography.meta.weight(.semibold))
                TextField(String(localized: "community.story.linkURL", defaultValue: "https://…"), text: $linkURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !trimmedLink.isEmpty {
                    TextField(String(localized: "community.story.linkLabel", defaultValue: "Подпись ссылки (необязательно)"), text: $linkLabel)
                }
                if !linkIsValid {
                    FieldError(message: String(localized: "profile.website.invalid", defaultValue: "Адрес сайта должен начинаться с http:// или https://"))
                }
            }
            .padding(Spacing.lg)
            .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))

            VStack(alignment: .leading, spacing: Spacing.md) {
                Toggle(isOn: $pollOn) {
                    Label(String(localized: "community.story.poll", defaultValue: "Опрос"), systemImage: "chart.bar")
                        .font(Typography.meta.weight(.semibold))
                }
                if pollOn {
                    TextField(String(localized: "community.story.pollQuestion", defaultValue: "Вопрос"), text: $pollQuestion)
                    ForEach(pollOptions.indices, id: \.self) { index in
                        HStack {
                            TextField(
                                String(localized: "community.story.pollOption", defaultValue: "Вариант \((index + 1).formatted())"),
                                text: $pollOptions[index]
                            )
                            if pollOptions.count > 2 {
                                Button {
                                    pollOptions.remove(at: index)
                                } label: {
                                    Image(systemName: "minus.circle").foregroundStyle(Palette.destructive)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(Text(String(localized: "community.story.removeOption", defaultValue: "Убрать вариант")))
                            }
                        }
                    }
                    if pollOptions.count < 4 {
                        Button {
                            pollOptions.append("")
                        } label: {
                            Label(String(localized: "community.story.addOption", defaultValue: "Добавить вариант"), systemImage: "plus")
                        }
                        .font(Typography.meta)
                    }
                }
            }
            .padding(Spacing.lg)
            .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))

            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    Label(String(localized: "community.story.mentions", defaultValue: "Упоминания"), systemImage: "at")
                        .font(Typography.meta.weight(.semibold))
                    Spacer()
                    Button {
                        pickingMention = true
                    } label: {
                        Image(systemName: "plus.circle")
                    }
                    .disabled(mentions.count >= 10)
                    .accessibilityLabel(Text(String(localized: "community.story.mention", defaultValue: "Упомянуть")))
                }
                ForEach(mentions) { person in
                    HStack {
                        Text(person.name).font(Typography.body)
                        Spacer()
                        Button {
                            mentions.removeAll { $0.id == person.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "community.story.removeMention", defaultValue: "Убрать упоминание")))
                    }
                }
            }
            .padding(Spacing.lg)
            .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
        }
    }

    private func load() async {
        guard let pick else { return }
        isPreparing = true
        defer { isPreparing = false }
        do {
            media = try await MediaPreparation.prepare(pick)
            failure = nil
        } catch {
            failure = (error as? LocalizedError)?.errorDescription
                ?? String(localized: "media.unreadable", defaultValue: "Не удалось прочитать файл")
        }
    }

    private func publish() async {
        isPublishing = true
        defer { isPublishing = false }
        let ok = await model.publish(
            media: media,
            text: trimmed.isEmpty ? nil : trimmed,
            background: background,
            audience: audience,
            extras: extras
        )
        if ok {
            dismiss()
        } else {
            failure = model.actionFailure
            model.dismissActionFailure()
        }
    }
}
