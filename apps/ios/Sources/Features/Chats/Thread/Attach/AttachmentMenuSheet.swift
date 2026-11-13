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
                if section == .gallery, !selection.isEmpty {
                    sendSelectionBar
                        .transition(.move(edge: .bottom).combined(with: .opacity))
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
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationContentInteraction(.scrolls)
    }

    private var header: some View {
        HStack {
            GlassCloseButton { dismiss() }
            Spacer()
            if section == .gallery, selection.isEmpty, !albums.albums.isEmpty {
                albumMenu
            } else {
                Text(section == .gallery && !selection.isEmpty
                    ? String(localized: "chats.attach.selected", defaultValue: "Выбрано: \(selection.count)")
                    : section.title)
                    .font(.headline)
                    .contentTransition(.numericText())
            }
            Spacer()
            trailingAction
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.top, Spacing.lg)
        .padding(.bottom, Spacing.sm)
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
        .buttonStyle(.plain)
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
                onSendLive: { location, period in
                    let ok = await onSendLiveLocation(location, period)
                    if ok { dismiss() }
                    return ok
                }
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

    /// Выбраны снимки — вместо разделов «Отправить N»: дальше лист с подписью и
    /// предпросмотром.
    private var sendSelectionBar: some View {
        HStack(spacing: Spacing.md) {
            Button(String(localized: "chats.attach.clearSelection", defaultValue: "Сбросить")) {
                selection = []
            }
            .glassButton()
            Button {
                pick(.assets(selection))
            } label: {
                Text(String(localized: "chats.attach.next", defaultValue: "Далее · \(selection.count)"))
                    .frame(maxWidth: .infinity)
            }
            .glassProminentButton()
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.sm)
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
