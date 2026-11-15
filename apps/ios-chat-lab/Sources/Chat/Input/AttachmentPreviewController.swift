import UIKit

/// Предпросмотр выбранных фото/видео перед отправкой: сетка, подпись, «Отправить».
/// Подготовка файлов (сжатие, копирование) идёт в фоне с индикатором; альбом уходит
/// одним пакетом через `ChatViewController.sendAttachments`.
final class AttachmentPreviewController: UIViewController, UICollectionViewDataSource, UITextFieldDelegate {
    private weak var chat: ChatViewController?
    private var items: [PendingAttachment]
    private var thumbnails: [Int: UIImage] = [:]
    private let grid: UICollectionView
    private let bottomBar = UIView()
    private let captionField = UITextField()
    private let sendButton = UIButton(type: .custom)
    private let progressView = UIView()
    private let progressLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)
    private var isSending = false

    static func present(items: [PendingAttachment], from chat: ChatViewController) {
        let preview = AttachmentPreviewController(items: items, chat: chat)
        let navigation = UINavigationController(rootViewController: preview)
        navigation.modalPresentationStyle = .pageSheet
        if let sheet = navigation.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
        }
        chat.present(navigation, animated: true)
    }

    init(items: [PendingAttachment], chat: ChatViewController) {
        self.items = items
        self.chat = chat
        let layout = UICollectionViewFlowLayout()
        layout.minimumInteritemSpacing = 4
        layout.minimumLineSpacing = 4
        layout.sectionInset = UIEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
        grid = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        view.accessibilityIdentifier = "attach.preview"
        updateTitle()
        navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak self] _ in
            self?.dismiss(animated: true)
        })

        grid.backgroundColor = .clear
        grid.dataSource = self
        grid.register(PreviewCell.self, forCellWithReuseIdentifier: "cell")
        grid.keyboardDismissMode = .interactive
        grid.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(grid)

        bottomBar.backgroundColor = .secondarySystemBackground
        bottomBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bottomBar)
        captionField.placeholder = "Добавить подпись…"
        captionField.font = .systemFont(ofSize: 17)
        captionField.borderStyle = .none
        captionField.backgroundColor = Palette.inputFieldBackground
        captionField.layer.cornerRadius = 18
        captionField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 10))
        captionField.leftViewMode = .always
        captionField.returnKeyType = .send
        captionField.delegate = self
        captionField.accessibilityIdentifier = "attach.preview.caption"
        captionField.translatesAutoresizingMaskIntoConstraints = false
        bottomBar.addSubview(captionField)
        sendButton.setImage(UIImage(systemName: "arrow.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .bold)), for: .normal)
        sendButton.tintColor = .white
        sendButton.backgroundColor = Palette.accent
        sendButton.layer.cornerRadius = 18
        sendButton.accessibilityLabel = "Отправить"
        sendButton.accessibilityIdentifier = "attach.preview.send"
        sendButton.addAction(UIAction { [weak self] _ in self?.send() }, for: .touchUpInside)
        sendButton.translatesAutoresizingMaskIntoConstraints = false
        bottomBar.addSubview(sendButton)

        NSLayoutConstraint.activate([
            grid.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            grid.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            grid.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            grid.bottomAnchor.constraint(equalTo: bottomBar.topAnchor),
            bottomBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bottomBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bottomBar.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            bottomBar.heightAnchor.constraint(equalToConstant: 56),
            captionField.leadingAnchor.constraint(equalTo: bottomBar.leadingAnchor, constant: 12),
            captionField.centerYAnchor.constraint(equalTo: bottomBar.centerYAnchor),
            captionField.heightAnchor.constraint(equalToConstant: 36),
            sendButton.leadingAnchor.constraint(equalTo: captionField.trailingAnchor, constant: 8),
            sendButton.trailingAnchor.constraint(equalTo: bottomBar.trailingAnchor, constant: -12),
            sendButton.centerYAnchor.constraint(equalTo: bottomBar.centerYAnchor),
            sendButton.widthAnchor.constraint(equalToConstant: 36),
            sendButton.heightAnchor.constraint(equalToConstant: 36),
        ])

        progressView.backgroundColor = UIColor.black.withAlphaComponent(0.35)
        progressView.alpha = 0
        progressView.translatesAutoresizingMaskIntoConstraints = false
        progressView.accessibilityIdentifier = "attach.preview.progress"
        view.addSubview(progressView)
        spinner.color = .white
        spinner.translatesAutoresizingMaskIntoConstraints = false
        progressView.addSubview(spinner)
        progressLabel.textColor = .white
        progressLabel.font = .systemFont(ofSize: 15, weight: .medium)
        progressLabel.translatesAutoresizingMaskIntoConstraints = false
        progressView.addSubview(progressLabel)
        NSLayoutConstraint.activate([
            progressView.topAnchor.constraint(equalTo: view.topAnchor),
            progressView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            progressView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            spinner.centerXAnchor.constraint(equalTo: progressView.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: progressView.centerYAnchor),
            progressLabel.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 12),
            progressLabel.centerXAnchor.constraint(equalTo: progressView.centerXAnchor),
        ])

        loadThumbnails()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard let layout = grid.collectionViewLayout as? UICollectionViewFlowLayout else { return }
        let columns: CGFloat = items.count == 1 ? 1 : (items.count == 2 ? 2 : 3)
        let side = floor((grid.bounds.width - 16 - 4 * (columns - 1)) / columns)
        let size = CGSize(width: side, height: items.count == 1 ? min(side * 1.2, grid.bounds.height - 20) : side)
        if layout.itemSize != size, side > 0 {
            layout.itemSize = size
            layout.invalidateLayout()
        }
    }

    private func updateTitle() {
        let videos = items.filter(\.isVideo).count
        let photos = items.count - videos
        switch (photos, videos) {
        case (_, 0): title = photos == 1 ? "1 фото" : "\(photos) фото"
        case (0, _): title = videos == 1 ? "1 видео" : "\(videos) видео"
        default: title = "\(items.count) медиа"
        }
    }

    private func loadThumbnails() {
        let snapshot = items
        let scale = traitCollection.displayScale
        Task { @MainActor [weak self] in
            for (index, item) in snapshot.enumerated() {
                // Распаковка — вне главного потока, обновление сетки — на нём.
                let image = await Task.detached(priority: .userInitiated) {
                    AttachmentProcessing.thumbnail(for: item, maxPixel: 360 * scale)
                }.value
                guard let self, index < self.items.count else { return }
                self.thumbnails[index] = image
                self.grid.reloadItems(at: [IndexPath(item: index, section: 0)])
            }
        }
    }

    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { items.count }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "cell", for: indexPath) as! PreviewCell
        cell.configure(image: thumbnails[indexPath.item], isVideo: items[indexPath.item].isVideo)
        cell.onRemove = { [weak self, weak cell] in
            guard let self, let cell, let path = self.grid.indexPath(for: cell) else { return }
            self.remove(at: path.item)
        }
        return cell
    }

    private func remove(at index: Int) {
        guard items.count > 1 else {
            dismiss(animated: true)
            return
        }
        items.remove(at: index)
        var shifted: [Int: UIImage] = [:]
        for (key, value) in thumbnails where key != index { shifted[key > index ? key - 1 : key] = value }
        thumbnails = shifted
        grid.performBatchUpdates { grid.deleteItems(at: [IndexPath(item: index, section: 0)]) }
        updateTitle()
        view.setNeedsLayout()
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        send()
        return false
    }

    private func send() {
        guard !isSending, let chat else { return }
        isSending = true
        let caption = (captionField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let pending = items
        captionField.resignFirstResponder()
        progressLabel.text = "Подготовка 0 из \(pending.count)…"
        spinner.startAnimating()
        Motion.fade { self.progressView.alpha = 1 }
        sendButton.isEnabled = false
        Task { @MainActor [weak self] in
            var kinds: [MessageKind] = []
            do {
                for (index, item) in pending.enumerated() {
                    let kind = try await Task.detached(priority: .userInitiated) { try await AttachmentProcessing.process(item) }.value
                    kinds.append(kind)
                    self?.progressLabel.text = "Подготовка \(index + 1) из \(pending.count)…"
                }
            } catch {
                guard let self else { return }
                self.isSending = false
                self.sendButton.isEnabled = true
                self.spinner.stopAnimating()
                Motion.fade { self.progressView.alpha = 0 }
                let alert = UIAlertController(title: "Не удалось отправить", message: error.localizedDescription, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "OK", style: .default))
                self.present(alert, animated: true)
                return
            }
            self?.dismiss(animated: true) {
                chat.sendAttachments(kinds, caption: caption)
            }
        }
    }

    // MARK: Ячейка

    private final class PreviewCell: UICollectionViewCell {
        private let imageView = UIImageView()
        private let videoBadge = UIImageView(image: UIImage(systemName: "video.fill"))
        private let removeButton = UIButton(type: .system)
        private let spinner = UIActivityIndicatorView(style: .medium)
        var onRemove: (() -> Void)?

        override init(frame: CGRect) {
            super.init(frame: frame)
            contentView.layer.cornerRadius = 8
            contentView.clipsToBounds = true
            contentView.backgroundColor = .secondarySystemFill
            imageView.contentMode = .scaleAspectFill
            contentView.addSubview(imageView)
            videoBadge.tintColor = .white
            contentView.addSubview(videoBadge)
            contentView.addSubview(spinner)
            removeButton.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
            removeButton.tintColor = .white
            removeButton.accessibilityLabel = "Убрать"
            removeButton.addAction(UIAction { [weak self] _ in self?.onRemove?() }, for: .touchUpInside)
            contentView.addSubview(removeButton)
            accessibilityIdentifier = "attach.preview.item"
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        func configure(image: UIImage?, isVideo: Bool) {
            imageView.image = image
            videoBadge.isHidden = !isVideo
            if image == nil { spinner.startAnimating() } else { spinner.stopAnimating() }
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            imageView.frame = contentView.bounds
            videoBadge.frame = CGRect(x: 8, y: bounds.height - 22, width: 20, height: 14)
            removeButton.frame = CGRect(x: bounds.width - 34, y: 2, width: 32, height: 32)
            spinner.center = CGPoint(x: bounds.midX, y: bounds.midY)
        }
    }
}
