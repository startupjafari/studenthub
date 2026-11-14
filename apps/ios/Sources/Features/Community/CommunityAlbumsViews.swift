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
        let result = await CommunityMediaUpload.upload(items)
        if let error = result.failure { failure = error }
        if !result.done.isEmpty { await uploaded(result.done) }
    }
}

/// Загрузка выбранных фото и видео в профиль — по одному; ошибка одного не
/// останавливает остальные. Общая для кнопки «Загрузить» и плавающей кнопки альбома.
enum CommunityMediaUpload {
    @MainActor
    static func upload(_ items: [PhotosPickerItem]) async -> (done: [ProfileMediaDTO], failure: String?) {
        var done: [ProfileMediaDTO] = []
        var failure: String?
        for item in items {
            do {
                let prepared = try await MediaPreparation.prepare(item)
                done.append(try await CommunityAPI().uploadProfileMedia(prepared.data, mime: prepared.mime, filename: prepared.filename))
            } catch {
                failure = error.userMessage
            }
        }
        return (done, failure)
    }
}

// MARK: - Альбомы

struct CommunityAlbumsView: View {
    /// `nil` — свои.
    let userID: String?

    @Environment(\.viewerID) private var viewerID
    @State private var remote = RemoteValue<[CommunityAlbumDTO]>()
    @State private var creating = false
    @State private var newTitle = ""
    @State private var renaming: CommunityAlbumDTO?
    @State private var renameTitle = ""
    @State private var deleting: CommunityAlbumDTO?
    @State private var actionFailure: String?
    /// Первые снимки каждого альбома — превью в строке и крупно по удержанию. Список
    /// альбомов несёт только обложку, снимки — из медиа владельца (`albumId`).
    @State private var previews: [String: [ProfileMediaDTO]] = [:]

    private let api = CommunityAPI()
    private var ownerID: String { userID ?? viewerID }
    private var isMine: Bool { userID == nil || userID == viewerID }
    private var albums: [CommunityAlbumDTO]? { remote.value }
    private var failure: String? { remote.failure }
    private var isOffline: Bool { remote.isOffline }

    var body: some View {
        // Загрузка фото — «+» на вкладке «Фото» профиля; здесь только альбомы, без
        // полосы загрузки над списком.
        List {
            if let albums, !albums.isEmpty {
                if let failure {
                    StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    ForEach(albums) { album in
                        NavigationLink(value: AppRoute.community(.album(id: album.id, userID: ownerID))) {
                            CommunityAlbumLine(album: album, previews: previews[album.id] ?? [])
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
                        // Удержание — первые снимки крупно, как предпросмотр альбома.
                        .contextMenu {
                            Button {
                                AppServices.router.push(.community(.album(id: album.id, userID: ownerID)))
                            } label: {
                                Label(String(localized: "community.albums.open", defaultValue: "Открыть"), systemImage: "photo.on.rectangle.angled")
                            }
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
                        } preview: {
                            CommunityAlbumPreview(album: album, items: previews[album.id] ?? [])
                        }
                    }
                }
            }
        }
        .compactListStyle()
        .screenState(albums?.isEmpty != false) {
            if albums != nil {
                EmptyStateView(
                    title: String(localized: "community.albums.empty", defaultValue: "Альбомов пока нет"),
                    symbol: "photo.stack",
                    hint: isMine ? String(localized: "community.albums.empty.hint", defaultValue: "Соберите фото по темам: поездки, проекты, мероприятия") : nil
                )
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(CommunityScreen.albums(userID: nil).title))
        .navigationBarTitleDisplayMode(.inline)
        .communityFloatingAction(isMine, String(localized: "community.albums.new", defaultValue: "Новый альбом"), symbol: "plus.rectangle.on.folder") {
            newTitle = ""
            creating = true
        }
        .pullToRefresh { await load() }
        // Показ, возврат на экран и возврат приложения из фона — сохранённое на месте,
        // сеть обновляет фоном (`RemoteValue`).
        .task(id: AppLifecycle.shared.foregroundEpoch) { await load() }
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
                remote.value?.removeAll { $0.id == album.id }
            } catch {
                actionFailure = error.userMessage
            }
        }
        .actionFailureAlert($actionFailure)
    }

