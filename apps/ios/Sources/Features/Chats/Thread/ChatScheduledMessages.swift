import Observation
import SwiftUI

/// Отложенные сообщения чата, как в Telegram: долгое нажатие на «отправить» →
/// «Отправить позже», в поле ввода — часы, пока что-то ждёт отправки, по ним — список
/// «Отложенные сообщения» с «Отправить сейчас», «Изменить» и «Удалить».
///
/// Только свои и только текст: вложений у отложенных нет по дизайну сервера. Событий
/// сокета об отложенных нет — список перечитывается при открытии чата, после своих
/// изменений и когда подходит время самого раннего (его отправил cron сервера, и в ленту
/// оно пришло обычным `message:new`).
@Observable
final class ChatScheduledMessages {
    let chatID: String
    private(set) var items: [ScheduledMessageDTO] = []
    /// Открыт выбор времени для текста из поля ввода.
    var isPickingTime = false
    /// Открыт список «Отложенные сообщения».
    var showsList = false

    @ObservationIgnored private let api: ChatThreadTooling
    @ObservationIgnored private var refreshTask: Task<Void, Never>?

    init(chatID: String, api: ChatThreadTooling = ChatsAPI()) {
        self.chatID = chatID
        self.api = api
    }

    deinit {
        refreshTask?.cancel()
    }

    /// Самое раннее можно выбрать через минуту, самое позднее — через год без дня:
    /// так же проверяет сервер (`ScheduleMessageSchema`).
    static func allowedRange(now: Date = Date()) -> ClosedRange<Date> {
        now.addingTimeInterval(60)...now.addingTimeInterval(364 * 24 * 60 * 60)
    }

    /// Перечитать список. Ошибка сети не трогает уже показанное: часы в поле ввода
    /// не должны мигать от каждой неудачи.
    @MainActor
    func load() async {
        guard let list = try? await api.scheduled(chatID: chatID) else { return }
        items = list.sorted { $0.scheduledAt < $1.scheduledAt }
        planRefresh()
    }

    @MainActor
    func schedule(_ text: String, at date: Date, replyToID: String?, silent: Bool) async throws {
        let created = try await api.schedule(chatID: chatID, content: text, at: date, replyToID: replyToID, silent: silent)
        items = (items.filter { $0.id != created.id } + [created]).sorted { $0.scheduledAt < $1.scheduledAt }
        planRefresh()
    }

    @MainActor
    func update(_ item: ScheduledMessageDTO, text: String?, at date: Date?) async throws {
        let updated = try await api.updateScheduled(id: item.id, content: text, at: date)
        items = items.map { $0.id == updated.id ? updated : $0 }.sorted { $0.scheduledAt < $1.scheduledAt }
        planRefresh()
    }

    @MainActor
    func delete(_ item: ScheduledMessageDTO) async throws {
        try await api.deleteScheduled(id: item.id)
        items.removeAll { $0.id == item.id }
        planRefresh()
    }

    /// Отправить сейчас; сообщение возвращается — экран кладёт его в ленту сразу, не
    /// дожидаясь сокета.
    @MainActor
    func sendNow(_ item: ScheduledMessageDTO) async throws -> ChatMessageDTO {
        let sent = try await api.sendScheduledNow(id: item.id)
        items.removeAll { $0.id == item.id }
        planRefresh()
        return sent
    }

    /// Когда подойдёт время самого раннего — перечитать: сервер его отправил, и часы в
    /// поле ввода должны погаснуть вместе с последним.
    @MainActor
    private func planRefresh() {
        refreshTask?.cancel()
        guard let next = items.first?.scheduledAt else { return }
        let wait = max(next.timeIntervalSinceNow, 0) + 5
        refreshTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(wait))
            guard !Task.isCancelled else { return }
            await self?.load()
        }
    }
}

// MARK: - Пункты меню «отправить»

/// Меню долгого нажатия на «отправить»: без звука и позже. В правке сообщения меню нет —
/// там кнопка сохраняет, а не отправляет.
struct ScheduledSendMenuItems: View {
    let model: ChatThreadModel

