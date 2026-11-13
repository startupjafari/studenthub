import MapKit
import SwiftUI
import UIKit

// MARK: - Геопозиция

/// Точка на карте в пузыре: снимок карты с булавкой, название и адрес. Нажатие — в
/// «Карты» (маршрут, подробности).
struct LocationMessageView: View {
    let location: MessageExtras.Location
    let isOwn: Bool
    /// Сообщение на сервере — для «Остановить» у своей живой геопозиции.
    var messageID: String?

    @State private var snapshot: UIImage?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.displayScale) private var displayScale

    static let size = CGSize(width: 240, height: 140)

    var body: some View {
        Button(action: openInMaps) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                ZStack {
                    if let snapshot {
                        Image(uiImage: snapshot)
                            .resizable()
                            .scaledToFill()
                    } else {
                        Palette.muted
                    }
                    Image(systemName: "mappin.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(.white, Palette.destructive)
                        .shadow(radius: 2)
                }
                .frame(width: Self.size.width, height: Self.size.height)
                .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))

                if location.liveUntil != nil {
                    liveStatus
                } else if location.title != nil || location.address != nil {
                    VStack(alignment: .leading, spacing: 2) {
                        if let title = location.title {
                            Text(title)
                                .font(Typography.body.weight(.semibold))
                                .lineLimit(2)
                        }
                        if let address = location.address {
                            Text(address)
                                .font(Typography.meta)
                                .opacity(0.75)
                                .lineLimit(2)
                        }
                    }
                    .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
                    .frame(maxWidth: Self.size.width, alignment: .leading)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(String(
            localized: "chats.location.a11y",
            defaultValue: "Геопозиция: \(location.title ?? location.address ?? LocationPickerView.coordinates(coordinate))"
        )))
        .accessibilityHint(Text(String(localized: "chats.location.open", defaultValue: "Открыть в «Картах»")))
        .task(id: "\(location.lat),\(location.lng),\(scheme == .dark)") {
            snapshot = await MapSnapshots.image(for: coordinate, size: Self.size, scale: displayScale, dark: scheme == .dark)
        }
    }

    /// Живая геопозиция: «Трансляция до 14:30 · обновлено 2 мин назад», у своей —
    /// «Остановить». Минутный таймер освежает «N мин назад» без событий.
    private var liveStatus: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let live = location.isLive(at: context.date)
            HStack(spacing: Spacing.sm) {
                Image(systemName: live ? "location.fill" : "location.slash")
                    .symbolEffect(.pulse, isActive: live)
                VStack(alignment: .leading, spacing: 0) {
                    Text(live
                        ? String(localized: "chats.live.title", defaultValue: "Живая геопозиция")
                        : String(localized: "chats.live.ended", defaultValue: "Трансляция завершена"))
                        .font(Typography.meta.weight(.semibold))
                    if live, let until = location.liveUntil {
                        Text(Self.caption(until: until, updated: location.liveUpdatedAt, now: context.date))
                            .font(.caption)
                            .opacity(0.75)
                    }
                }
                Spacer(minLength: Spacing.sm)
                if live, isOwn, let messageID {
                    Button(String(localized: "chats.live.stop", defaultValue: "Остановить")) {
                        Task { await LiveLocationSharing.shared.stop(messageID: messageID) }
                    }
                    .font(Typography.meta.weight(.semibold))
                }
            }
            .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
            .frame(maxWidth: Self.size.width, alignment: .leading)
        }
    }

    static func caption(until: Date, updated: Date?, now: Date) -> String {
        let end = until.formatted(date: .omitted, time: .shortened)
        guard let updated else {
            return String(localized: "chats.live.until", defaultValue: "до \(end)")
        }
        let minutes = max(0, Int(now.timeIntervalSince(updated) / 60))
        if minutes == 0 {
            return String(localized: "chats.live.untilNow", defaultValue: "до \(end) · обновлено только что")
        }
        return String(localized: "chats.live.untilAgo", defaultValue: "до \(end) · обновлено \(minutes) мин назад")
    }

    private var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: location.lat, longitude: location.lng)
    }

    private func openInMaps() {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
        item.name = location.title ?? location.address
        item.openInMaps()
    }
}

/// Снимки карт в памяти: лента перерисовывает ячейки, а заново строить снимок на каждый
/// показ — это запрос к картам и заметная задержка.
@MainActor
enum MapSnapshots {
    private static let cache = NSCache<NSString, UIImage>()

    static func image(for coordinate: CLLocationCoordinate2D, size: CGSize, scale: CGFloat, dark: Bool) async -> UIImage? {
        let key = "\(coordinate.latitude),\(coordinate.longitude),\(size.width)x\(size.height)@\(scale),\(dark)" as NSString
        if let cached = cache.object(forKey: key) { return cached }
        let options = MKMapSnapshotter.Options()
        options.region = MKCoordinateRegion(center: coordinate, latitudinalMeters: 600, longitudinalMeters: 600)
        options.size = size
        options.scale = scale
        options.traitCollection = UITraitCollection(userInterfaceStyle: dark ? .dark : .light)
        guard let snapshot = try? await MKMapSnapshotter(options: options).start() else { return nil }
        cache.setObject(snapshot.image, forKey: key)
        return snapshot.image
    }
}

