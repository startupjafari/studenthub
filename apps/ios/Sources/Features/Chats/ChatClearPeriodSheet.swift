import SwiftUI

/// Очистка истории у себя за период — с какого дня по какой, оба включительно, как в
/// вебе. Это скрытие «у себя»: у остальных участников переписка остаётся целой.
struct ChatClearPeriodSheet: View {
    let chatID: String
    /// После очистки: список чатов, например, обновляет превью — последнее сообщение
    /// могло попасть в период.
    var onCleared: () async -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var from = Calendar.current.startOfDay(for: Date())
    @State private var to = Date()
    @State private var confirming = false
    @State private var isClearing = false
    @State private var failure: String?
    private let api: ChatActing = ChatsAPI()

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    DatePicker(
                        String(localized: "chats.clearPeriod.from", defaultValue: "С"),
                        selection: $from,
                        in: ...Date(),
                        displayedComponents: .date
                    )
                    DatePicker(
                        String(localized: "chats.clearPeriod.to", defaultValue: "По"),
                        selection: $to,
                        in: from...max(from, Date()),
                        displayedComponents: .date
                    )
                } footer: {
                    Text(String(
                        localized: "chats.clearPeriod.hint",
                        defaultValue: "Сообщения за эти дни пропадут только у вас. У собеседников переписка останется."
                    ))
                }
                Section {
                    Button(role: .destructive) {
                        confirming = true
                    } label: {
                        HStack {
                            Spacer()
                            if isClearing {
                                ProgressView()
                            } else {
                                Text(String(localized: "chats.clear", defaultValue: "Очистить историю"))
                            }
                            Spacer()
                        }
                    }
                    .disabled(isClearing)
                }
            }
            .navigationTitle(Text(String(localized: "chats.clearPeriod.title", defaultValue: "Очистить за период")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                        .disabled(isClearing)
                }
            }
            .interactiveDismissDisabled(isClearing)
            // Начало позже конца — конец догоняет его: период не может быть пустым.
            .onChange(of: from) {
                if to < from { to = from }
            }
            .alert(
                String(localized: "chats.clearPeriod.confirm", defaultValue: "Очистить историю за период?"),
                isPresented: $confirming
            ) {
                Button(String(localized: "chats.clear", defaultValue: "Очистить историю"), role: .destructive) {
                    Task { await clear() }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            } message: {
                Text(String(
                    localized: "chats.clearPeriod.confirm.message",
                    defaultValue: "С \(Self.format(from)) по \(Self.format(to)). У собеседников переписка останется."
                ))
            }
        }
        .presentationDetents([.medium, .large])
    }

    private static func format(_ day: Date) -> String {
        day.formatted(.dateTime.day().month(.wide).year())
    }

    /// Границы — начало первого дня и последняя миллисекунда последнего: сервер
    /// сравнивает время сообщения включительно, и полночь отрезала бы последний день.
    @MainActor
    private func clear() async {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: from)
        let nextDay = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: to)) ?? to
        let end = nextDay.addingTimeInterval(-0.001)
        isClearing = true
        defer { isClearing = false }
        do {
            try await api.clearHistory(chatID: chatID, from: start, to: end)
            // Лента читает базу: без этого очищенное оставалось бы на экране.
            try await MessageStore().clearHistory(chatID: chatID, from: start, to: end)
            await onCleared()
            dismiss()
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }
}