    private func load() async {
        guard !ownerID.isEmpty else { return }
        let api = api
        let ownerID = ownerID
        // Снимки для превью — параллельно со списком и без права уронить экран: без них
        // строка покажет обложку, как раньше.
        async let media: [ProfileMediaDTO]? = try? ProfileContentAPI().media(userID: ownerID)
        await remote.load { try await api.albums(userID: ownerID) }
        if let media = await media {
            previews = Dictionary(grouping: media.filter { $0.albumId != nil }) { $0.albumId ?? "" }
                .mapValues { Array($0.prefix(CommunityAlbumLine.previewCount)) }
        }
    }
}

/// Строка альбома: название и число снимков, под ними — первые три снимка. Альбом без
/// снимков (или пока снимки не пришли) — обложкой или значком, как раньше.
private struct CommunityAlbumLine: View {
    static let previewCount = 3

    let album: CommunityAlbumDTO
    let previews: [ProfileMediaDTO]

    var body: some View {
        if previews.isEmpty {
            HStack(spacing: Spacing.lg) {
                cover
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                titles
            }
        } else {
            VStack(alignment: .leading, spacing: Spacing.md) {
                titles
                HStack(spacing: Spacing.xs) {
                    ForEach(0..<Self.previewCount, id: \.self) { index in
                        tile(index < previews.count ? previews[index] : nil)
                    }
                }
            }
            .padding(.vertical, Spacing.xs)
        }
    }

    private var titles: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(album.title).font(Typography.body).foregroundStyle(Palette.foreground)
            Text(String(localized: "community.albums.count", defaultValue: "Снимков: \((album.count ?? 0).formatted())"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
        }
    }

    @ViewBuilder
    private var cover: some View {
        if let cover = album.coverUrl.flatMap(URL.init(string:)) {
            RemoteImage(url: cover, cacheKey: "album:\(album.id):\(album.coverUrl?.split(separator: "?").first ?? "")")
        } else {
            ZStack {
                Palette.muted
                Image(systemName: "photo.stack").foregroundStyle(Palette.mutedForeground)
            }
        }
    }