// MARK: - Контакт

/// Карточка контакта: инициалы, имя, телефон. Нажатие — позвонить, написать или
/// скопировать.
struct ContactMessageView: View {
    let contact: MessageExtras.Contact
    let isOwn: Bool

    @State private var showsActions = false
    @State private var copiedTick = 0

    /// Инициалы на цветном кружке, как у контакта в Telegram. Обычный аватар без фото —
    /// фирменный цвет на его же тоне — на своём синем пузыре сливался в пустое место.
    private var initialsCircle: some View {
        let letters = contact.name.split(separator: " ").prefix(2).compactMap(\.first)
        return Text(verbatim: letters.isEmpty ? "?" : String(letters).uppercased())
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Palette.primaryForeground)
            .frame(width: 44, height: 44)
            .background {
                if isOwn {
                    Circle().fill(Palette.primaryForeground.opacity(0.25))
                } else {
                    Circle().fill(SenderColor.color(for: contact.name).gradient)
                }
            }
            .accessibilityHidden(true)
    }

    var body: some View {
        Button {
            showsActions = true
        } label: {
            HStack(spacing: Spacing.lg) {
                initialsCircle
                VStack(alignment: .leading, spacing: 2) {
                    Text(contact.name)
                        .font(Typography.body.weight(.semibold))
                        .lineLimit(1)
                    if let first = contact.phones.first ?? contact.emails.first {
                        Text(first)
                            .font(Typography.meta)
                            .opacity(0.75)
                            .lineLimit(1)
                    }
                }
                .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
                Spacer(minLength: 0)
            }
            .frame(minWidth: 200)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.success, trigger: copiedTick)
        .confirmationDialog(contact.name, isPresented: $showsActions, titleVisibility: .visible) {
            ForEach(contact.phones, id: \.self) { phone in
                if let url = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
                    Button(String(localized: "chats.contact.call", defaultValue: "Позвонить \(phone)")) {
                        UIApplication.shared.open(url)
                    }
                }
            }
            ForEach(contact.emails, id: \.self) { email in
                if let url = URL(string: "mailto:\(email)") {
                    Button(String(localized: "chats.contact.mail", defaultValue: "Написать на \(email)")) {
                        UIApplication.shared.open(url)
                    }
                }
            }
            Button(String(localized: "chats.contact.copy", defaultValue: "Скопировать")) {
                UIPasteboard.general.string = ([contact.name] + contact.phones + contact.emails).joined(separator: "\n")
                copiedTick += 1
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text(String(localized: "chats.contact.hint", defaultValue: "Позвонить, написать или скопировать")))
    }
}

// MARK: - Общий список

/// Общий список дел: пункты с отметками, кто отметил, «Добавить пункт». Правки уходят
/// на сервер, свежее состояние приходит событием `checklist:updated` всем участникам.
struct ChecklistMessageView: View {
    let checklist: MessageExtras.Checklist
    let isOwn: Bool
    /// Автор сообщения — ему можно всё, остальным — по настройкам списка.
    let isAuthor: Bool
    var viewerID = ""

    @State private var busy: Set<String> = []
    @State private var adding = false
    @State private var newItem = ""
    @State private var failure: String?
    @State private var tick = 0
    private let api: ChatActing = ChatsAPI()
    private var realtime: RealtimeCoordinator { AppServices.realtime }

