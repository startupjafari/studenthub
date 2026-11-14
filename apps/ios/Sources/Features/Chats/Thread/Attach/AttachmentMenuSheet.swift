import CoreLocation
import Photos
import PhotosUI
import SwiftUI

/// Что выбрали в листе вложений и что панель ввода откроет, когда лист закроется:
/// системные окна (файлы, камера, контакты) поверх закрывающегося листа не открыть.
enum AttachmentPick {
    case assets([PHAsset])
    case photos([PhotosPickerItem])
    case camera
    case files
    /// Снимки из «Фото» — файлами, без сжатия («Выбрать из Галереи» во вкладке «Файл»).
    case photosAsFiles
    case scan
    case audio
    /// Системный выбор контакта — когда доступа к контактам нет.
    case contact
    /// Контакт из списка в листе — сразу на подтверждение.
    case contactCard(ContactCardDraft)
    /// Снимки из сетки с подписью — отправить сразу, как в Telegram, без листа отправки.
    case send(AttachmentSendRequest)
}

/// Отправка выбранного прямо из листа вложений: подпись и способ — из меню «⋯».
struct AttachmentSendRequest {
    enum Mode {
        /// Альбомом, обычное сжатие.
        case standard
        /// «Отправить без сжатия» — файлами.
        case files
        /// «Отправить в высоком качестве».
        case highQuality
        /// «Отправить без группировки» — каждое своим сообщением.
        case ungrouped
    }

    let assets: [PHAsset]
    let caption: String
    let mode: Mode
    /// «Скрыть под спойлер».
    let spoiler: Bool
}

/// Лист вложений как в Telegram: сверху — крестик и название раздела, ниже — его
/// содержимое (сетка «Фото», файлы, карта), внизу плавает стеклянная капсула разделов:
/// Галерея, Файл, Геопозиция, Опрос, Список, Звук, Контакт. Выбранный раздел — в
/// подсвеченной капсуле фирменного цвета. Опрос и список — такие же разделы листа, а не
/// отдельные окна: между ними и остальными переключаются капсулой, набранное остаётся.
struct AttachmentMenuSheet: View {
    enum Section: String, CaseIterable, Identifiable {
        case gallery, file, location, poll, checklist, audio, contact

        var id: String { rawValue }

        var title: String {
            switch self {
            case .gallery: String(localized: "chats.attach.gallery", defaultValue: "Галерея")
            case .file: String(localized: "chats.attachFile", defaultValue: "Файл")
            case .location: String(localized: "chats.attach.location", defaultValue: "Геопозиция")
            case .poll: String(localized: "chats.poll.new", defaultValue: "Опрос")
            case .checklist: String(localized: "chats.attach.checklist", defaultValue: "Список")
            case .audio: String(localized: "chats.attach.audio", defaultValue: "Звук")
            case .contact: String(localized: "chats.contact.title", defaultValue: "Контакт")
            }
        }

        var symbol: String {
            switch self {
            case .gallery: "photo.on.rectangle"
            case .file: "doc.fill"
            case .location: "mappin.circle.fill"
            case .poll: "chart.bar.fill"
            case .checklist: "checkmark.square.fill"
            case .audio: "play.circle.fill"
            case .contact: "person.crop.circle.fill"
            }
        }
    }

