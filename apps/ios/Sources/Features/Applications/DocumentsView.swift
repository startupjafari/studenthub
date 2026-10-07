import SwiftUI

/// Документы: справки и файлы, выданные вузом.
///
/// Ссылка на файл запрашивается в момент открытия, а не хранится: она подписанная
/// и короткоживущая, и сохранённая вчера сегодня ведёт в отказ.
struct DocumentsView: View {
    @State private var model = StudySectionModel<[DocumentDTO]> {
        try await ApplicationsAPI().documents().items
    }
    @State private var opening: String?
    @State private var failure: String?
    @State private var shareURL: URL?

    private let api = ApplicationsAPI()

    var body: some View {
        List {
            if let failure = failure ?? model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            ForEach(model.value ?? []) { document in
                Section {
                    ForEach(document.files ?? []) { file in
                        Button {
                            Task { await open(document: document.id, file: file.id) }
                        } label: {
                            HStack {
                                Label(
                                    file.name ?? String(localized: "chats.file", defaultValue: "Файл"),
                                    systemImage: "doc.text"
                                )
                                .font(Typography.body)
                                Spacer()
                                if opening == file.id {
                                    ProgressView()
                                } else {
                                    Image(systemName: "square.and.arrow.down")
                                        .foregroundStyle(Palette.mutedForeground)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }

                    if document.files?.isEmpty ?? true {
                        Text(String(localized: "documents.noFiles", defaultValue: "Файлов нет"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                } header: {
                    Text(document.title ?? document.typeName ?? String(
                        localized: "more.documents",
                        defaultValue: "Документы"
                    ))
                }
                .listRowBackground(Palette.card)
            }

            if model.value?.isEmpty ?? false {
                EmptyRow(text: String(localized: "documents.empty", defaultValue: "Документов пока нет"))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "more.documents", defaultValue: "Документы")))
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
        .sheet(item: Binding(get: { shareURL.map(ShareItem.init) }, set: { shareURL = $0?.url })) { item in
            // Системный лист «Поделиться» — он же сохраняет в «Файлы»: своего
            // хранилища документов у приложения нет и быть не должно.
            ShareLink(item: item.url) {
                Label(
                    String(localized: "documents.save", defaultValue: "Сохранить"),
                    systemImage: "square.and.arrow.down"
                )
            }
            .padding(Spacing.xxl)
            .presentationDetents([.height(160)])
        }
    }

    private func open(document: String, file: String) async {
        guard opening == nil else { return }
        opening = file
        defer { opening = nil }
        do {
            shareURL = try await api.fileURL(documentID: document, fileID: file)
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }
}

/// Обёртка для `sheet(item:)`: `URL` сам по себе не `Identifiable`.
private struct ShareItem: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}
