import SwiftUI
import UIKit

/// Панель emoji, стикеров и GIF на месте клавиатуры — как в Telegram.
///
/// Встаёт под поле ввода той же высоты, что была у клавиатуры: поле не прыгает ни при
/// открытии, ни при возврате к клавиатуре. Содержимое вкладки — во всю высоту, сверху у
/// него свой поиск; внизу плавает капсула вкладок «GIF · Стикеры · Эмодзи», справа от
/// неё у emoji — «стереть».
struct ExpressionPanel: View {
    enum Tab: Hashable, CaseIterable { case gifs, stickers, emoji }

    let onEmoji: (String) -> Void
    let onBackspace: () -> Void
    let onSticker: (StickerSetDTO.Sticker) -> Void
    let onGif: (GifChoice) -> Void

    @State private var tab: Tab = .emoji
    @Namespace private var tabSelection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Запас под плавающей капсулой вкладок: последний ряд прокручивается из-под неё.
    private static let barClearance: CGFloat = ControlHeight.xl + Spacing.md * 2

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                switch tab {
                case .emoji:
                    EmojiBrowser(columns: 8, bottomInset: Self.barClearance, onPick: pickEmoji)
                case .stickers:
                    StickerBrowser(bottomInset: Self.barClearance, onPick: onSticker)
                case .gifs:
                    GifBrowser(bottomInset: Self.barClearance, onPick: onGif)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            bottomBar
        }
        .background { Palette.card.ignoresSafeArea(edges: .bottom) }
    }

    // MARK: Нижняя полоса

    private var bottomBar: some View {
        HStack(spacing: Spacing.md) {
            // Пустое место слева — чтобы капсула вкладок стояла ровно по центру.
            Color.clear.frame(width: ControlHeight.xl, height: ControlHeight.xl)
            Spacer(minLength: 0)
            tabPicker
            Spacer(minLength: 0)
            if tab == .emoji {
                Button(action: onBackspace) {
                    Image(systemName: "delete.left")
                        .font(.body.weight(.medium))
                        .foregroundStyle(Palette.foreground)
                        .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .floatingGlass(in: Circle())
                .accessibilityLabel(Text(String(localized: "chats.panel.backspace", defaultValue: "Стереть")))
                .transition(.scale.combined(with: .opacity))
            } else {
                Color.clear.frame(width: ControlHeight.xl, height: ControlHeight.xl)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.md)
    }

    /// Капсула вкладок: выбранная — светлая подложка, которая переезжает пружиной.
    private var tabPicker: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.self) { item in
                Button {
                    withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) { tab = item }
                } label: {
                    Text(title(item))
                        .font(.subheadline.weight(tab == item ? .semibold : .medium))
                        .foregroundStyle(tab == item ? Palette.foreground : Palette.mutedForeground)
                        .lineLimit(1)
                        .padding(.horizontal, Spacing.lg)
                        .frame(height: ControlHeight.md)
                        .background {
                            if tab == item {
                                Capsule()
                                    .fill(Palette.foreground.opacity(0.12))
                                    .matchedGeometryEffect(id: "tab", in: tabSelection)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(tab == item ? .isSelected : [])
            }
        }
        .padding(Spacing.xs)
        .floatingGlass(in: Capsule())
    }

    private func title(_ item: Tab) -> String {
        switch item {
        case .emoji: String(localized: "chats.panel.emoji", defaultValue: "Эмодзи")
        case .stickers: String(localized: "chats.panel.stickers", defaultValue: "Стикеры")
        case .gifs: String(localized: "chats.panel.gif", defaultValue: "GIF")
        }
    }

    private func pickEmoji(_ emoji: String) {
        RecentEmoji.shared.use(emoji)
        onEmoji(emoji)
    }
}

// MARK: - Стикеры