    /// Опрос есть только там, где есть кому голосовать (как в вебе).
    let allowsPoll: Bool
    /// Начатый в поле ввода чата текст — подписью к снимкам, как в Telegram.
    var initialCaption = ""
    let albumLimit: Int
    let onPick: (AttachmentPick) -> Void
    let onSendLocation: (_ coordinate: CLLocationCoordinate2D, _ title: String?, _ address: String?) async -> Bool
    let onSendLiveLocation: (_ location: CLLocation, _ period: Int) async -> Bool
    let onCreatePoll: (_ question: String, _ description: String?, _ options: [String], _ multiple: Bool, _ anonymous: Bool) async -> Bool
    let onCreateChecklist: (_ title: String, _ items: [String], _ othersCanAdd: Bool, _ othersCanMark: Bool) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @Environment(\.motionReduced) private var reduceMotion
    @State private var section: Section = .gallery
    @State private var selection: [PHAsset] = []
    @State private var detent: PresentationDetent = .medium
    @Namespace private var sectionSelection
    /// Раздел под пальцем, пока его ведут по капсуле.
    @State private var hoveredSection: Int?
    @State private var albums = PhotoAlbumsModel()
    @State private var poll = PollDraft()
    @State private var checklist = ChecklistDraft()
    /// Клавиатура поднята (печатают опрос или список) — капсула разделов уходит, как в
    /// Telegram: над клавиатурой она закрывала бы поля.
    @State private var keyboardShown = false
    /// Подпись к выбранным снимкам — в нижней строке листа, как в Telegram.
    @State private var caption = ""
    @FocusState private var captionFocused: Bool
    /// Вместо клавиатуры под подписью — emoji.
    @State private var showsEmoji = false
    @State private var spoiler = false

    private var isSelecting: Bool { section == .gallery && !selection.isEmpty }

