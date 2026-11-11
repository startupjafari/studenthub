import PhotosUI
import SwiftUI

// Медиа профиля: загрузка фото и видео, альбомы (`/profile/media`, `/profile/albums`).

// MARK: - Загрузка

/// Кнопка «Загрузить фото или видео» в профиль. Файлы уходят по одному; ошибка
/// одного не останавливает остальные.
struct CommunityMediaUploadButton: View {
    enum Layout {
        /// Строка списка: индикатор у правого края.
        case row
        /// «+» в панели навигации (профиль): пока идёт загрузка — индикатор.
        case icon
    }

    var title = String(localized: "community.media.upload", defaultValue: "Загрузить фото или видео")
    var layout: Layout = .row
    let uploaded: ([ProfileMediaDTO]) async -> Void

    @State private var picks: [PhotosPickerItem] = []
    @State private var isUploading = false
    @State private var failure: String?

    var body: some View {
        PhotosPicker(selection: $picks, maxSelectionCount: 20, matching: .any(of: [.images, .videos])) {
            switch layout {
            case .row:
                HStack {
                    Label(title, systemImage: "square.and.arrow.up")
                    if isUploading {
                        Spacer()
                        ProgressView()
                    }
                }
            case .icon:
                if isUploading {
                    ProgressView()
                } else {
                    Image(systemName: "plus")
                        .accessibilityLabel(Text(title))
                }
            }
        }
        .disabled(isUploading)
        .onChange(of: picks) { _, items in
            guard !items.isEmpty else { return }
            Task { await upload(items) }
        }
        .actionFailureAlert($failure)
    }

    @MainActor
    private func upload(_ items: [PhotosPickerItem]) async {
        isUploading = true
        defer {
            isUploading = false
            picks = []
        }
        var done: [ProfileMediaDTO] = []
        for item in items {
            do {
                let prepared = try await MediaPreparation.prepare(item)
                done.append(try await CommunityAPI().uploadProfileMedia(prepared.data, mime: prepared.mime, filename: prepared.filename))
            } catch {
                failure = error.userMessage
            }
        }
        if !done.isEmpty { await uploaded(done) }
    }
}

// MARK: - Альбомы

struct CommunityAlbumsView: View {
    /// `nil` — свои.
    let userID: String?

    @Environment(\.viewerID) private var viewerID
    @State private var albums: [CommunityAlbumDTO]?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var creating = false
    @State private var newTitle = ""
    @State private var renaming: CommunityAlbumDTO?
    @State private var renameTitle = ""
    @State private var deleting: CommunityAlbumDTO?
    @State private var actionFailure: String?

    private let api = CommunityAPI()
    private var ownerID: String { userID ?? viewerID }
    private var isMine: Bool { userID == nil || userID == viewerID }

