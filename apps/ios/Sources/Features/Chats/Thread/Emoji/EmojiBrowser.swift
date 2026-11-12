import SwiftUI

/// Выбор emoji как в Telegram: сверху — полоса разделов (недавние и каталог), под ней —
/// поиск, ниже — сетка с подписями разделов по центру. Один и тот же вид — в панели на
/// месте клавиатуры и в раскрытых реакциях меню сообщения.
struct EmojiBrowser: View {
    var columns = 8
    /// Запас снизу под плавающие кнопки панели — последний ряд не прячется под ними.
    var bottomInset: CGFloat = 0
    let onPick: (String) -> Void

    @State private var query = ""
    @State private var selected: String?

    private static let recentID = "recent"
    private var recents: RecentEmoji { RecentEmoji.shared }

    var body: some View {
        ScrollViewReader { reader in
            VStack(spacing: Spacing.sm) {
                categoryStrip(reader)
                ExpressionSearchField(
                    query: $query,
                    prompt: String(localized: "chats.panel.search", defaultValue: "Поиск")
                )
                .padding(.horizontal, Spacing.md)

                if query.trimmingCharacters(in: .whitespaces).isEmpty {
                    grid
                } else {
                    EmojiSearchResults(query: query, columns: columns, bottomInset: bottomInset, onPick: onPick)
                }
            }
            .padding(.top, Spacing.sm)
        }
    }

    // MARK: Полоса разделов

    private func categoryStrip(_ reader: ScrollViewProxy) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.xs) {
                if !recents.items.isEmpty {
                    stripButton(
                        id: Self.recentID,
                        symbol: "clock",
                        title: String(localized: "emoji.recent", defaultValue: "Недавние"),
                        reader: reader
                    )
                }
                ForEach(EmojiCatalog.categories) { category in
                    stripButton(id: category.id, symbol: category.symbol, title: category.title, reader: reader)
                }
            }
            .padding(.horizontal, Spacing.md)
        }
    }

    private func stripButton(id: String, symbol: String, title: String, reader: ScrollViewProxy) -> some View {
        let isCurrent = (selected ?? firstSectionID) == id
        return Button {
            selected = id
            // Раздел из полосы выходит и из поиска: сетка возвращается к нему.
            query = ""
            withAnimation { reader.scrollTo(id, anchor: .top) }
        } label: {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(isCurrent ? Palette.foreground : Palette.mutedForeground)
                .frame(width: 36, height: 36)
                .background(isCurrent ? Palette.muted : Color.clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }

    private var firstSectionID: String {
        recents.items.isEmpty ? (EmojiCatalog.categories.first?.id ?? Self.recentID) : Self.recentID
    }

    // MARK: Сетка

    private var grid: some View {
        ScrollView {
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: columns),
                spacing: 2
            ) {
                if !recents.items.isEmpty {
                    section(
                        id: Self.recentID,
                        title: String(localized: "emoji.recent", defaultValue: "Недавние"),
                        emoji: recents.items,
                        onClear: { withAnimation { recents.clear() } }
                    )
                }
                ForEach(EmojiCatalog.categories) { category in
                    section(id: category.id, title: category.title, emoji: category.emoji)
                }
            }
            .padding(.horizontal, Spacing.xs)
        }
        .contentMargins(.bottom, bottomInset, for: .scrollContent)
        .scrollDismissesKeyboard(.immediately)
    }

    private func section(id: String, title: String, emoji: [String], onClear: (() -> Void)? = nil) -> some View {
        Section {
            ForEach(emoji, id: \.self) { item in
                EmojiCell(emoji: item, onPick: onPick)
            }
        } header: {
            ExpressionSectionHeader(title: title, onClear: onClear)
                .id(id)
        }
    }
}

/// Один emoji в сетке: под пальцем подрастает, как в Telegram.
struct EmojiCell: View {
    let emoji: String
    let onPick: (String) -> Void

    var body: some View {
        Button {
            onPick(emoji)
        } label: {
            Text(verbatim: emoji)
                .font(.system(size: 30))
                .frame(maxWidth: .infinity, minHeight: 42)
        }
        .buttonStyle(ReactionButtonStyle())
        .accessibilityLabel(Text(verbatim: emoji))
    }
}

/// Подпись раздела по центру прописными, как «НЕДАВНИЕ» в Telegram. У недавних справа —
/// крестик «очистить».
struct ExpressionSectionHeader: View {
    let title: String
    var onClear: (() -> Void)?

    var body: some View {
        Text(title)
            .font(.footnote.weight(.medium))
            .textCase(.uppercase)
            .foregroundStyle(Palette.mutedForeground)
            .lineLimit(1)
            .padding(.horizontal, 44)
            .frame(maxWidth: .infinity)
            .padding(.top, Spacing.md)
            .padding(.bottom, Spacing.xs)
            .overlay(alignment: .trailing) {
                if let onClear {
                    Button(action: onClear) {
                        Image(systemName: "xmark")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Palette.mutedForeground)
                            .frame(width: 36, height: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, Spacing.sm)
                    .accessibilityLabel(Text(String(localized: "emoji.recent.clear", defaultValue: "Очистить недавние")))
                }
            }
            .accessibilityAddTraits(.isHeader)
    }
}

/// Поле поиска панели: серая капсула с лупой, как в Telegram.
struct ExpressionSearchField: View {
    @Binding var query: String
    let prompt: String

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Palette.mutedForeground)
                .accessibilityHidden(true)
            TextField(prompt, text: $query)
                .font(Typography.body)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
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
}

/// Поиск emoji по словам на русском, казахском и английском (`EmojiKeywords`).
struct EmojiSearchResults: View {
    let query: String
    var columns = 8
    var bottomInset: CGFloat = 0
    let onPick: (String) -> Void

    var body: some View {
        let found = EmojiKeywords.search(query)
        ScrollView {
            if found.isEmpty {
                Text(String(localized: "services.notFound", defaultValue: "Ничего не нашлось"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(maxWidth: .infinity)
                    .padding(Spacing.xxl)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: columns), spacing: 2) {
                    ForEach(found, id: \.self) { emoji in
                        EmojiCell(emoji: emoji, onPick: onPick)
                    }
                }
                .padding(.horizontal, Spacing.xs)
            }
        }
        .contentMargins(.bottom, bottomInset, for: .scrollContent)
        .scrollDismissesKeyboard(.immediately)
    }
}

/// Emoji и стикер под пальцем подрастают, как в Telegram.
struct ReactionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 1.25 : 1)
            .animation(.spring(duration: 0.2, bounce: 0.4), value: configuration.isPressed)
    }
}
