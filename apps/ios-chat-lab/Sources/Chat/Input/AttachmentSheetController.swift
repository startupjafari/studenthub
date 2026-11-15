import UIKit
import PhotosUI
import UniformTypeIdentifiers

/// Лист «Вложение» в духе Telegram: сверху лента тестовых фото с выбором, ниже — кнопки
/// «Галерея», «Камера», «Файл», «Тестовые фото». Выбор фото/видео ведёт в предпросмотр с
/// подписью, файл отправляется сразу.
final class AttachmentSheetController: UIViewController, UICollectionViewDataSource, UICollectionViewDelegate {
    private weak var chat: ChatViewController?
    private var photos: [MediaSpec] = []
    private var selected: [Int] = []
    private let titleLabel = UILabel()
    private let stripLabel = UILabel()
    private let strip: UICollectionView
    private let buttonsStack = UIStackView()
    private let nextButton = UIButton(type: .system)

    init(chat: ChatViewController) {
        self.chat = chat
        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.itemSize = CGSize(width: 96, height: 96)
        layout.minimumLineSpacing = 6
        layout.sectionInset = UIEdgeInsets(top: 0, left: 16, bottom: 0, right: 16)
        strip = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        view.accessibilityIdentifier = "attach.sheet"
        photos = MediaCatalog.photos.filter { MediaStorage.exists($0.file) } + MediaCatalog.videos.filter { MediaStorage.exists($0.file) }

        titleLabel.text = "Вложение"
        titleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        titleLabel.textAlignment = .center
        view.addSubview(titleLabel)

        stripLabel.text = photos.isEmpty ? "Тестовые медиа ещё готовятся…" : "Тестовые фото и видео"
        stripLabel.font = .systemFont(ofSize: 13)
        stripLabel.textColor = .secondaryLabel
        view.addSubview(stripLabel)

        strip.backgroundColor = .clear
        strip.dataSource = self
        strip.delegate = self
        strip.allowsMultipleSelection = true
        strip.showsHorizontalScrollIndicator = false
        strip.register(AttachmentThumbCell.self, forCellWithReuseIdentifier: "thumb")
        strip.accessibilityIdentifier = "attach.strip"
        view.addSubview(strip)

        buttonsStack.axis = .horizontal
        buttonsStack.distribution = .fillEqually
        buttonsStack.spacing = 8
        view.addSubview(buttonsStack)
        addButton("Галерея", symbol: "photo.on.rectangle", color: UIColor(rgb: 0x3E88F7), id: "attach.gallery") { [weak self] in self?.openGallery() }
        addButton("Камера", symbol: "camera.fill", color: UIColor(rgb: 0x8E8E93), id: "attach.camera") { [weak self] in self?.openCamera() }
        addButton("Файл", symbol: "doc.fill", color: UIColor(rgb: 0x34C759), id: "attach.file") { [weak self] in self?.openFiles() }
        addButton("Тестовые фото", symbol: "sparkles", color: UIColor(rgb: 0xFF9500), id: "attach.testPhotos") { [weak self] in self?.useTestPhotos() }

        var configuration = UIButton.Configuration.filled()
        configuration.cornerStyle = .capsule
        configuration.baseBackgroundColor = Palette.accent
        nextButton.configuration = configuration
        nextButton.accessibilityIdentifier = "attach.next"
        nextButton.alpha = 0
        nextButton.addAction(UIAction { [weak self] _ in self?.proceedWithSelection() }, for: .touchUpInside)
        view.addSubview(nextButton)
    }