/// Стикеры как в Telegram: сверху — полоса наборов (недавние первыми), под ней — поиск,
/// ниже — все наборы одной лентой с подписью над каждым. Касание набора в полосе
/// прокручивает к нему. Поиск — по названию набора и по emoji стикера.
private struct StickerBrowser: View {
    let bottomInset: CGFloat
    let onPick: (StickerSetDTO.Sticker) -> Void

    @State private var query = ""
    /// Набор у верха ленты: касание в полосе прокручивает к нему, прокрутка пальцем
    /// двигает подсветку (см. `EmojiBrowser`).
    @State private var selectedSet: String?
    private var catalog: StickerCatalog { StickerCatalog.shared }
    private var recents: RecentStickers { RecentStickers.shared }

    private static let recentID = "recent"

    var body: some View {
        VStack(spacing: Spacing.sm) {
            if !catalog.sets.isEmpty {
                setStrip
            }
            ExpressionSearchField(
                query: $query,
                prompt: String(localized: "chats.panel.search", defaultValue: "Поиск")
            )
            .padding(.horizontal, Spacing.md)
            content
        }
        .padding(.top, Spacing.sm)
        .task { await catalog.load() }
    }

    private var term: String {
        query.trimmingCharacters(in: .whitespaces).lowercased()
    }

