import SwiftUI
import UIKit

/// Панель emoji, стикеров и GIF на месте клавиатуры — как в Telegram.
///
/// Встаёт под поле ввода той же высоты, что была у клавиатуры: поле не прыгает ни при
/// открытии, ни при возврате к клавиатуре. Сверху — разделы и поиск, ниже — сетка.
struct ExpressionPanel: View {
    enum Tab: Hashable { case emoji, stickers, gifs }

    let onEmoji: (String) -> Void
    let onBackspace: () -> Void
    let onSticker: (StickerSetDTO.Sticker) -> Void
    let onGif: (GifChoice) -> Void

    @State private var tab: Tab? = .emoji
    @State private var query = ""
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Spacing.md) {
                FilterChips(
                    options: [
                        (Tab.emoji, String(localized: "chats.panel.emoji", defaultValue: "Emoji")),
                        (Tab.stickers, String(localized: "chats.panel.stickers", defaultValue: "Стикеры")),
                        (Tab.gifs, String(localized: "chats.panel.gif", defaultValue: "GIF")),
                    ],
                    selection: $tab,
                    fillsWidth: true
                )
                if tab == .emoji {
                    Button(action: onBackspace) {
                        Image(systemName: "delete.left")
                            .font(.body)
                            .foregroundStyle(Palette.mutedForeground)
                            .frame(width: ControlHeight.md, height: ControlHeight.md)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(String(localized: "chats.panel.backspace", defaultValue: "Стереть")))
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.sm)

            searchField
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.sm)

            Group {
                switch tab ?? .emoji {
                case .emoji:
                    if query.isEmpty {
                        EmojiGrid(columns: 8, onPick: pickEmoji)
                    } else {
                        EmojiSearchResults(query: query, onPick: pickEmoji)
                    }
                case .stickers:
                    StickerBrowser(query: query, onPick: onSticker)
                case .gifs:
                    GifBrowser(query: query, onPick: onGif)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Palette.plainBackground.opacity(0.98))
        .onChange(of: tab) { query = "" }
    }

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Palette.mutedForeground)
                .accessibilityHidden(true)
            TextField(searchPrompt, text: $query)
            .font(Typography.body)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Palette.mutedForeground)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(String(localized: "chats.thread.search.clear", defaultValue: "Стереть")))
            }
        }
        .padding(.horizontal, Spacing.lg)
        .frame(height: ControlHeight.md)
        .background(Palette.muted, in: Capsule())
    }

    private var searchPrompt: String {
        switch tab ?? .emoji {
        case .emoji: String(localized: "chats.panel.searchEmoji", defaultValue: "Поиск emoji")
        case .stickers: String(localized: "chats.panel.searchStickers", defaultValue: "Поиск по набору или emoji")
        case .gifs: String(localized: "chats.panel.searchGif", defaultValue: "Поиск GIF")
        }
    }

    private func pickEmoji(_ emoji: String) {
        RecentEmoji.shared.use(emoji)
        onEmoji(emoji)
    }
}

/// Поиск emoji по словам на русском, казахском и английском (`EmojiKeywords`).
private struct EmojiSearchResults: View {
    let query: String
    let onPick: (String) -> Void

    var body: some View {
        let found = Self.search(query)
        ScrollView {
            if found.isEmpty {
                Text(String(localized: "services.notFound", defaultValue: "Ничего не нашлось"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .padding(Spacing.xxl)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 8), spacing: 2) {
                    ForEach(found, id: \.self) { emoji in
                        Button {
                            onPick(emoji)
                        } label: {
                            Text(verbatim: emoji)
                                .font(.system(size: 30))
                                .frame(maxWidth: .infinity, minHeight: 42)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, Spacing.sm)
            }
        }
    }

    static func search(_ query: String) -> [String] {
        EmojiKeywords.search(query)
    }
}

// MARK: - Стикеры

/// Наборы стикеров: полоса наборов (недавние первыми) и сетка выбранного. Поиск — по
/// названию набора и по emoji стикера.
private struct StickerBrowser: View {
    let query: String
    let onPick: (StickerSetDTO.Sticker) -> Void

    @State private var selectedSet: String?
    private var catalog: StickerCatalog { StickerCatalog.shared }
    private var recents: RecentStickers { RecentStickers.shared }

    private static let recentID = "recent"

    var body: some View {
        VStack(spacing: 0) {
            if !catalog.sets.isEmpty, query.isEmpty {
                setStrip
                Divider()
            }
            content
        }
        .task { await catalog.load() }
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
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Spacing.sm), count: 4), spacing: Spacing.sm) {
                    ForEach(shown) { sticker in
                        Button {
                            RecentStickers.shared.use(sticker.id)
                            onPick(sticker)
                        } label: {
                            StickerImage(stickerID: sticker.id, emoji: sticker.emoji, url: sticker.url)
                                .frame(height: 72)
                                .frame(maxWidth: .infinity)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(StickerPressStyle())
                        .accessibilityLabel(Text(Self.label(for: sticker)))
                    }
                }
                .padding(Spacing.md)
            }
        }
    }

    private var setStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                if !recentStickers.isEmpty {
                    stripButton(id: Self.recentID, title: String(localized: "emoji.recent", defaultValue: "Недавние")) {
                        Image(systemName: "clock")
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
            .padding(.vertical, Spacing.xs)
        }
    }

    private func stripButton<Icon: View>(id: String, title: String, @ViewBuilder icon: () -> Icon) -> some View {
        Button {
            selectedSet = id
        } label: {
            icon()
                .frame(width: 32, height: 32)
                .padding(Spacing.xs)
                .background(currentSet == id ? Palette.muted : Color.clear, in: RoundedRectangle(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(currentSet == id ? .isSelected : [])
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

    private var shown: [StickerSetDTO.Sticker] {
        let term = query.trimmingCharacters(in: .whitespaces).lowercased()
        if !term.isEmpty {
            return catalog.sets.flatMap { set in
                set.title.lowercased().contains(term)
                    ? set.stickers
                    : set.stickers.filter { $0.emoji?.contains(term) == true }
            }
        }
        if currentSet == Self.recentID { return recentStickers }
        return catalog.sets.first { $0.id == currentSet }?.stickers ?? []
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
    let query: String
    let onPick: (GifChoice) -> Void

    @State private var recent: [RecentGifDTO] = []
    @State private var found: [ExternalGifDTO] = []
    @State private var nextOffset: Int?
    @State private var isLoading = false
    @State private var searchDisabled = false
    @State private var failure: String?
    private let api: ChatMessaging = ChatsAPI()

    var body: some View {
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
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(Palette.mutedForeground)
            .padding(.horizontal, Spacing.md)
            .padding(.top, Spacing.xs)
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