    private var current: MessageExtras.Checklist { realtime.checklistSignal(checklist.id).checklist ?? checklist }
    private var canMark: Bool { isAuthor || current.othersCanMark != false }
    private var canAdd: Bool { isAuthor || current.othersCanAdd != false }
    private var doneCount: Int { current.items.filter(\.done).count }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(current.title)
                    .font(Typography.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(String(
                    localized: "chats.checklist.progress",
                    defaultValue: "Выполнено \(doneCount) из \(current.items.count)"
                ))
                .font(Typography.meta)
                .opacity(0.7)
            }
            ForEach(current.items.sorted { ($0.order ?? 0) < ($1.order ?? 0) }) { item in
                row(item)
            }
            if canAdd, current.items.count < ChecklistDraft.maxItems {
                Button {
                    adding = true
                } label: {
                    Label(String(localized: "chats.checklist.add", defaultValue: "Добавить пункт"), systemImage: "plus")
                        .font(Typography.meta.weight(.semibold))
                }
                .buttonStyle(.plain)
            }
            if let failure {
                Text(failure)
                    .font(Typography.meta)
                    .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.destructive)
            }
        }
        .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
        .frame(minWidth: 220, alignment: .leading)
        .sensoryFeedback(.selection, trigger: tick)
        .alert(String(localized: "chats.checklist.add", defaultValue: "Добавить пункт"), isPresented: $adding) {
            TextField(String(localized: "chats.checklist.itemPlaceholder", defaultValue: "Что сделать"), text: $newItem)
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) { newItem = "" }
            Button(String(localized: "chats.checklist.addShort", defaultValue: "Добавить")) {
                let text = String(newItem.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
                newItem = ""
                guard !text.isEmpty else { return }
                Task { await apply { try await api.addChecklistItem(checklistID: current.id, text: text) } }
            }
        }
    }

    private func row(_ item: MessageExtras.Checklist.Item) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Button {
                guard canMark else { return }
                busy.insert(item.id)
                tick += 1
                Task {
                    await apply { try await api.toggleChecklistItem(checklistID: current.id, itemID: item.id, done: !item.done) }
                    busy.remove(item.id)
                }
            } label: {
                ZStack {
                    if busy.contains(item.id) {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .contentTransition(.symbolEffect(.replace))
                    }
                }
                .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .disabled(!canMark || busy.contains(item.id))
            .accessibilityLabel(Text(item.text))
            .accessibilityValue(Text(item.done
                ? String(localized: "chats.checklist.done", defaultValue: "Выполнено")
                : String(localized: "chats.checklist.notDone", defaultValue: "Не выполнено")))

            VStack(alignment: .leading, spacing: 0) {
                Text(item.text)
                    .font(Typography.body)
                    .strikethrough(item.done)
                    .opacity(item.done ? 0.7 : 1)
                    .fixedSize(horizontal: false, vertical: true)
                if item.done, let name = item.doneBy?.name, !name.isEmpty {
                    Text(name)
                        .font(.caption2)
                        .opacity(0.65)
                }
            }
            Spacer(minLength: 0)
            // Убрать пункт: автор списка и тот, кто пункт добавил (как проверяет сервер).
            if isAuthor || (item.createdById != nil && item.createdById == viewerID) {
                Button {
                    busy.insert(item.id)
                    Task {
                        await apply { try await api.removeChecklistItem(checklistID: current.id, itemID: item.id) }
                        busy.remove(item.id)
                    }
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption2.weight(.bold))
                        .opacity(0.55)
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(busy.contains(item.id))
                .accessibilityLabel(Text(String(localized: "chats.checklist.remove", defaultValue: "Убрать пункт")))
            }
        }
    }

    @MainActor
    private func apply(_ change: () async throws -> MessageExtras.Checklist) async {
        do {
            realtime.remember(try await change())
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Стикер

/// Стикер — без пузыря, крупной картинкой. Ссылку на картинку сервер подписывает на
/// время, поэтому она берётся по id при показе (и кэшируется загрузчиком картинок).
struct StickerMessageView: View {
    let sticker: MessageExtras.Sticker

    static let side: CGFloat = 160

    var body: some View {
        StickerImage(stickerID: sticker.id, emoji: sticker.emoji)
            .frame(width: Self.side, height: Self.side * aspect)
            .accessibilityLabel(Text(String(localized: "chats.sticker.a11y", defaultValue: "Стикер \(emoji)")))
    }

    private var emoji: String { sticker.emoji ?? "" }

    private var aspect: CGFloat {
        guard let width = sticker.width, let height = sticker.height, width > 0 else { return 1 }
        return min(max(CGFloat(height) / CGFloat(width), 0.5), 1.5)
    }
}

/// Картинка стикера по id: подписанная ссылка — у сервера, байты — в общем кэше.
struct StickerImage: View {
    let stickerID: String
    var emoji: String?
    /// Готовая подписанная ссылка (из каталога), если уже есть.
    var url: String?

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
            } else if failed {
                Text(verbatim: emoji ?? "🖼")
                    .font(.system(size: 64))
            } else {
                ProgressView()
            }
        }
        .task(id: stickerID) {
            image = await StickerImages.image(for: stickerID, knownURL: url)
            failed = image == nil
        }
    }
}

/// Кэш картинок стикеров: в памяти и на диске (каталог кэша), по id стикера.
@MainActor
enum StickerImages {
    private static let memory = NSCache<NSString, UIImage>()

    private static var directory: URL {
        let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("stickers", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static func image(for id: String, knownURL: String?) async -> UIImage? {
        if let cached = memory.object(forKey: id as NSString) { return cached }
        let file = directory.appendingPathComponent(id)
        if let data = try? Data(contentsOf: file), let image = UIImage(data: data) {
            memory.setObject(image, forKey: id as NSString)
            return image
        }
        // Ссылка из каталога живёт минуты: не открылась — просим свежую по id.
        var loaded = await download(knownURL)
        if loaded == nil, let fresh = try? await ChatsAPI().stickerURL(id: id).url {
            loaded = await download(fresh)
        }
        guard let (data, image) = loaded else { return nil }
        try? data.write(to: file, options: .atomic)
        memory.setObject(image, forKey: id as NSString)
        return image
    }

    private static func download(_ address: String?) async -> (Data, UIImage)? {
        guard let address, let url = URL(string: address),
            let (data, response) = try? await URLSession.shared.data(from: url),
            (response as? HTTPURLResponse)?.statusCode ?? 200 < 400,
            let image = UIImage(data: data)
        else { return nil }
        return (data, image)
    }
}
