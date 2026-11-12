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
    let onGif: (RecentGifDTO) -> Void

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

            if tab != .gifs {
                searchField
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
            }

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
                    GifBrowser(onPick: onGif)
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
            TextField(
                tab == .stickers
                    ? String(localized: "chats.panel.searchStickers", defaultValue: "Поиск по набору или emoji")
                    : String(localized: "chats.panel.searchEmoji", defaultValue: "Поиск emoji"),
                text: $query
            )
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

/// GIF: те, что человек уже отправлял (сервер хранит их у себя). Внешнего поиска GIF у
/// StudentHub нет — новый GIF отправляется из «Фото» через скрепку.
private struct GifBrowser: View {
    let onPick: (RecentGifDTO) -> Void

    @State private var gifs: [RecentGifDTO] = []
    @State private var loaded = false
    @State private var failure: String?
    private let api: ChatMessaging = ChatsAPI()

    var body: some View {
        Group {
            if !loaded {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if gifs.isEmpty {
                VStack(spacing: Spacing.md) {
                    Image(systemName: "photo.stack")
                        .font(.largeTitle)
                        .foregroundStyle(Palette.mutedForeground)
                    Text(failure ?? String(
                        localized: "chats.gifs.empty",
                        defaultValue: "Здесь появятся GIF, которые вы отправляли. Новый GIF — через скрепку из «Фото»."
                    ))
                    .font(Typography.meta)
                    .foregroundStyle(failure == nil ? Palette.mutedForeground : Palette.destructive)
                    .multilineTextAlignment(.center)
                }
                .padding(Spacing.xxl)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 3), spacing: 2) {
                        ForEach(gifs) { gif in
                            Button {
                                onPick(gif)
                            } label: {
                                GifThumbnail(gif: gif)
                                    .aspectRatio(1, contentMode: .fit)
                                    .clipped()
                            }
                            .buttonStyle(StickerPressStyle())
                            .accessibilityLabel(Text(String(localized: "chats.preview.gif", defaultValue: "GIF")))
                        }
                    }
                    .padding(2)
                }
            }
        }
        .task {
            do {
                gifs = try await api.recentGifs()
                failure = nil
            } catch is CancellationError {
                return
            } catch {
                failure = error.userMessage
            }
            loaded = true
        }
    }
}

private struct GifThumbnail: View {
    let gif: RecentGifDTO

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
            .task(id: gif.fileId) {
                let key = "gif-panel:\(gif.fileId)"
                if let cached = AnimatedGIF.cached(key) {
                    image = cached
                    return
                }
                guard let url = URL(string: gif.url), let (data, _) = try? await URLSession.shared.data(from: url) else { return }
                image = await Task.detached(priority: .utility) {
                    AnimatedGIF.decode(data, maxPixelSize: 240, key: key)
                }.value
            }
    }
}