    var body: some View {
        if model.editing == nil {
            Button {
                Task { await model.send(silent: true) }
            } label: {
                Label(String(localized: "chats.send.silent", defaultValue: "Отправить без звука"), systemImage: "bell.slash")
            }
            Button {
                model.scheduled.isPickingTime = true
            } label: {
                Label(String(localized: "chats.send.later", defaultValue: "Отправить позже"), systemImage: "calendar.badge.clock")
            }
        }
    }
}

/// Часы в поле ввода: есть отложенные — по касанию их список.
struct ScheduledComposerButton: View {
    let scheduled: ChatScheduledMessages

    var body: some View {
        if !scheduled.items.isEmpty {
            Button {
                scheduled.showsList = true
            } label: {
                Image(systemName: "clock")
                    .font(.title3)
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .transition(.scale(scale: 0.5).combined(with: .opacity))
            .accessibilityIdentifier("chat.scheduled")
            .accessibilityLabel(Text(String(localized: "chats.scheduled.title", defaultValue: "Отложенные сообщения")))
        }
    }
}

// MARK: - Выбор времени

/// Лист «Отправить позже» (и правка отложенного): быстрые варианты, барабан даты и
/// времени, при правке — ещё и текст. Время — не раньше чем через минуту и не дальше
/// года, как проверяет сервер.
struct ScheduleMessageSheet: View {
    /// Текст для правки; `nil` — уходит текст из поля ввода, править здесь нечего.
    let initialText: String?
    let initialDate: Date
    /// Сохранить; вернуть текст ошибки или `nil`, если получилось.
    let onConfirm: (_ text: String?, _ date: Date) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var date: Date
    @State private var isSaving = false
    @State private var failure: String?
    private let range = ChatScheduledMessages.allowedRange()

    init(initialText: String? = nil, initialDate: Date? = nil, onConfirm: @escaping (_ text: String?, _ date: Date) async -> String?) {
        self.initialText = initialText
        let start = initialDate ?? Date().addingTimeInterval(60 * 60)
        self.initialDate = start
        self.onConfirm = onConfirm
        _text = State(initialValue: initialText ?? "")
        _date = State(initialValue: start)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if initialText != nil {
                    Section {
                        TextField(
                            String(localized: "chats.placeholder", defaultValue: "Сообщение"),
                            text: $text,
                            axis: .vertical
                        )
                        .lineLimit(1...8)
                    }
                }
                Section {
                    ForEach(quickOptions, id: \.self) { option in
                        Button {
                            date = option
                        } label: {
                            HStack {
                                Text(Self.title(for: option))
                                    .foregroundStyle(Palette.foreground)
                                Spacer()
                                if abs(option.timeIntervalSince(date)) < 1 {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Palette.primary)
                                }
                            }
                        }
                    }
                }
                Section {
                    DatePicker(
                        String(localized: "chats.scheduled.when", defaultValue: "Когда"),
                        selection: $date,
                        in: range,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                    .datePickerStyle(.wheel)
                    .labelsHidden()
                    .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle(Text(initialText == nil
                ? String(localized: "chats.send.later", defaultValue: "Отправить позже")
                : String(localized: "chats.scheduled.edit", defaultValue: "Изменить")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(confirmTitle) {
                            Task { await confirm() }
                        }
                        .disabled(initialText != nil && trimmed.isEmpty)
                    }
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
        .presentationDetents([.medium, .large])
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var confirmTitle: String {
        initialText == nil
            ? String(localized: "chats.scheduled.schedule", defaultValue: "Запланировать")
            : String(localized: "common.save", defaultValue: "Сохранить")
    }

    private func confirm() async {
        // Лист простоял дольше минуты — ближайшая граница сдвинулась вместе с часами.
        let chosen = min(max(date, ChatScheduledMessages.allowedRange().lowerBound), range.upperBound)
        isSaving = true
        failure = await onConfirm(initialText == nil ? nil : trimmed, chosen)
        isSaving = false
        if failure == nil { dismiss() }
    }

    /// Через час, сегодня в 18:00 (если ещё не прошло), завтра в 9:00.
    private var quickOptions: [Date] {
        let calendar = Calendar.current
        let now = Date()
        var options = [now.addingTimeInterval(60 * 60)]
        if let evening = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: now),
            evening > now.addingTimeInterval(60 * 60)
        {
            options.append(evening)
        }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now),
            let morning = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow)
        {
            options.append(morning)
        }
        return options.map { min(max($0, range.lowerBound), range.upperBound) }
    }

