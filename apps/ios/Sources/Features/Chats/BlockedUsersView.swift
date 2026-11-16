import Foundation
import Observation
import SwiftUI

// MARK: - Модель

/// Чёрный список, как «Конфиденциальность → Заблокированные» в Telegram и панель
/// блокировок в чатах веба: кого я заблокировал, снять блокировку, заблокировать нового.
///
/// Одна модель на экран и на строку настроек, которая его открывает: число справа в строке
/// меняется сразу после разблокировки, без повторного запроса.
@Observable
final class BlockedUsersModel {
    /// `nil` — список ещё не приходил: загрузка или сбой, а не «никого».
    private(set) var users: [BlockedUserDTO]?
    private(set) var loadFailure: String?
    private(set) var isOffline = false
    /// Отказ блокировки или разблокировки — строкой над списком, сам список на месте.
    private(set) var failure: String?
    /// Кого сейчас блокируют: повторное нажатие не шлёт второй запрос.
    private(set) var blockingID: String?

    private let api: ChatActing & ChatsFetching
    private let store: ChatStore

    init(api: ChatActing & ChatsFetching = ChatsAPI(), store: ChatStore = ChatStore()) {
        self.api = api
        self.store = store
    }

    @MainActor
    func load() async {
        do {
            users = try await api.blockedUsers()
            loadFailure = nil
        } catch is CancellationError {
            return
        } catch {
            loadFailure = error.userMessage
            isOffline = error.isOffline
        }
    }

    /// Строка уходит сразу, как в Telegram: отказ почти не случается, а если случится —
    /// человек вернётся на прежнее место вместе с причиной.
    @MainActor
    func unblock(_ user: BlockedUserDTO) async {
        guard let index = users?.firstIndex(where: { $0.id == user.id }) else { return }
        users?.remove(at: index)
        do {
            try await api.setBlocked(false, userID: user.id)
            failure = nil
            await syncChats(blocked: false, userID: user.id)
        } catch {
            if users?.contains(where: { $0.id == user.id }) == false {
                users?.insert(user, at: min(index, users?.count ?? 0))
            }
            if !(error is CancellationError) { failure = error.userMessage }
        }
    }

    @MainActor
    func block(userID: String) async {
        guard blockingID == nil else { return }
        blockingID = userID
        defer { blockingID = nil }
        do {
            try await api.setBlocked(true, userID: userID)
            failure = nil
            await syncChats(blocked: true, userID: userID)
            // Дату блокировки и порядок задаёт сервер — список перечитываем, а не
            // дописываем строку сами.
            await load()
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    /// Плашка «Вы заблокировали…» в переписке читает запись чата в базе. Флаг ставим
    /// сразу, а первую страницу списка тянем следом: сокет тоже пришлёт `chat:block`,
    /// но он может быть не на связи, а чат без сообщений собеседника по базе не найти.
    @MainActor
    private func syncChats(blocked: Bool, userID: String) async {
        try? await store.setBlocked(blocked, peerID: userID)
        Task { [api, store] in
            guard let page = try? await api.chats(cursor: nil, limit: ChatsAPI.pageLimit) else { return }
            try? await store.save(chats: page.items)
        }
    }
}

// MARK: - Экран

struct BlockedUsersView: View {
    @State private var model: BlockedUsersModel
    @State private var picking = false
    /// Выбранный в поиске человек ждёт, пока закроется лист: alert поверх уходящего листа
    /// iOS не показывает.
    @State private var picked: SearchResultsDTO.Person?
    @State private var confirming: SearchResultsDTO.Person?
    @Environment(\.viewerID) private var viewerID

    init(model: BlockedUsersModel = BlockedUsersModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if let users = model.users, !users.isEmpty {
                Section {
                    ForEach(users) { user in
                        row(user)
                    }
                } footer: {
                    Text(Self.footer)
                }
            }
        }
        .compactListStyle()
        .screenState(model.users?.isEmpty != false) {
            if model.users != nil {
                EmptyStateView(
                    title: String(localized: "chats.blocked.empty", defaultValue: "Вы никого не блокировали"),
                    symbol: "hand.raised",
                    hint: Self.footer,
                    actionTitle: String(localized: "chats.blocked.add", defaultValue: "Заблокировать пользователя"),
                    action: { picking = true }
                )
            } else if let failure = model.loadFailure {
                ErrorStateView(message: failure, isOffline: model.isOffline) { await model.load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(String(localized: "chats.blocked.title", defaultValue: "Заблокированные")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    picking = true
                } label: {
                    Image(systemName: "plus")
                }
                .disabled(model.blockingID != nil)
                .accessibilityLabel(Text(String(localized: "chats.blocked.add", defaultValue: "Заблокировать пользователя")))
            }
        }
        .pullToRefresh { await model.load() }
        .task {
            // Пришли из настроек — список уже там загружен; повторно не тянем.
            if model.users == nil { await model.load() }
        }
        .sheet(isPresented: $picking, onDismiss: {
            confirming = picked
            picked = nil
        }) {
            CommunityPersonPicker(
                title: String(localized: "chats.blocked.add", defaultValue: "Заблокировать пользователя")
            ) { person in
                // Себя сервер не заблокирует, а уже заблокированного — незачем.
                guard person.id != viewerID, model.users?.contains(where: { $0.id == person.id }) != true else { return }
                picked = person
            }
        }
        .alert(
            confirming.map { person in
                String(localized: "chats.blocked.confirm", defaultValue: "Заблокировать \(person.name)?")
            } ?? "",
            isPresented: Binding(
                get: { confirming != nil },
                set: { if !$0 { confirming = nil } }
            ),
            presenting: confirming
        ) { person in
            Button(String(localized: "chats.block", defaultValue: "Заблокировать"), role: .destructive) {
                Task { await model.block(userID: person.id) }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: { _ in
            Text(String(localized: "chats.block.message", defaultValue: "Он не сможет писать вам, дружба будет удалена."))
        }
    }

    private func row(_ user: BlockedUserDTO) -> some View {
        NavigationLink(value: AppRoute.profile(id: user.id)) {
            PersonRow(
                name: user.name.isEmpty
                    ? String(localized: "admin.support.deletedAuthor", defaultValue: "Удалённый пользователь")
                    : user.name,
                subtitle: user.blockedAt.map { date in
                    String(localized: "chats.blocked.since", defaultValue: "В списке с \(date.formatted(date: .abbreviated, time: .omitted))")
                },
                avatarURL: user.avatarUrl
            )
        }
        // Без подтверждения, как в Telegram: разблокировка ничего не стирает, а вернуть
        // человека в список — одно нажатие «+».
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button {
                Task { await model.unblock(user) }
            } label: {
                Label(String(localized: "chats.unblock", defaultValue: "Разблокировать"), systemImage: "hand.raised.slash")
            }
            .tint(Palette.primary)
        }
        .contextMenu {
            Button {
                Task { await model.unblock(user) }
            } label: {
                Label(String(localized: "chats.unblock", defaultValue: "Разблокировать"), systemImage: "hand.raised.slash")
            }
        }
    }

    private static var footer: String {
        String(
            localized: "chats.blocked.footer",
            defaultValue: "Заблокированные не могут писать вам в личные сообщения. Дружба с ними удаляется."
        )
    }
}