    var body: some View {
        List {
            if isMine {
                Section {
                    CommunityMediaUploadButton { _ in await load() }
                }
            }
            if let albums {
                if albums.isEmpty {
                    EmptyStateView(
                        title: String(localized: "community.albums.empty", defaultValue: "Альбомов пока нет"),
                        symbol: "photo.stack",
                        hint: isMine ? String(localized: "community.albums.empty.hint", defaultValue: "Соберите фото по темам: поездки, проекты, мероприятия") : nil
                    )
                    .centeredInScreen()
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                } else {
                    Section {
                        ForEach(albums) { album in
                            NavigationLink(value: AppRoute.community(.album(id: album.id, userID: ownerID))) {
                                CommunityAlbumLine(album: album)
                            }
                            .swipeActions {
                                if isMine {
                                    Button(role: .destructive) {
                                        deleting = album
                                    } label: {
                                        Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                                    }
                                    Button {
                                        renameTitle = album.title
                                        renaming = album
                                    } label: {
                                        Label(String(localized: "community.albums.rename", defaultValue: "Переименовать"), systemImage: "pencil")
                                    }
                                }
                            }
                            .contextMenu {
                                if isMine {
                                    Button {
                                        renameTitle = album.title
                                        renaming = album
                                    } label: {
                                        Label(String(localized: "community.albums.rename", defaultValue: "Переименовать"), systemImage: "pencil")
                                    }
                                    Button(role: .destructive) {
                                        deleting = album
                                    } label: {
                                        Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                                    }
                                }
                            }
                        }
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }.listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(CommunityScreen.albums(userID: nil).title))
        .navigationBarTitleDisplayMode(.inline)
        .communityFloatingAction(isMine, String(localized: "community.albums.new", defaultValue: "Новый альбом"), symbol: "plus.rectangle.on.folder") {
            newTitle = ""
            creating = true
        }
        .refreshable { await load() }
        .task { await load() }
        .reasonPrompt(
            $creating,
            title: String(localized: "community.albums.new", defaultValue: "Новый альбом"),
            placeholder: String(localized: "community.highlights.title", defaultValue: "Название"),
            actionTitle: String(localized: "community.albums.create", defaultValue: "Создать"),
            text: $newTitle
        ) {
            let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty else { return }
            do {
                _ = try await api.createAlbum(title: String(title.prefix(100)))
                await load()
            } catch {
                actionFailure = error.userMessage
            }
        }
        .reasonPrompt(
            Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }),
            title: String(localized: "community.albums.rename", defaultValue: "Переименовать"),
            placeholder: String(localized: "community.highlights.title", defaultValue: "Название"),
            actionTitle: String(localized: "common.save", defaultValue: "Сохранить"),
            text: $renameTitle
        ) {
            guard let album = renaming else { return }
            let title = renameTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty else { return }
            do {
                _ = try await api.renameAlbum(id: album.id, title: String(title.prefix(100)))
                await load()
            } catch {
                actionFailure = error.userMessage
            }
        }
        .confirmDestructive(
            $deleting,
            title: { String(localized: "community.albums.delete.title", defaultValue: "Удалить альбом «\($0.title)»? Снимки останутся в профиле.") },
            actionTitle: String(localized: "feed.delete", defaultValue: "Удалить")
        ) { album in
            do {
                try await api.deleteAlbum(id: album.id)
                albums?.removeAll { $0.id == album.id }
            } catch {
                actionFailure = error.userMessage
            }
        }
        .actionFailureAlert($actionFailure)
    }