    private func addButton(_ title: String, symbol: String, color: UIColor, id: String, action: @escaping () -> Void) {
        var configuration = UIButton.Configuration.plain()
        configuration.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .medium))
        configuration.imagePlacement = .top
        configuration.imagePadding = 8
        var attributed = AttributedString(title)
        attributed.font = .systemFont(ofSize: 12)
        configuration.attributedTitle = attributed
        configuration.baseForegroundColor = .label
        let button = UIButton(configuration: configuration)
        button.tintColor = color
        button.configurationUpdateHandler = { button in
            button.configuration?.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .medium))?
                .withTintColor(color, renderingMode: .alwaysOriginal)
        }
        button.accessibilityIdentifier = id
        button.accessibilityLabel = title
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        buttonsStack.addArrangedSubview(button)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let width = view.bounds.width
        titleLabel.frame = CGRect(x: 16, y: 18, width: width - 32, height: 22)
        stripLabel.frame = CGRect(x: 16, y: 52, width: width - 32, height: 18)
        strip.frame = CGRect(x: 0, y: 76, width: width, height: 100)
        buttonsStack.frame = CGRect(x: 12, y: 192, width: width - 24, height: 76)
        nextButton.frame = CGRect(x: 16, y: buttonsStack.frame.maxY + 16, width: width - 32, height: 48)
    }

    // MARK: Лента тестовых фото

    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { photos.count }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "thumb", for: indexPath) as! AttachmentThumbCell
        cell.configure(spec: photos[indexPath.item])
        cell.setOrder(selected.firstIndex(of: indexPath.item).map { $0 + 1 })
        return cell
    }

    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        toggle(indexPath)
    }

    func collectionView(_ collectionView: UICollectionView, didDeselectItemAt indexPath: IndexPath) {
        toggle(indexPath)
    }

    private func toggle(_ indexPath: IndexPath) {
        if let position = selected.firstIndex(of: indexPath.item) {
            selected.remove(at: position)
        } else if selected.count < 10 {
            selected.append(indexPath.item)
        }
        Haptics.selection()
        for case let cell as AttachmentThumbCell in strip.visibleCells {
            guard let path = strip.indexPath(for: cell) else { continue }
            cell.setOrder(selected.firstIndex(of: path.item).map { $0 + 1 })
        }
        nextButton.setTitle(selected.isEmpty ? nil : "Далее (\(selected.count))", for: .normal)
        Motion.spring(duration: 0.3) { self.nextButton.alpha = self.selected.isEmpty ? 0 : 1 }
    }

    private func proceedWithSelection() {
        let items = selected.map { PendingAttachment.catalog(photos[$0]) }
        openPreview(items)
    }

    // MARK: Источники

    private func useTestPhotos() {
        let available = MediaCatalog.photos.filter { MediaStorage.exists($0.file) }
        guard !available.isEmpty else {
            let alert = UIAlertController(title: "Тестовые фото ещё готовятся", message: "Подождите несколько секунд после первого запуска.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            present(alert, animated: true)
            return
        }
        openPreview(available.prefix(3).map { .catalog($0) })
    }

    private func openPreview(_ items: [PendingAttachment]) {
        guard let chat else { return }
        dismiss(animated: true) {
            AttachmentPreviewController.present(items: items, from: chat)
        }
    }

    private func openGallery() {
        guard let chat else { return }
        dismiss(animated: true) {
            AttachmentPickers.shared.presentGallery(from: chat)
        }
    }

    private func openCamera() {
        guard let chat else { return }
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            let alert = UIAlertController(title: "Камера недоступна", message: "На этом устройстве нет камеры. Используйте «Галерея» или «Тестовые фото».", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            present(alert, animated: true)
            return
        }
        dismiss(animated: true) {
            AttachmentPickers.shared.presentCamera(from: chat)
        }
    }

    private func openFiles() {
        guard let chat else { return }
        dismiss(animated: true) {
            AttachmentPickers.shared.presentFiles(from: chat)
        }
    }
}

final class AttachmentThumbCell: UICollectionViewCell {
    private let imageView = UIImageView()
    private let badge = UILabel()
    private let videoIcon = UIImageView(image: UIImage(systemName: "video.fill"))
    private var file: String?

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.layer.cornerRadius = 10
        contentView.layer.cornerCurve = .continuous
        contentView.clipsToBounds = true
        contentView.backgroundColor = .secondarySystemFill
        imageView.contentMode = .scaleAspectFill
        contentView.addSubview(imageView)
        videoIcon.tintColor = .white
        contentView.addSubview(videoIcon)
        badge.font = .systemFont(ofSize: 13, weight: .bold)
        badge.textColor = .white
        badge.textAlignment = .center
        badge.layer.cornerRadius = 11
        badge.layer.borderWidth = 1.5
        badge.layer.borderColor = UIColor.white.cgColor
        badge.layer.masksToBounds = true
        contentView.addSubview(badge)
        isAccessibilityElement = true
        accessibilityIdentifier = "attach.testPhoto"
        accessibilityTraits = .button
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(spec: MediaSpec) {
        file = spec.file
        videoIcon.isHidden = spec.kind != .video
        accessibilityLabel = spec.kind == .video ? "Видео" : "Фото"
        let source: ImagePipeline.Source = spec.kind == .video ? .videoFrame(spec.file) : .photo(spec.file)
        imageView.image = ImagePipeline.shared.load(source, pointSize: CGSize(width: 96, height: 96)) { [weak self] image in
            if self?.file == spec.file { self?.imageView.image = image }
        }
    }

