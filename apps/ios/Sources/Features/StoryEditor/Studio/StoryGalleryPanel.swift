import SwiftUI
import UIKit

/// Галерея поверх камеры: лист снизу, камера остаётся видна сверху.
///
/// Лист не пересоздаётся, пока открыт редактор выбранного снимка, — возврат «×»
/// показывает сетку на той же прокрутке.
struct StoryGalleryPanel: View {
    let model: StoryStudioModel
    let top: CGFloat

    @State private var dragOffset: CGFloat = 0

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 1.5), count: 3)

    var body: some View {
        VStack(spacing: 0) {
            header
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 22, topTrailingRadius: 22, style: .continuous)
                .fill(Color(white: 0.08))
        )
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 22, topTrailingRadius: 22, style: .continuous))
        .padding(.top, top)
        .offset(y: max(dragOffset, 0))
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("story.gallery")
        .overlay {
            if model.isImporting {
                ProgressView().tint(.white).controlSize(.large)
                    .padding(Spacing.xxl)
                    .background(RoundedRectangle(cornerRadius: Radius.xl).fill(.black.opacity(0.6)))
                    .accessibilityIdentifier("story.gallery.importing")
            }
        }
    }

    // MARK: Шапка

    private var header: some View {
        VStack(spacing: Spacing.sm) {
            Capsule().fill(Color.white.opacity(0.35)).frame(width: 36, height: 5).padding(.top, Spacing.sm)
            HStack {
                Button {
                    model.closeGallery()
                } label: {
                    Image(systemName: "xmark").font(.system(size: 17, weight: .semibold)).frame(width: 44, height: 44)
                }
                .accessibilityLabel(Text(String(localized: "stories.close", defaultValue: "Закрыть")))
                .accessibilityIdentifier("story.gallery.close")

                Spacer()

                Menu {
                    Button(String(localized: "stories.gallery.recent", defaultValue: "Недавние")) {
                        Task { await model.selectAlbum(nil) }
                    }
                    Button(String(localized: "stories.gallery.drafts", defaultValue: "Черновики") + " (\(model.draftList.count))") {
                        model.showDrafts()
                    }
                    .accessibilityIdentifier("story.gallery.album.drafts")
                    Divider()
                    ForEach(model.albums) { album in
                        Button("\(album.title) (\(album.count))") {
                            Task { await model.selectAlbum(album) }
                        }
                    }
                } label: {
                    HStack(spacing: Spacing.xs) {
                        Text(albumTitle).font(.headline)
                        Image(systemName: "chevron.down").font(.caption.weight(.bold))
                    }
                    .foregroundStyle(.white)
                }
                .accessibilityIdentifier("story.gallery.album")

                Spacer()

                Button(model.isSelecting
                    ? String(localized: "stories.gallery.cancelSelect", defaultValue: "Отмена")
                    : String(localized: "stories.gallery.select", defaultValue: "Выбрать")) {
                    model.toggleSelecting()
                }
                .font(.body.weight(.semibold))
                .frame(minWidth: 44, minHeight: 44)
                .opacity(model.showsDrafts ? 0 : 1)
                .disabled(model.showsDrafts)
                .accessibilityIdentifier("story.gallery.select")
            }
            .foregroundStyle(.white)
            .padding(.horizontal, Spacing.md)
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture()
                .onChanged { dragOffset = $0.translation.height }
                .onEnded { drag in
                    if drag.translation.height > 120 || drag.predictedEndTranslation.height > 260 {
                        model.closeGallery()
                    }
                    withAnimation(Motion.snappy) { dragOffset = 0 }
                }
        )
    }

    private var albumTitle: String {
        if model.showsDrafts { return String(localized: "stories.gallery.drafts", defaultValue: "Черновики") }
        return model.album?.title ?? String(localized: "stories.gallery.recent", defaultValue: "Недавние")
    }

    // MARK: Сетка

    @ViewBuilder
    private var content: some View {
        if model.galleryAccess == false {
            VStack(spacing: Spacing.lg) {
                Image(systemName: "photo.on.rectangle.angled").font(.largeTitle)
                Text(String(localized: "stories.gallery.denied", defaultValue: "Нет доступа к «Фото». Разрешите его в Настройках."))
                    .multilineTextAlignment(.center)
                Button(String(localized: "stories.gallery.openSettings", defaultValue: "Открыть Настройки")) {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                .buttonStyle(.borderedProminent)
            }
            .foregroundStyle(.white)
            .padding(Spacing.xxl)
            .frame(maxHeight: .infinity)
        } else if model.showsDrafts {
            draftsGrid
        } else {
            ZStack(alignment: .bottom) {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 1.5) {
                        ForEach(model.items) { item in
                            GalleryTile(
                                item: item,
                                source: model.gallery,
                                number: model.selection.number(of: item.id),
                                isSelecting: model.isSelecting
                            ) {
                                Task { await model.tapItem(item) }
                            }
                        }
                    }
                    .padding(.bottom, 100)
                }
                .accessibilityIdentifier("story.gallery.grid")

                if model.isSelecting, !model.selection.isEmpty {
                    Button {
                        Task { await model.openSelection() }
                    } label: {
                        Text(String(localized: "stories.gallery.next", defaultValue: "Далее") + " (\(model.selection.count))")
                            .font(.headline)
                            .foregroundStyle(.white)
                            .padding(.horizontal, Spacing.xxl)
                            .padding(.vertical, Spacing.lg)
                            .background(Capsule().fill(Palette.primary))
                    }
                    .buttonStyle(.pressable)
                    .padding(.bottom, Spacing.xxl)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .accessibilityIdentifier("story.gallery.next")
                }
            }
            .animation(Motion.snappy, value: model.selection.count)
        }
    }

    private var draftsGrid: some View {
        ScrollView {
            if model.draftList.isEmpty {
                Text(String(localized: "stories.gallery.noDrafts", defaultValue: "Черновиков пока нет"))
                    .foregroundStyle(.white.opacity(0.6))
                    .padding(.top, 60)
            }
            LazyVGrid(columns: columns, spacing: 1.5) {
                ForEach(model.draftList) { draft in
                    Button {
                        Task { await model.openDraft(draft) }
                    } label: {
                        Color.clear
                            .aspectRatio(9.0 / 16.0, contentMode: .fit)
                            .overlay {
                                if let url = draft.thumbnail, let image = UIImage(contentsOfFile: url.path) {
                                    Image(uiImage: image).resizable().scaledToFill()
                                } else {
                                    Color.white.opacity(0.08)
                                }
                            }
                            .clipped()
                            .overlay(alignment: .bottomLeading) {
                                Text(draft.updatedAt, style: .relative)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .padding(Spacing.xs)
                                    .background(Capsule().fill(.black.opacity(0.5)))
                                    .padding(Spacing.xs)
                            }
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button(role: .destructive) {
                            model.deleteDraft(draft)
                        } label: {
                            Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                    }
                    .accessibilityLabel(Text(String(localized: "stories.gallery.draft", defaultValue: "Черновик")))
                    .accessibilityIdentifier("story.gallery.draft")
                }
            }
        }
    }
}