    @ViewBuilder
    private var content: some View {
        if catalog.sets.isEmpty {
            VStack(spacing: Spacing.md) {
                if catalog.isLoading {
                    ProgressView()
                } else if let failure = catalog.failure {
                    Text(failure)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.destructive)
                    Button(String(localized: "common.retry", defaultValue: "Повторить")) {
                        Task { await catalog.load(force: true) }
                    }
                    .glassButton()
                } else {
                    Image(systemName: "face.smiling")
                        .font(.largeTitle)
                        .foregroundStyle(Palette.mutedForeground)
                    Text(String(
                        localized: "chats.stickers.empty",
                        defaultValue: "Наборов стикеров пока нет — их добавляет администратор платформы"
                    ))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                }
            }
            .padding(Spacing.xxl)
            .padding(.bottom, bottomInset)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                if term.isEmpty {
                    // Наборы — прямые элементы ленивого столбца: только к ним прокрутка
                    // находит дорогу, пока набор ещё не построен.
                    LazyVStack(spacing: 0) {
                        if !recentStickers.isEmpty {
                            section(
                                id: Self.recentID,
                                title: String(localized: "emoji.recent", defaultValue: "Недавние"),
                                stickers: recentStickers
                            )
                        }
                        ForEach(catalog.sets) { set in
                            section(id: set.id, title: set.title, stickers: set.stickers)
                        }
                    }
                    .scrollTargetLayout()
                    .padding(.horizontal, Spacing.md)
                } else {
                    LazyVGrid(columns: Self.columns, spacing: Spacing.sm) {
                        ForEach(found) { sticker in
                            cell(sticker)
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                }
                if !term.isEmpty, found.isEmpty {
                    Text(String(localized: "services.notFound", defaultValue: "Ничего не нашлось"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .frame(maxWidth: .infinity)
                        .padding(Spacing.xxl)
                }
            }
            .scrollPosition(id: $selectedSet, anchor: .top)
            .contentMargins(.bottom, bottomInset, for: .scrollContent)
            .scrollDismissesKeyboard(.immediately)
        }
    }

    private static let columns = Array(repeating: GridItem(.flexible(), spacing: Spacing.sm), count: 5)

    private func section(id: String, title: String, stickers: [StickerSetDTO.Sticker]) -> some View {
        VStack(spacing: 0) {
            ExpressionSectionHeader(title: title)
            LazyVGrid(columns: Self.columns, spacing: Spacing.sm) {
                ForEach(stickers) { sticker in
                    cell(sticker)
                }
            }
        }
        .id(id)
    }

    private func cell(_ sticker: StickerSetDTO.Sticker) -> some View {
        Button {
            RecentStickers.shared.use(sticker.id)
            onPick(sticker)
        } label: {
            StickerImage(stickerID: sticker.id, emoji: sticker.emoji, url: sticker.url)
                .frame(height: 64)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(StickerPressStyle())
        .accessibilityLabel(Text(Self.label(for: sticker)))
    }

    private var setStrip: some View {
        ScrollViewReader { strip in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.xs) {
                    if !recentStickers.isEmpty {
                        stripButton(id: Self.recentID, title: String(localized: "emoji.recent", defaultValue: "Недавние")) {
                            Image(systemName: "clock")
                                .font(.title3)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                    ForEach(catalog.sets) { set in
                        stripButton(id: set.id, title: set.title) {
                            if let first = set.stickers.first {
                                StickerImage(stickerID: first.id, emoji: first.emoji, url: first.url)
                            }
                        }
                    }
                }
                .padding(.horizontal, Spacing.md)
            }
            .onChange(of: selectedSet) { _, id in
                guard let id else { return }
                withAnimation { strip.scrollTo(id) }
            }
        }
    }

    private func stripButton<Icon: View>(
        id: String,
        title: String,
        @ViewBuilder icon: () -> Icon
    ) -> some View {
        let isCurrent = currentSet == id
        return Button {
            // Набор из полосы выходит и из поиска: лента возвращается к нему.
            query = ""
            withAnimation { selectedSet = id }
        } label: {
            icon()
                .frame(width: 30, height: 30)
                .padding(3)
                .background(isCurrent ? Palette.muted : Color.clear, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .id(id)
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }

    private static func label(for sticker: StickerSetDTO.Sticker) -> String {
        let emoji = sticker.emoji ?? ""
        return String(localized: "chats.sticker.a11y", defaultValue: "Стикер \(emoji)")
    }

    private var recentStickers: [StickerSetDTO.Sticker] {
        recents.ids.compactMap { catalog.sticker(id: $0) }
    }

    private var currentSet: String? {
        selectedSet ?? (recentStickers.isEmpty ? catalog.sets.first?.id : Self.recentID)
    }

    private var found: [StickerSetDTO.Sticker] {
        catalog.sets.flatMap { set in
            set.title.lowercased().contains(term)
                ? set.stickers
                : set.stickers.filter { $0.emoji?.contains(term) == true }
        }
    }
}

private struct StickerPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.88 : 1)
            .animation(.spring(duration: 0.2, bounce: 0.4), value: configuration.isPressed)
    }
}

// MARK: - GIF

/// Что выбрали во вкладке GIF: свой уже отправленный или из каталога GIPHY.
enum GifChoice {
    case recent(RecentGifDTO)
    case external(ExternalGifDTO)
}

/// GIF: сверху — те, что человек уже отправлял, ниже — популярные или найденные в
/// GIPHY (через сервер: ключ каталога в приложение не попадает). Нет ключа на сервере —
/// остаются только свои, и это сказано честно.
private struct GifBrowser: View {
    let bottomInset: CGFloat
    let onPick: (GifChoice) -> Void

    @State private var query = ""
    @State private var recent: [RecentGifDTO] = []
    @State private var found: [ExternalGifDTO] = []
    @State private var nextOffset: Int?
    @State private var isLoading = false
    @State private var searchDisabled = false
    @State private var failure: String?
    private let api: ChatMessaging = ChatsAPI()

    var body: some View {
        VStack(spacing: Spacing.sm) {
            ExpressionSearchField(
                query: $query,
                prompt: String(localized: "chats.panel.searchGif", defaultValue: "Поиск GIF")
            )
            .padding(.horizontal, Spacing.md)
            .padding(.top, Spacing.sm)
            results
        }
    }

    private var results: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                if query.trimmingCharacters(in: .whitespaces).isEmpty, !recent.isEmpty {
                    sectionTitle(String(localized: "emoji.recent", defaultValue: "Недавние"))
                    grid(recent.map { GifTile(id: "r-\($0.fileId)", url: $0.url, choice: .recent($0)) })
                }
                if !searchDisabled {
                    if !found.isEmpty {
                        sectionTitle(query.trimmingCharacters(in: .whitespaces).isEmpty
                            ? String(localized: "chats.gifs.trending", defaultValue: "Популярные")
                            : String(localized: "chats.gifs.results", defaultValue: "Найдено"))
                        grid(found.map { GifTile(id: "e-\($0.id)", url: $0.previewUrl, choice: .external($0)) })
                        if nextOffset != nil {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .task(id: found.count) { await loadMore() }
                        }
                    } else if isLoading {
                        ProgressView().frame(maxWidth: .infinity).padding(Spacing.xl)
                    } else if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                        note(String(localized: "services.notFound", defaultValue: "Ничего не нашлось"))
                    }
                    // Условие каталога GIPHY: подпись источника рядом с результатами.
                    Text(verbatim: "Powered by GIPHY")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Palette.mutedForeground)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.xs)
                } else if recent.isEmpty {
                    note(String(
                        localized: "chats.gifs.empty",
                        defaultValue: "Здесь появятся GIF, которые вы отправляли. Новый GIF — через скрепку из «Фото»."
                    ))
                }
                if let failure {
                    note(failure, isError: true)
                }
            }
            .padding(2)
        }
        .contentMargins(.bottom, bottomInset, for: .scrollContent)
        .scrollDismissesKeyboard(.immediately)
        .task { await loadRecent() }
        .task(id: query) {
            // Пауза — чтобы не спрашивать каталог на каждую букву.
            try? await Task.sleep(for: .milliseconds(query.isEmpty ? 0 : 350))
            guard !Task.isCancelled else { return }
            await search()
        }
    }

    private struct GifTile: Identifiable {
        let id: String
        let url: String
        let choice: GifChoice
    }

    private func grid(_ tiles: [GifTile]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 3), spacing: 2) {
            ForEach(tiles) { tile in
                Button {
                    onPick(tile.choice)
                } label: {
                    GifThumbnail(key: tile.id, url: tile.url)
                        .aspectRatio(1, contentMode: .fit)
                        .clipped()
                }
                .buttonStyle(StickerPressStyle())
                .accessibilityLabel(Text(String(localized: "chats.preview.gif", defaultValue: "GIF")))
            }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        ExpressionSectionHeader(title: text)
    }

    private func note(_ text: String, isError: Bool = false) -> some View {
        Text(text)
            .font(Typography.meta)
            .foregroundStyle(isError ? Palette.destructive : Palette.mutedForeground)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(Spacing.xl)
    }

    private func loadRecent() async {
        recent = (try? await api.recentGifs()) ?? []
    }

    private func search() async {
        guard !searchDisabled else { return }
        isLoading = true
        defer { isLoading = false }
        found = []
        nextOffset = nil
        await fetch(offset: 0)
    }

    private func loadMore() async {
        guard let offset = nextOffset, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        await fetch(offset: offset)
    }

    private func fetch(offset: Int) async {
        do {
            let page = try await api.searchGifs(query, offset: offset)
            let known = Set(found.map(\.id))
            found += page.items.filter { !known.contains($0.id) }
            nextOffset = page.nextOffset
            failure = nil
        } catch is CancellationError {
            return
        } catch let error as APIError where error.code == .unknown("FEATURE_DISABLED") {
            searchDisabled = true
        } catch {
            failure = error.userMessage
        }
    }
}

private struct GifThumbnail: View {
    let key: String
    let url: String

    @State private var image: UIImage?

    var body: some View {
        Color.clear
            .overlay {
                if let image {
                    AnimatedImageView(image: image)
                } else {
                    Palette.muted
                }
            }
            .task(id: key) {
                let key = "gif-panel:\(key)"
                if let cached = AnimatedGIF.cached(key) {
                    image = cached
                    return
                }
                guard let url = URL(string: url), let (data, _) = try? await URLSession.shared.data(from: url) else { return }
                image = await Task.detached(priority: .utility) {
                    AnimatedGIF.decode(data, maxPixelSize: 240, key: key)
                }.value
            }
    }
}