    @MainActor
    private func load() async {
        guard !ownerID.isEmpty else { return }
        do {
            albums = try await api.albums(userID: ownerID)
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

/// Строка альбома для списка.
private struct CommunityAlbumLine: View {
    let album: CommunityAlbumDTO

    var body: some View {
        HStack(spacing: Spacing.lg) {
            Group {
                if let cover = album.coverUrl.flatMap(URL.init(string:)) {
                    RemoteImage(url: cover, cacheKey: "album:\(album.id):\(album.coverUrl?.split(separator: "?").first ?? "")")
                } else {
                    ZStack {
                        Palette.muted
                        Image(systemName: "photo.stack").foregroundStyle(Palette.mutedForeground)
                    }
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(album.title).font(Typography.body).foregroundStyle(Palette.foreground)
                Text(String(localized: "community.albums.count", defaultValue: "Снимков: \((album.count ?? 0).formatted())"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
    }
}

// MARK: - Альбом

struct CommunityAlbumView: View {
    let albumID: String
    let userID: String

    @Environment(\.viewerID) private var viewerID
    @State private var all: [ProfileMediaDTO]?
    @State private var album: CommunityAlbumDTO?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var viewing: CommunityMediaTarget?
    @State private var choosing = false
    @State private var actionFailure: String?
    @State private var deleting: ProfileMediaDTO?

    private let api = CommunityAPI()
    private var isMine: Bool { userID == viewerID }
    private var items: [ProfileMediaDTO] { (all ?? []).filter { $0.albumId == albumID } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                if isMine {
                    HStack(spacing: Spacing.md) {
                        CommunityMediaUploadButton(title: String(localized: "community.albums.uploadHere", defaultValue: "Загрузить")) { uploaded in
                            do {
                                try await api.addToAlbum(id: albumID, fileIDs: uploaded.map(\.id))
                            } catch {
                                actionFailure = error.userMessage
                            }
                            await load()
                        }
                        .glassButton()
                        Button {
                            choosing = true
                        } label: {
                            Label(String(localized: "community.albums.fromProfile", defaultValue: "Из профиля"), systemImage: "photo.on.rectangle")
                        }
                        .glassButton()
                    }
                    .padding(.horizontal, Spacing.xl)
                }
                if let all {
                    if items.isEmpty {
                        EmptyStateView(title: String(localized: "community.albums.noMedia", defaultValue: "В альбоме пока пусто"), symbol: "photo")
                    } else {
                        CommunityMediaGrid(items: items, open: { index in
                            viewing = CommunityMediaTarget(media: items.map(\.asPostMedia), start: index)
                        }, menu: isMine ? { item in AnyView(menu(for: item)) } : nil)
                    }
                    let _ = all
                } else if let failure {
                    ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                } else {
                    LoadingStateView()
                }
            }
            .padding(.vertical, Spacing.md)
        }
        .background(Palette.background)
        .navigationTitle(Text(album?.title ?? CommunityScreen.album(id: albumID, userID: userID).title))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .fullScreenCover(item: $viewing) { target in
            MediaViewer(media: target.media, start: target.start)
        }
        .sheet(isPresented: $choosing) {
            CommunityMediaChooser(items: (all ?? []).filter { $0.albumId != albumID }) { ids in
                do {
                    try await api.addToAlbum(id: albumID, fileIDs: ids)
                    await load()
                } catch {
                    actionFailure = error.userMessage
                }
            }
        }
        .confirmDestructive(
            $deleting,
            title: { _ in String(localized: "community.media.delete.title", defaultValue: "Удалить снимок из профиля?") },
            actionTitle: String(localized: "feed.delete", defaultValue: "Удалить")
        ) { item in
            do {
                try await api.deleteProfileMedia(fileID: item.id)
                all?.removeAll { $0.id == item.id }
            } catch {
                actionFailure = error.userMessage
            }
        }
        .actionFailureAlert($actionFailure)
    }

    @ViewBuilder
    private func menu(for item: ProfileMediaDTO) -> some View {
        Button {
            Task {
                do {
                    album = try await api.setAlbumCover(id: albumID, fileID: item.id)
                } catch {
                    actionFailure = error.userMessage
                }
            }
        } label: {
            Label(String(localized: "community.highlights.makeCover", defaultValue: "Сделать обложкой"), systemImage: "photo")
        }
        Button {
            Task {
                do {
                    try await api.removeFromAlbum(id: albumID, fileID: item.id)
                    await load()
                } catch {
                    actionFailure = error.userMessage
                }
            }
        } label: {
            Label(String(localized: "community.albums.removeFrom", defaultValue: "Убрать из альбома"), systemImage: "minus.circle")
        }
        Button(role: .destructive) {
            deleting = item
        } label: {
            Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
        }
    }

    @MainActor
    private func load() async {
        do {
            async let media = ProfileContentAPI().media(userID: userID)
            async let albums = api.albums(userID: userID)
            all = try await media
            album = (try? await albums)?.first { $0.id == albumID }
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

/// Выбор снимков профиля, чтобы разложить их в альбом.
private struct CommunityMediaChooser: View {
    let items: [ProfileMediaDTO]
    let chosen: ([String]) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selection: Set<String> = []

    var body: some View {
        NavigationStack {
            ScrollView {
                if items.isEmpty {
                    EmptyStateView(title: String(localized: "community.albums.nothingToAdd", defaultValue: "Все снимки уже в этом альбоме"), symbol: "photo")
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 3), spacing: 2) {
                    ForEach(items) { item in
                        Button {
                            if selection.contains(item.id) { selection.remove(item.id) } else if selection.count < 50 { selection.insert(item.id) }
                        } label: {
                            Palette.muted
                                .aspectRatio(1, contentMode: .fit)
                                .overlay { RemoteImage(url: item.thumbnailURL, cacheKey: "profile-media:\(item.id)") }
                                .overlay(alignment: .topTrailing) {
                                    Image(systemName: selection.contains(item.id) ? "checkmark.circle.fill" : "circle")
                                        .font(.title3)
                                        .foregroundStyle(.white, Palette.primary)
                                        .padding(Spacing.sm)
                                        .shadow(radius: 2)
                                }
                                .clipped()
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selection.contains(item.id) ? .isSelected : [])
                    }
                }
            }
            .background(Palette.background)
            .navigationTitle(Text(String(localized: "community.albums.fromProfile", defaultValue: "Из профиля")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "community.albums.add", defaultValue: "Добавить")) {
                        let ids = Array(selection)
                        dismiss()
                        Task { await chosen(ids) }
                    }
                    .disabled(selection.isEmpty)
                }
            }
        }
    }
}