/// Плитка галереи: миниатюра, длительность ролика, номер выбора.
private struct GalleryTile: View {
    let item: StoryGalleryItem
    let source: StoryGallerySource
    let number: Int?
    let isSelecting: Bool
    let onTap: () -> Void

    @State private var image: UIImage?
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Button(action: onTap) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    if let image {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else {
                        Color.white.opacity(0.06)
                    }
                }
                .clipped()
                .overlay(alignment: .bottomTrailing) {
                    if item.isVideo {
                        Text(verbatim: String(format: "%d:%02d", Int(item.duration.rounded()) / 60, Int(item.duration.rounded()) % 60))
                            .font(.caption2.weight(.semibold).monospacedDigit())
                            .foregroundStyle(.white)
                            .shadow(radius: 2)
                            .padding(Spacing.xs)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    if isSelecting {
                        ZStack {
                            Circle()
                                .strokeBorder(.white, lineWidth: 1.5)
                                .background(Circle().fill(number == nil ? Color.black.opacity(0.2) : Palette.primary))
                            if let number {
                                Text(verbatim: "\(number)").font(.caption.weight(.bold)).foregroundStyle(.white)
                            }
                        }
                        .frame(width: 24, height: 24)
                        .padding(Spacing.sm)
                        .transition(.scale.combined(with: .opacity))
                    }
                }
                .overlay {
                    if number != nil { Rectangle().strokeBorder(Palette.primary, lineWidth: 2) }
                }
                .animation(Motion.snappy, value: number)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(item.isVideo
            ? String(localized: "chats.attach.video", defaultValue: "Видео")
            : String(localized: "chats.attach.photo", defaultValue: "Фото")))
        .accessibilityIdentifier("story.gallery.item.\(item.id)")
        .accessibilityValue(Text(verbatim: number.map { "\($0)" } ?? ""))
        .accessibilityAddTraits(number != nil ? .isSelected : [])
        .onAppear { source.appeared(item) }
        .onDisappear { source.disappeared(item) }
        .task(id: item.id) {
            for await picture in source.thumbnail(for: item, side: 140 * displayScale) {
                image = await picture.byPreparingForDisplay() ?? picture
            }
        }
    }
}