    func setOrder(_ order: Int?) {
        badge.text = order.map(String.init)
        badge.backgroundColor = order == nil ? UIColor.black.withAlphaComponent(0.2) : Palette.accent
        accessibilityValue = order.map { "выбрано, \($0)" }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        imageView.frame = contentView.bounds
        badge.frame = CGRect(x: bounds.width - 28, y: 6, width: 22, height: 22)
        videoIcon.frame = CGRect(x: 6, y: bounds.height - 20, width: 18, height: 14)
    }
}

// MARK: - Системные пикеры

/// Делегаты системных пикеров держит одиночка: пикеры живут дольше листа вложений.
@MainActor
final class AttachmentPickers: NSObject, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate,
    UINavigationControllerDelegate, UIDocumentPickerDelegate
{
    static let shared = AttachmentPickers()
    private weak var chat: ChatViewController?

    func presentGallery(from chat: ChatViewController) {
        self.chat = chat
        var configuration = PHPickerConfiguration()
        configuration.filter = .any(of: [.images, .videos])
        configuration.selectionLimit = 10
        configuration.selection = .ordered
        configuration.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        chat.present(picker, animated: true)
    }

    func presentCamera(from chat: ChatViewController) {
        self.chat = chat
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.image.identifier, UTType.movie.identifier]
        picker.videoQuality = .typeHigh
        picker.delegate = self
        chat.present(picker, animated: true)
    }

    func presentFiles(from chat: ChatViewController) {
        self.chat = chat
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.allowsMultipleSelection = true
        picker.delegate = self
        chat.present(picker, animated: true)
    }

    // MARK: Галерея

    nonisolated func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        MainActor.assumeIsolated {
            picker.dismiss(animated: true)
            guard !results.isEmpty, let chat else { return }
            let providers = results.map(\.itemProvider)
            Task { @MainActor in
                var items: [PendingAttachment] = []
                for provider in providers {
                    if let item = await Self.load(provider) { items.append(item) }
                }
                guard !items.isEmpty else {
                    Toast.show("Не удалось загрузить выбранное", icon: "exclamationmark.triangle", in: chat.view, bottomInset: chat.bottomVisualInset)
                    return
                }
                AttachmentPreviewController.present(items: items, from: chat)
            }
        }
    }

    /// Видео — копия во временный файл (исходник живёт только внутри обработчика),
    /// фото — байты как есть.
    private static func load(_ provider: NSItemProvider) async -> PendingAttachment? {
        if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
            return await withCheckedContinuation { continuation in
                provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, _ in
                    guard let url else { return continuation.resume(returning: nil) }
                    let copy = FileManager.default.temporaryDirectory.appendingPathComponent("pick_\(UUID().uuidString).\(url.pathExtension.isEmpty ? "mov" : url.pathExtension)")
                    do {
                        try FileManager.default.copyItem(at: url, to: copy)
                        continuation.resume(returning: .video(copy))
                    } catch {
                        continuation.resume(returning: nil)
                    }
                }
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            return await withCheckedContinuation { continuation in
                provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                    continuation.resume(returning: data.map { .imageData($0) })
                }
            }
        }
        return nil
    }

    // MARK: Камера

    nonisolated func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        MainActor.assumeIsolated {
            picker.dismiss(animated: true)
            guard let chat else { return }
            if let url = info[.mediaURL] as? URL {
                AttachmentPreviewController.present(items: [.video(url)], from: chat)
            } else if let image = info[.originalImage] as? UIImage {
                AttachmentPreviewController.present(items: [.image(image)], from: chat)
            }
        }
    }

    nonisolated func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        MainActor.assumeIsolated { picker.dismiss(animated: true) }
    }

    // MARK: Файлы

    nonisolated func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        MainActor.assumeIsolated {
            guard let chat else { return }
            var kinds: [MessageKind] = []
            for url in urls {
                if let kind = try? AttachmentProcessing.storeFile(from: url) { kinds.append(kind) }
            }
            guard !kinds.isEmpty else {
                Toast.show("Не удалось прочитать файл", icon: "exclamationmark.triangle", in: chat.view, bottomInset: chat.bottomVisualInset)
                return
            }
            // Файлы — отдельными сообщениями, без альбома (как в Telegram).
            for kind in kinds { chat.sendAttachments([kind], caption: "") }
        }
    }
}