    static func title(for date: Date) -> String {
        let time = date.formatted(date: .omitted, time: .shortened)
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return String(localized: "chats.scheduled.today", defaultValue: "Сегодня в \(time)")
        }
        if calendar.isDateInTomorrow(date) {
            return String(localized: "chats.scheduled.tomorrow", defaultValue: "Завтра в \(time)")
        }
        let day = date.formatted(.dateTime.day().month(.wide))
        return String(localized: "chats.scheduled.onDay", defaultValue: "\(day) в \(time)")
    }
}

// MARK: - Список

/// «Отложенные сообщения»: время и текст, касание — действия: отправить сейчас,
/// изменить, удалить.
struct ChatScheduledListView: View {
    let model: ChatThreadModel

    @Environment(\.dismiss) private var dismiss
    @State private var actions = ActionRunner()
    @State private var chosen: ScheduledMessageDTO?
    @State private var editing: ScheduledMessageDTO?
    @State private var deleting: ScheduledMessageDTO?

    private var scheduled: ChatScheduledMessages { model.scheduled }

    var body: some View {
        NavigationStack {
            List {
                ForEach(scheduled.items) { item in
                    Button {
                        chosen = item
                    } label: {
                        row(item)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            deleting = item
                        } label: {
                            Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                    }
                    .contextMenu { menu(item) }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if scheduled.items.isEmpty {
                    ContentUnavailableView(
                        String(localized: "chats.scheduled.empty", defaultValue: "Отложенных сообщений нет"),
                        systemImage: "clock"
                    )
                }
            }
            .navigationTitle(Text(String(localized: "chats.scheduled.title", defaultValue: "Отложенные сообщения")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .confirmationDialog(
                chosen.map { ScheduleMessageSheet.title(for: $0.scheduledAt) } ?? "",
                isPresented: Binding(get: { chosen != nil }, set: { if !$0 { chosen = nil } }),
                titleVisibility: .visible,
                presenting: chosen
            ) { item in
                menu(item)
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            }
            .confirmationDialog(
                String(localized: "chats.scheduled.delete.title", defaultValue: "Удалить отложенное сообщение?"),
                isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                titleVisibility: .visible,
                presenting: deleting
            ) { item in
                Button(String(localized: "feed.delete", defaultValue: "Удалить"), role: .destructive) {
                    Task { await actions.run { try await scheduled.delete(item) } }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            }
            .sheet(item: $editing) { item in
                ScheduleMessageSheet(initialText: item.content, initialDate: item.scheduledAt) { text, date in
                    do {
                        try await scheduled.update(
                            item,
                            text: text == item.content ? nil : text,
                            at: date == item.scheduledAt ? nil : date
                        )
                        return nil
                    } catch {
                        return error.userMessage
                    }
                }
            }
            .actionFailureAlert(actions)
            .task { await scheduled.load() }
        }
        .presentationDetents([.medium, .large])
    }

    private func row(_ item: ScheduledMessageDTO) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.xs) {
                Image(systemName: item.silent == true ? "bell.slash" : "clock")
                    .accessibilityHidden(true)
                Text(ScheduleMessageSheet.title(for: item.scheduledAt))
            }
            .font(Typography.meta.weight(.semibold))
            .foregroundStyle(Palette.primary)
            Text(item.content)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func menu(_ item: ScheduledMessageDTO) -> some View {
        Button {
            Task {
                await actions.run {
                    let sent = try await scheduled.sendNow(item)
                    await model.showSent(sent)
                }
            }
        } label: {
            Label(String(localized: "chats.scheduled.sendNow", defaultValue: "Отправить сейчас"), systemImage: "paperplane")
        }
        Button {
            editing = item
        } label: {
            Label(String(localized: "chats.scheduled.edit", defaultValue: "Изменить"), systemImage: "pencil")
        }
        Button(role: .destructive) {
            deleting = item
        } label: {
            Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
        }
    }
}