    /// Квадратная плитка снимка; пустая — когда в альбоме меньше трёх.
    private func tile(_ item: ProfileMediaDTO?) -> some View {
        Palette.muted
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let item {
                    RemoteImage(url: item.thumbnailURL, cacheKey: "profile-media:\(item.id)")
                }
            }
            .overlay(alignment: .bottomLeading) {
                if item?.isVideo == true {
                    Image(systemName: "play.fill")
                        .font(.caption2)
                        .foregroundStyle(.white)
                        .padding(Spacing.xs)
                        .background(Palette.overlay.opacity(0.45), in: Circle())
                        .padding(Spacing.xs)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Предпросмотр альбома по удержанию: первые снимки крупно — первый во всю ширину, два
/// следующих под ним, — и название.
private struct CommunityAlbumPreview: View {
    let album: CommunityAlbumDTO
    let items: [ProfileMediaDTO]

    private let width: CGFloat = 340

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 2) {
                if let first = items.first {
                    image(first)
                        .frame(width: width, height: width * 0.75)
                } else {
                    ZStack {
                        Palette.muted
                        Image(systemName: "photo.stack")
                            .font(.largeTitle)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    .frame(width: width, height: width * 0.6)
                }
                if items.count > 1 {
                    HStack(spacing: 2) {
                        ForEach(items.dropFirst().prefix(2)) { item in
                            image(item)
                                .frame(width: items.count > 2 ? (width - 2) / 2 : width, height: (width - 2) / 2)
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(album.title)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                Text(String(localized: "community.albums.count", defaultValue: "Снимков: \((album.count ?? 0).formatted())"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            .padding(Spacing.lg)
        }
        .frame(width: width)
        .background(Palette.card)
    }

    private func image(_ item: ProfileMediaDTO) -> some View {
        Palette.muted
            .overlay { RemoteImage(url: item.previewURL(minWidth: 1000), cacheKey: "profile-media-large:\(item.id)") }
            .clipped()
    }
}

private extension ProfileMediaDTO {
    /// Вариант снимка не уже `minWidth` пикселей — для крупного показа; у видео — превью.
    func previewURL(minWidth: Int) -> URL? {
        if isVideo { return posterUrl.flatMap(URL.init(string:)) }
        let candidate = sources?.sorted { $0.width < $1.width }.first { $0.width >= minWidth } ?? sources?.last
        return URL(string: candidate?.url ?? url)
    }
}

// MARK: - Альбом

struct CommunityAlbumView: View {
    let albumID: String
    let userID: String

    @Environment(\.viewerID) private var viewerID
    /// Снимки владельца и сам альбом (название, обложка) — одним значением.
    @State private var remote = RemoteValue<Loaded>()
    @State private var viewing: CommunityMediaTarget?
    @State private var choosing = false
    @State private var actionFailure: String?
    @State private var deleting: ProfileMediaDTO?
    /// Выбор фото для загрузки — по плавающей кнопке.
    @State private var picking = false
    @State private var picks: [PhotosPickerItem] = []
    /// Сколько файлов сейчас уходит; 0 — загрузки нет.
    @State private var uploadingCount = 0

    private let api = CommunityAPI()
    private var isMine: Bool { userID == viewerID }
    private var items: [ProfileMediaDTO] { (all ?? []).filter { $0.albumId == albumID } }

    private struct Loaded {
        var all: [ProfileMediaDTO]
        /// Альбом не нашёлся или список альбомов не пришёл — заголовок по умолчанию.
        var album: CommunityAlbumDTO?
    }

    private var all: [ProfileMediaDTO]? { remote.value?.all }
    private var album: CommunityAlbumDTO? { remote.value?.album }
    private var failure: String? { remote.failure }
    private var isOffline: Bool { remote.isOffline }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                if uploadingCount > 0 {
                    // Загрузка идёт — строкой над снимками, плавно появляется и уходит.
                    HStack(spacing: Spacing.md) {
                        ProgressView()
                        Text(String(localized: "community.albums.uploading", defaultValue: "Загружаем: \(uploadingCount.formatted())"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    .padding(.horizontal, Spacing.xl)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
                if let all {
                    if let failure {
                        StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                            .padding(.horizontal, Spacing.xl)
                    }
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
            .animation(Motion.calm, value: uploadingCount > 0)
        }
        .background(Palette.background)
        .navigationTitle(Text(album?.title ?? CommunityScreen.album(id: albumID, userID: userID).title))
        .navigationBarTitleDisplayMode(.inline)
        // Свои снимки из профиля — значком в панели навигации; загрузка новых — синей
        // плавающей кнопкой справа внизу, как «Новый альбом» в списке альбомов.
        .toolbar {
            if isMine {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        choosing = true
                    } label: {
                        Image(systemName: "photo.stack")
                    }
                    .accessibilityLabel(Text(String(localized: "community.albums.fromProfile", defaultValue: "Из профиля")))
                }
            }
        }
        .communityFloatingAction(
            isMine && uploadingCount == 0,
            String(localized: "community.albums.uploadHere", defaultValue: "Загрузить"),
            symbol: "square.and.arrow.up"
        ) {
            picking = true
        }
        .photosPicker(isPresented: $picking, selection: $picks, maxSelectionCount: 20, matching: .any(of: [.images, .videos]))
        .onChange(of: picks) { _, items in
            guard !items.isEmpty else { return }
            Task { await upload(items) }
        }
        .pullToRefresh { await load() }
        // Показ, возврат на экран и возврат приложения из фона — сохранённое на месте,
        // сеть обновляет фоном (`RemoteValue`).
        .task(id: AppLifecycle.shared.foregroundEpoch) { await load() }
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
                remote.value?.all.removeAll { $0.id == item.id }
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
                    let cover = try await api.setAlbumCover(id: albumID, fileID: item.id)
                    remote.value?.album = cover
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

    private func load() async {
        await remote.load(fetch)
    }

    /// Выбранное уходит в профиль и сразу раскладывается в этот альбом.
    private func upload(_ items: [PhotosPickerItem]) async {
        uploadingCount = items.count
        defer {
            uploadingCount = 0
            picks = []
        }
        let result = await CommunityMediaUpload.upload(items)
        if let failure = result.failure { actionFailure = failure }
        guard !result.done.isEmpty else { return }
        do {
            try await api.addToAlbum(id: albumID, fileIDs: result.done.map(\.id))
        } catch {
            actionFailure = error.userMessage
        }
        await load()
    }

    private func fetch() async throws -> Loaded {
        async let media = ProfileContentAPI().media(userID: userID)
        async let albums = api.albums(userID: userID)
        let all = try await media
        // Альбом — заголовок и обложка, не повод для ошибки экрана.
        let album = (try? await albums)?.first { $0.id == albumID }
        return Loaded(all: all, album: album)
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
