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
    case scan
    case audio
    case poll
    case checklist
    case contact
}

/// Лист вложений как в Telegram: сверху — крестик и название раздела, ниже — его
/// содержимое (сетка «Фото», файлы, карта), внизу плавает стеклянная капсула разделов:
/// Галерея, Файл, Геопозиция, Опрос, Список, Звук, Контакт. Выбранный раздел — в
/// подсвеченной капсуле фирменного цвета. Опрос, список, звук и контакт открывают свои
/// окна сразу.
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

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var section: Section = .gallery
    @State private var selection: [PHAsset] = []
    @State private var detent: PresentationDetent = .medium
    @Namespace private var sectionSelection

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
                } else {
                    sectionBar
                        .transition(.opacity)
                }
            }
        }
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: selection.isEmpty)
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationContentInteraction(.scrolls)
    }

    private var header: some View {
        HStack {
            GlassCloseButton { dismiss() }
            Spacer()
            Text(section == .gallery && !selection.isEmpty
                ? String(localized: "chats.attach.selected", defaultValue: "Выбрано: \(selection.count)")
                : section.title)
                .font(.headline)
                .contentTransition(.numericText())
            Spacer()
            // Место под кнопку слева, чтобы заголовок стоял по центру.
            Color.clear.frame(width: ControlHeight.xl, height: ControlHeight.xl)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.top, Spacing.lg)
        .padding(.bottom, Spacing.sm)
    }

    @ViewBuilder
    private var content: some View {
        switch section {
        case .gallery:
            RecentMediaGrid(
                selection: $selection,
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
        default:
            Color.clear
        }
    }

    /// «Файл» как в Telegram: карточка с пунктами фирменного цвета, под ней — что можно
    /// отправить.
    private var fileOptions: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                VStack(spacing: 0) {
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
    private var sectionBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(sections) { item in
                    let isCurrent = section == item
                    Button {
                        select(item)
                    } label: {
                        VStack(spacing: 2) {
                            Image(systemName: item.symbol)
                                .font(.title3)
                                .frame(height: 26)
                            Text(item.title)
                                .font(.caption2.weight(isCurrent ? .semibold : .medium))
                                .lineLimit(1)
                        }
                        .foregroundStyle(isCurrent ? Palette.primary : Palette.foreground)
                        .padding(.horizontal, Spacing.md)
                        .frame(minWidth: 68, minHeight: 54)
                        .background {
                            if isCurrent {
                                Capsule()
                                    .fill(Palette.foreground.opacity(0.1))
                                    .matchedGeometryEffect(id: "section", in: sectionSelection)
                            }
                        }
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isCurrent ? .isSelected : [])
                }
            }
            .padding(Spacing.xs)
        }
        .clipShape(Capsule())
        .floatingGlass(in: Capsule())
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.sm)
    }

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
        switch item {
        case .poll: pick(.poll)
        case .checklist: pick(.checklist)
        case .audio: pick(.audio)
        case .contact: pick(.contact)
        default:
            withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
                section = item
                // Любой раздел открывается компактным листом, как в Telegram; выше —
                // потянув за ручку.
                detent = .medium
            }
        }
    }

    private func pick(_ choice: AttachmentPick) {
        onPick(choice)
        dismiss()
    }
}
