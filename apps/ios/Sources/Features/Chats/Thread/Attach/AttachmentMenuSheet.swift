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

/// Лист вложений как в Telegram: сверху — содержимое раздела (сетка «Фото», файлы,
/// карта), снизу — полоса разделов: Галерея, Файл, Геопозиция, Опрос, Список, Звук,
/// Контакт. Опрос, список, звук и контакт открывают свои окна сразу.
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
            case .gallery: "photo.fill"
            case .file: "doc.fill"
            case .location: "location.fill"
            case .poll: "chart.bar.fill"
            case .checklist: "checklist"
            case .audio: "music.note"
            case .contact: "person.crop.circle.fill"
            }
        }

        var tint: Color {
            switch self {
            case .gallery: Palette.primary
            case .file: Palette.info
            case .location: Palette.success
            case .poll: Palette.warning
            case .checklist: Palette.chart3
            case .audio: Palette.destructive
            case .contact: Palette.chart2
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

    private var sections: [Section] {
        Section.allCases.filter { $0 != .poll || allowsPoll }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if section == .gallery, !selection.isEmpty {
                sendSelectionBar
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else {
                sectionBar
            }
        }
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: selection.isEmpty)
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationContentInteraction(.scrolls)
    }

    private var header: some View {
        HStack {
            SheetCloseButton { dismiss() }
            Spacer()
            Text(section == .gallery && !selection.isEmpty
                ? String(localized: "chats.attach.selected", defaultValue: "Выбрано: \(selection.count)")
                : section.title)
                .font(.headline)
                .contentTransition(.numericText())
            Spacer()
            // Место под кнопку слева, чтобы заголовок стоял по центру.
            Color.clear.frame(width: ControlHeight.md, height: ControlHeight.md)
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

    private var fileOptions: some View {
        List {
            optionRow(
                String(localized: "chats.attach.fromFiles", defaultValue: "Выбрать в «Файлах»"),
                subtitle: String(localized: "chats.attach.fromFilesHint", defaultValue: "PDF, документы Office, архивы, видео — до 500 МБ"),
                symbol: "folder.fill"
            ) { pick(.files) }
            if DocumentScanner.isAvailable {
                optionRow(
                    String(localized: "chats.attach.scan", defaultValue: "Сканировать документ"),
                    subtitle: String(localized: "chats.attach.scanHint", defaultValue: "Страницы соберутся в один PDF"),
                    symbol: "doc.viewfinder.fill"
                ) { pick(.scan) }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func optionRow(_ title: String, subtitle: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Spacing.lg) {
                Image(systemName: symbol)
                    .foregroundStyle(Palette.primaryForeground)
                    .frame(width: 40, height: 40)
                    .background(Palette.info, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Typography.body).foregroundStyle(Palette.foreground)
                    Text(subtitle).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                }
            }
        }
        .listRowBackground(Color.clear)
    }

    /// Полоса разделов внизу листа — круглые значки с подписями.
    private var sectionBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                ForEach(sections) { item in
                    Button {
                        select(item)
                    } label: {
                        VStack(spacing: Spacing.xs) {
                            Image(systemName: item.symbol)
                                .font(.title3)
                                .foregroundStyle(section == item ? Palette.primaryForeground : item.tint)
                                .frame(width: 48, height: 48)
                                .background(section == item ? item.tint : item.tint.opacity(0.14), in: Circle())
                            Text(item.title)
                                .font(.caption2.weight(section == item ? .semibold : .regular))
                                .foregroundStyle(section == item ? Palette.foreground : Palette.mutedForeground)
                                .lineLimit(1)
                        }
                        .frame(minWidth: 64)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(section == item ? .isSelected : [])
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
        }
        .background(.bar)
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
        .padding(Spacing.lg)
        .background(.bar)
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
                if item == .location { detent = .large }
            }
        }
    }

    private func pick(_ choice: AttachmentPick) {
        onPick(choice)
        dismiss()
    }
}
