import Photos
import PhotosUI
import SwiftUI

/// Сетка недавних снимков и роликов, как в листе вложений Telegram: первая плитка —
/// камера, на плитке — кружок с номером выбора, у ролика — длительность.
///
/// Миниатюры — через `PHCachingImageManager` по размеру плитки: полный кадр ради
/// плитки в сотню точек не раскодируем.
struct RecentMediaGrid: View {
    @Binding var selection: [PHAsset]
    let limit: Int
    let onCamera: () -> Void
    let onPicked: ([PhotosPickerItem]) -> Void

    @State private var status = PhotoAssets.status
    @State private var assets: [PHAsset] = []
    @State private var picked: [PhotosPickerItem] = []
    @Environment(\.displayScale) private var displayScale
    @State private var manager = PHCachingImageManager()

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    var body: some View {
        Group {
            switch status {
            case .authorized, .limited:
                grid
            case .notDetermined:
                prompt(
                    text: String(
                        localized: "chats.attach.photosPrompt",
                        defaultValue: "Разрешите доступ к «Фото», чтобы выбирать недавние снимки прямо здесь"
                    ),
                    action: String(localized: "chats.attach.photosAllow", defaultValue: "Разрешить доступ")
                ) {
                    Task {
                        status = await PhotoAssets.requestAccess()
                        reload()
                    }
                }
            default:
                prompt(
                    text: String(
                        localized: "chats.attach.photosDenied",
                        defaultValue: "Нет доступа к «Фото». Можно выбрать снимки в системном окне или разрешить доступ в настройках."
                    ),
                    action: String(localized: "chats.voice.openSettings", defaultValue: "Открыть настройки")
                ) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
            }
        }
        .onAppear(perform: reload)
        .onChange(of: picked) {
            guard !picked.isEmpty else { return }
            let items = picked
            picked = []
            onPicked(items)
        }
    }

    private var grid: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 2) {
                if CameraPicker.isAvailable {
                    Button(action: onCamera) {
                        tile {
                            Image(systemName: "camera.fill")
                                .font(.title2)
                                .foregroundStyle(Palette.primaryForeground)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .background(Palette.overlay.opacity(0.85))
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(String(localized: "chats.attachCamera", defaultValue: "Камера")))
                }
                ForEach(assets, id: \.localIdentifier) { asset in
                    AssetTile(
                        asset: asset,
                        manager: manager,
                        side: 140 * displayScale,
                        order: selection.firstIndex(of: asset).map { $0 + 1 }
                    ) {
                        toggle(asset)
                    }
                }
            }
            .padding(.horizontal, 2)
            pickerButton
                .padding(Spacing.lg)
        }
    }

    /// Системный выбор — для всего, чего нет среди недавних (и без доступа к «Фото»).
    private var pickerButton: some View {
        PhotosPicker(selection: $picked, maxSelectionCount: limit, matching: .any(of: [.images, .videos])) {
            Label(String(localized: "chats.attach.allPhotos", defaultValue: "Все фото и видео"), systemImage: "photo.on.rectangle")
                .frame(maxWidth: .infinity)
        }
        .glassButton()
    }

    private func prompt(text: String, action: String, perform: @escaping () -> Void) -> some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.largeTitle)
                .foregroundStyle(Palette.mutedForeground)
            Text(text)
                .font(Typography.body)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
            Button(action, action: perform)
                .glassProminentButton()
            pickerButton
        }
        .padding(Spacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func tile<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { content() }
            .clipped()
    }

    private func toggle(_ asset: PHAsset) {
        if let index = selection.firstIndex(of: asset) {
            selection.remove(at: index)
        } else if selection.count < limit {
            selection.append(asset)
        }
    }

    private func reload() {
        guard status == .authorized || status == .limited else { return }
        assets = PhotoAssets.recent()
    }
}

/// Плитка снимка: миниатюра, кружок выбора с номером, длительность ролика.
private struct AssetTile: View {
    let asset: PHAsset
    let manager: PHCachingImageManager
    let side: CGFloat
    let order: Int?
    let onTap: () -> Void

    @State private var image: UIImage?

    var body: some View {
        Button(action: onTap) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    if let image {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                    } else {
                        Palette.muted
                    }
                }
                .clipped()
                .overlay(alignment: .bottomLeading) {
                    if asset.mediaType == .video {
                        Text(verbatim: Self.duration(asset.duration))
                            .font(Typography.tabular(.caption2).weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, Spacing.xs)
                            .background(Palette.overlay.opacity(0.5), in: Capsule())
                            .padding(Spacing.xs)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    ZStack {
                        Circle()
                            .strokeBorder(.white, lineWidth: 1.5)
                            .background(Circle().fill(order == nil ? Palette.overlay.opacity(0.2) : Palette.primary))
                        if let order {
                            Text(verbatim: order.formatted())
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.white)
                        }
                    }
                    .frame(width: 24, height: 24)
                    .padding(Spacing.sm)
                }
                .overlay {
                    if order != nil {
                        Rectangle().strokeBorder(Palette.primary, lineWidth: 2)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(asset.mediaType == .video
            ? String(localized: "chats.attach.video", defaultValue: "Видео")
            : String(localized: "chats.attach.photo", defaultValue: "Фото")))
        .accessibilityAddTraits(order != nil ? .isSelected : [])
        .task(id: asset.localIdentifier) {
            image = await thumbnail()
        }
    }

    private func thumbnail() async -> UIImage? {
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.resizeMode = .fast
        return await withCheckedContinuation { continuation in
            var resumed = false
            manager.requestImage(
                for: asset,
                targetSize: CGSize(width: side, height: side),
                contentMode: .aspectFill,
                options: options
            ) { result, _ in
                // `highQualityFormat` отвечает один раз; страховка от второго вызова.
                guard !resumed else { return }
                resumed = true
                continuation.resume(returning: result)
            }
        }
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let whole = Int(seconds.rounded())
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }
}