    private var sections: [Section] {
        Section.allCases.filter { $0 != .poll || allowsPoll }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        // Полоса плавает над содержимым: сетка и списки прокручиваются из-под неё.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ZStack {
                if isSelecting {
                    captionBar
                        .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .bottom)))
                } else if !keyboardShown {
                    sectionBar
                        .transition(.opacity)
                }
            }
        }
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: selection.isEmpty)
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: keyboardShown)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            keyboardShown = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardShown = false
        }
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: showsEmoji)
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationContentInteraction(.scrolls)
        .onAppear { caption = initialCaption }
        // Подпись печатают во весь экран: лист раскрывается, как в Telegram.
        .onChange(of: captionFocused) { _, focused in
            if focused {
                showsEmoji = false
                withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) { detent = .large }
            }
        }
        .onChange(of: selection.isEmpty) { _, empty in
            if empty {
                captionFocused = false
                showsEmoji = false
                spoiler = false
            }
        }
    }

    /// Шапка как в Telegram: крестик, при выборе снимков — зелёная капсула «✓ N» рядом с
    /// ним и «⋯» со способами отправки справа; по центру — альбом или раздел.
    private var header: some View {
        ZStack {
            HStack(spacing: Spacing.sm) {
                GlassCloseButton { dismiss() }
                if isSelecting {
                    selectedBadge
                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                }
                Spacer()
                if isSelecting {
                    sendOptionsMenu
                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                } else {
                    trailingAction
                }
            }
            if section == .gallery, !albums.albums.isEmpty {
                albumMenu
            } else {
                Text(section.title)
                    .font(.headline)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.top, Spacing.lg)
        .padding(.bottom, Spacing.sm)
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: isSelecting)
    }

    /// «✓ N» — сколько снимков выбрано; касание снимает выбор.
    private var selectedBadge: some View {
        Button {
            selection = []
        } label: {
            HStack(spacing: 3) {
                Image(systemName: "checkmark")
                    .font(.caption.weight(.heavy))
                Text(selection.count.formatted())
                    .font(.subheadline.weight(.bold))
                    .contentTransition(.numericText())
            }
            .foregroundStyle(.white)
            .padding(.horizontal, Spacing.md)
            .frame(height: ControlHeight.xl)
            .background(Palette.success, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.pressable)
        .animation(Motion.respecting(Motion.snappy, reduceMotion: reduceMotion), value: selection.count)
        .accessibilityLabel(Text(String(localized: "chats.attach.selected", defaultValue: "Выбрано: \(selection.count)")))
        .accessibilityHint(Text(String(localized: "chats.attach.clearSelection", defaultValue: "Сбросить")))
    }

    /// «⋯» — способы отправки, как в Telegram: каждый пункт отправляет сразу, спойлер —
    /// переключатель.
    private var sendOptionsMenu: some View {
        Menu {
            Button {
                send(.files)
            } label: {
                Label(String(localized: "chats.attach.sendUncompressed", defaultValue: "Отправить без сжатия"), systemImage: "doc")
            }
            Button {
                send(.highQuality)
            } label: {
                Label(String(localized: "chats.attach.sendHighQuality", defaultValue: "Отправить в высоком качестве"), systemImage: "sparkles")
            }
            if selection.count > 1 {
                Button {
                    send(.ungrouped)
                } label: {
                    Label(String(localized: "chats.attach.sendUngrouped", defaultValue: "Отправить без группировки"), systemImage: "square.on.square.dashed")
                }
            }
            Divider()
            Toggle(isOn: $spoiler) {
                Label(String(localized: "chats.attach.spoiler", defaultValue: "Скрыть под спойлер"), systemImage: "eye.slash")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.body.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                .floatingGlass(in: Circle())
                .contentShape(Circle())
        }
        .accessibilityLabel(Text(String(localized: "chats.attach.sendOptions", defaultValue: "Способ отправки")))
    }

    /// Заголовок «Галереи» — выбор альбома, как в Telegram: «Недавние ⌄», в меню —
    /// альбомы с обложкой и числом снимков.
    private var albumMenu: some View {
        Menu {
            ForEach(albums.albums) { album in
                Button {
                    // «Недавние» — первый альбом: выбор его снимает фильтр.
                    albums.selected = album.id == albums.albums.first?.id ? nil : album
                } label: {
                    Label {
                        Text(album.title)
                        Text(album.count.formatted())
                    } icon: {
                        if let cover = albums.covers[album.id] {
                            Image(uiImage: cover)
                        } else {
                            Image(systemName: "photo.on.rectangle")
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: Spacing.xs) {
                Text(albums.title)
                    .font(.headline)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Palette.mutedForeground)
            }
            .foregroundStyle(Palette.foreground)
            .contentShape(Rectangle())
        }
        .accessibilityLabel(Text(String(localized: "chats.attach.album", defaultValue: "Альбом: \(albums.title)")))
    }

    /// Справа в шапке: «Отправить» у опроса и списка, у остальных — место под кнопку,
    /// чтобы заголовок стоял по центру.
    @ViewBuilder
    private var trailingAction: some View {
        switch section {
        case .poll:
            sendButton(canSend: poll.canCreate, isSending: poll.isSending) {
                if await poll.submit(onCreatePoll) { dismiss() }
            }
        case .checklist:
            sendButton(canSend: checklist.canCreate, isSending: checklist.isSending) {
                if await checklist.submit(onCreateChecklist) { dismiss() }
            }
        default:
            Color.clear.frame(width: ControlHeight.xl, height: ControlHeight.xl)
        }
    }

    /// «Отправить» той же высоты и в том же стекле, что крестик слева (`GlassCloseButton`):
    /// системный стиль `.glass` у кнопки с текстом выходил выше круга.
    private func sendButton(canSend: Bool, isSending: Bool, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            ZStack {
                Text(String(localized: "chats.send", defaultValue: "Отправить"))
                    .opacity(isSending ? 0 : 1)
                if isSending { ProgressView() }
            }
            .font(.body.weight(.semibold))
            .foregroundStyle(canSend ? Palette.primary : Palette.mutedForeground)
            .padding(.horizontal, Spacing.lg)
            .frame(height: ControlHeight.xl)
            .floatingGlass(in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.pressable)
        .disabled(!canSend || isSending)
    }

    @ViewBuilder
    private var content: some View {
        switch section {
        case .gallery:
            RecentMediaGrid(
                selection: $selection,
                albums: albums,
                limit: albumLimit,
                onCamera: { pick(.camera) },
                onPicked: { pick(.photos($0)) }
            )
        case .file:
            fileOptions
        case .location:
            LocationPickerView(
                onSend: { coordinate, title, address in
                    let ok = await onSendLocation(coordinate, title, address)
                    if ok { dismiss() }
                    return ok
                },
                // Трансляция выключена с сервера (`RemoteFeature.liveLocation`) — пункта
                // нет вовсе, отправка одной точки остаётся.
                onSendLive: RemoteFeatures.shared.isEnabled(.liveLocation)
                    ? { location, period in
                        let ok = await onSendLiveLocation(location, period)
                        if ok { dismiss() }
                        return ok
                    }
                    : nil
            )
        case .audio:
            audioOptions
        case .contact:
            ContactsListView(
                onPick: { pick(.contactCard($0)) },
                onSystemPicker: { pick(.contact) }
            )
        case .poll:
            PollForm(draft: poll)
        case .checklist:
            ChecklistForm(draft: checklist)
        }
    }

    /// «Звук» как в Telegram: выбор из «Файлов» карточкой, под ней — что можно отправить.
    private var audioOptions: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                optionRow(
                    String(localized: "chats.attach.audioFromFiles", defaultValue: "Выбрать из файлов"),
                    symbol: "folder"
                ) { pick(.audio) }
                .background(Palette.secondary, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))

                Text(String(localized: "chats.attach.audioHint", defaultValue: "Музыка и записи из «Файлов» — в чате с плеером"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .padding(.horizontal, Spacing.xl)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.sm)
        }
    }

    /// «Файл» как в Telegram: карточка с пунктами фирменного цвета, под ней — что можно
    /// отправить.
    private var fileOptions: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                VStack(spacing: 0) {
                    // Как в Telegram: снимки отсюда уходят файлами — без сжатия.
                    optionRow(
                        String(localized: "chats.attach.fromGallery", defaultValue: "Выбрать из Галереи"),
                        symbol: "photo"
                    ) { pick(.photosAsFiles) }
                    Divider().padding(.leading, Spacing.xl + 28 + Spacing.lg)
                    optionRow(
                        String(localized: "chats.attach.fromFiles", defaultValue: "Выбрать в «Файлах»"),
                        symbol: "folder"
                    ) { pick(.files) }
                    if DocumentScanner.isAvailable {
                        Divider().padding(.leading, Spacing.xl + 28 + Spacing.lg)
                        optionRow(
                            String(localized: "chats.attach.scan", defaultValue: "Сканировать документ"),
                            symbol: "doc.viewfinder"
                        ) { pick(.scan) }
                    }
                }
                .background(Palette.secondary, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))

                Text(String(localized: "chats.attach.fromFilesHint", defaultValue: "PDF, документы Office, архивы, видео — до 500 МБ"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .padding(.horizontal, Spacing.xl)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.sm)
        }
    }

    private func optionRow(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Spacing.lg) {
                Image(systemName: symbol)
                    .font(.title3)
                    .frame(width: 28)
                    .accessibilityHidden(true)
                Text(title)
                    .font(Typography.body)
                Spacer(minLength: 0)
            }
            .foregroundStyle(Palette.primary)
            .padding(.horizontal, Spacing.xl)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Капсула разделов внизу листа, как в Telegram: значок над подписью, выбранный
    /// раздел — фирменного цвета на подсвеченной подложке, которая переезжает пружиной.
    /// Раздел выбирают и скольжением пальца по капсуле (`slideSelection`), поэтому все
    /// разделы помещаются в неё без прокрутки вбок.
    private var sectionBar: some View {
        let items = sections
        let shown = hoveredSection.flatMap { items.indices.contains($0) ? items[$0] : nil } ?? section
        return HStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element) { index, item in
                let isCurrent = shown == item
                VStack(spacing: 2) {
                    Image(systemName: item.symbol)
                        .font(.title3)
                        .frame(height: 26)
                    Text(item.title)
                        .font(.caption2.weight(isCurrent ? .semibold : .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .foregroundStyle(isCurrent ? Palette.primary : Palette.foreground)
                .padding(.horizontal, 2)
                .frame(maxWidth: .infinity, minHeight: 54)
                .background {
                    if isCurrent {
                        Capsule()
                            .fill(Palette.foreground.opacity(0.1))
                            .matchedGeometryEffect(id: "section", in: sectionSelection)
                    }
                }
                .slideItemFrame(index, in: Self.barSpace)
                // VoiceOver и UI-тесты нажимают раздел как кнопку.
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(isCurrent ? [.isButton, .isSelected] : .isButton)
                .accessibilityAction { select(item) }
            }
        }
        .padding(Spacing.xs)
        .slideSelection(space: Self.barSpace, hovered: $hoveredSection) { index in
            if items.indices.contains(index) { select(items[index]) }
        }
        .floatingGlass(in: Capsule())
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.sm)
    }

    private static let barSpace = "attachSections"

    /// Выбраны снимки — вместо капсулы разделов строка подписи, как в Telegram:
    /// «Добавить подпись…», emoji и зелёная «Отправить». Отправка — сразу отсюда. Под
    /// строкой по кнопке emoji — панель emoji вместо клавиатуры.
    private var captionBar: some View {
        VStack(spacing: Spacing.sm) {
            HStack(alignment: .bottom, spacing: Spacing.sm) {
                HStack(alignment: .bottom, spacing: Spacing.xs) {
                    TextField(
                        String(localized: "chats.attach.captionPlaceholder", defaultValue: "Добавить подпись…"),
                        text: $caption,
                        axis: .vertical
                    )
                    .lineLimit(1...6)
                    .focused($captionFocused)
                    .padding(.leading, Spacing.lg)
                    .padding(.vertical, 10)
                    // Подпись уходит текстом сообщения — тот же лимит 4000, что у поля
                    // ввода: счётчик у края, сверх лимита «Отправить» неактивна.
                    ComposerLengthCounter(text: caption)
                        .padding(.vertical, 12)
                    Button {
                        if showsEmoji {
                            captionFocused = true
                        } else {
                            captionFocused = false
                            showsEmoji = true
                            withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) { detent = .large }
                        }
                    } label: {
                        Image(systemName: showsEmoji ? "keyboard" : "face.smiling")
                            .font(.title3)
                            .foregroundStyle(Palette.mutedForeground)
                            .frame(width: 40, height: 40)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(showsEmoji
                        ? String(localized: "chats.panel.keyboard", defaultValue: "Клавиатура")
                        : String(localized: "chats.panel.emoji", defaultValue: "Эмодзи")))
                }
                .floatingGlass(in: RoundedRectangle(cornerRadius: 22, style: .continuous))

                Button {
                    send(.standard)
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(Palette.primary, in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.pressable)
                .disabled(!captionFits)
                .opacity(captionFits ? 1 : 0.5)
                .accessibilityLabel(Text(String(localized: "chats.send", defaultValue: "Отправить")))
            }
            .padding(.horizontal, Spacing.lg)

            if showsEmoji {
                EmojiBrowser(columns: 8, bottomInset: 0) { emoji in caption += emoji }
                    .frame(height: 300)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.bottom, Spacing.sm)
    }

    /// Сервер не примет подпись длиннее лимита — и вложения не уйдут вместе с ней.
    private var captionFits: Bool { OutgoingText.remaining(caption) >= 0 }

    private func send(_ mode: AttachmentSendRequest.Mode) {
        guard !selection.isEmpty, captionFits else { return }
        pick(.send(AttachmentSendRequest(assets: selection, caption: caption, mode: mode, spoiler: spoiler)))
    }

    private func select(_ item: Section) {
        withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
            section = item
            // Любой раздел открывается компактным листом, как в Telegram; выше —
            // потянув за ручку.
            detent = .medium
        }
    }

    private func pick(_ choice: AttachmentPick) {
        onPick(choice)
        dismiss()
    }
}
