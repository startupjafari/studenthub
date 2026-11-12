import SwiftUI

/// Опрос в сообщении.
///
/// Сам опрос приходит с сообщением, а голоса — отдельным запросом: они меняются чаще,
/// и сервер сообщает об этом событием `poll:updated`, по которому результаты
/// перечитываются.
struct ChatPollView: View {
    let poll: MessageExtras.Poll
    let isOwn: Bool

    @State private var results: PollResultsDTO?
    @State private var selection: Set<String> = []
    @State private var isVoting = false
    @State private var voteTick = 0
    @State private var confirmingClose = false
    @State private var failure: String?

    private let api: ChatActing = ChatsAPI()
    private var realtime: RealtimeCoordinator { AppServices.realtime }

    private var voted: Bool { !(results?.myOptionIds.isEmpty ?? true) }
    private var closed: Bool { results?.closed ?? poll.closed ?? false }
    private var multiple: Bool { results?.multiple ?? poll.multiple ?? false }
    private var showsResults: Bool { voted || closed }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(poll.question)
                    .font(Typography.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                if let note = poll.description, !note.isEmpty {
                    Text(note)
                        .font(Typography.meta)
                        .opacity(0.85)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(caption)
                    .font(.caption)
                    .opacity(0.75)
            }

            ForEach(poll.options.sorted { ($0.order ?? 0) < ($1.order ?? 0) }) { option in
                optionRow(option)
            }

            HStack {
                if let total = results?.totalVotes {
                    Text(String(localized: "chats.poll.votes", defaultValue: "Голосов: \(total)"))
                        .font(.caption)
                        .opacity(0.75)
                }
                Spacer()
                if multiple, !showsResults, !selection.isEmpty {
                    Button(String(localized: "chats.poll.vote", defaultValue: "Голосовать")) {
                        Task { await vote(Array(selection)) }
                    }
                    .font(Typography.meta.weight(.semibold))
                    .disabled(isVoting)
                } else if voted, !closed, results?.allowRevote ?? poll.allowRevote ?? true {
                    Button(String(localized: "chats.poll.retract", defaultValue: "Отменить голос")) {
                        Task { await vote([]) }
                    }
                    .font(Typography.meta)
                    .disabled(isVoting)
                }
            }
            if isOwn, !closed {
                Button(String(localized: "chats.poll.close", defaultValue: "Закрыть опрос")) {
                    confirmingClose = true
                }
                .font(Typography.meta.weight(.semibold))
                .disabled(isVoting)
            }
            if let failure {
                Text(failure)
                    .font(.caption)
                    .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.destructive)
            }
        }
        .confirmationDialog(
            String(localized: "chats.poll.closeQuestion", defaultValue: "Закрыть опрос? Голосовать больше будет нельзя."),
            isPresented: $confirmingClose,
            titleVisibility: .visible
        ) {
            Button(String(localized: "chats.poll.close", defaultValue: "Закрыть опрос"), role: .destructive) {
                Task { await close() }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
        .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
        .frame(minWidth: 220, alignment: .leading)
        .sensoryFeedback(.selection, trigger: voteTick)
        .task(id: realtime.pollVersions[poll.id] ?? 0) { await load() }
    }

    private var caption: String {
        if closed { return String(localized: "chats.poll.closed", defaultValue: "Опрос завершён") }
        let anonymous = results?.anonymous ?? poll.anonymous ?? false
        return anonymous
            ? String(localized: "chats.poll.anonymous", defaultValue: "Анонимный опрос")
            : String(localized: "chats.poll.public", defaultValue: "Открытый опрос")
    }

    private func optionRow(_ option: MessageExtras.Poll.Option) -> some View {
        let result = results?.options.first { $0.id == option.id }
        let total = max(results?.totalVotes ?? 0, 1)
        let share = Double(result?.votes ?? 0) / Double(total)
        let mine = results?.myOptionIds.contains(option.id) ?? false
        let selected = selection.contains(option.id)
        return Button {
            guard !showsResults, !closed else { return }
            if multiple {
                if selected { selection.remove(option.id) } else { selection.insert(option.id) }
            } else {
                Task { await vote([option.id]) }
            }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: Spacing.md) {
                    if !showsResults {
                        Image(systemName: multiple
                            ? (selected ? "checkmark.square.fill" : "square")
                            : "circle")
                    }
                    Text(option.text)
                        .font(Typography.meta.weight(mine ? .semibold : .regular))
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    if showsResults {
                        if mine { Image(systemName: "checkmark.circle.fill") }
                        Text(verbatim: share.formatted(.percent.precision(.fractionLength(0))))
                            .font(Typography.tabular(Typography.meta))
                    }
                }
                if showsResults {
                    GeometryReader { proxy in
                        Capsule()
                            .fill((isOwn ? Palette.primaryForeground : Palette.primary).opacity(0.25))
                            .overlay(alignment: .leading) {
                                Capsule()
                                    .fill(isOwn ? Palette.primaryForeground : Palette.primary)
                                    .frame(width: proxy.size.width * share)
                            }
                    }
                    .frame(height: 4)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isVoting)
        .accessibilityValue(Text(verbatim: showsResults ? share.formatted(.percent.precision(.fractionLength(0))) : ""))
        .accessibilityAddTraits(mine || selected ? .isSelected : [])
    }

    private func load() async {
        if let loaded = try? await api.poll(id: poll.id) { results = loaded }
    }

    private func close() async {
        isVoting = true
        defer { isVoting = false }
        do {
            try await api.closePoll(id: poll.id)
            failure = nil
            await load()
        } catch {
            failure = error.userMessage
        }
    }

    private func vote(_ options: [String]) async {
        isVoting = true
        defer { isVoting = false }
        do {
            try await api.vote(pollID: poll.id, optionIDs: options)
            selection = []
            voteTick += 1
            failure = nil
            await load()
        } catch {
            // Голос не принят (опрос закрыли, нет сети) — результаты прежние, причина видна.
            failure = error.userMessage
            await load()
        }
    }
}
