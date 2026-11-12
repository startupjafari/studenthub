import SwiftUI

// Запросы документов студенту (`/document-requests`): что просят, к какому сроку, и
// привязка своих документов из хранилища к пунктам запроса с отправкой.

struct CommunityDocumentRequestsView: View {
    @State private var reload = 0

    var body: some View {
        RemoteContent(reloadToken: reload) {
            try await CommunityAPI().documentRequests()
        } content: { requests in
            List {
                if !requests.isEmpty {
                    Section {
                        ForEach(requests) { request in
                            NavigationLink(value: AppRoute.community(.documentRequest(id: request.id))) {
                                TelegramStyleRow(
                                    title: request.title,
                                    subtitle: progress(request),
                                    meta: request.dueAt.map { DisplayFormat.date($0) },
                                    metaTint: (request.dueAt ?? .distantFuture) < Date() ? Palette.destructive : Palette.mutedForeground
                                ) {
                                    RowSymbol(symbol: "tray.and.arrow.up.fill", tint: TileTint.orange)
                                } accessory: {
                                    if let status = CommunityText.documentStatus(request.submissionStatus ?? request.status) {
                                        StatusBadge(text: status.text, tint: status.tint)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .screenState(requests.isEmpty) {
                EmptyStateView(
                    title: String(localized: "community.requests.empty", defaultValue: "Запросов нет"),
                    symbol: "tray",
                    hint: String(localized: "community.requests.empty.hint", defaultValue: "Когда деканат или преподаватель попросит документы, запрос появится здесь")
                )
            }
            .pullToRefresh { reload += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(CommunityScreen.documentRequests.title))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func progress(_ request: CommunityDocumentRequestDTO) -> String {
        let filled = (request.filledRequired ?? 0).formatted()
        let required = (request.requiredCount ?? 0).formatted()
        return String(localized: "community.requests.progress", defaultValue: "Обязательных заполнено: \(filled) из \(required)")
    }
}

struct CommunityDocumentRequestView: View {
    let requestID: String

    @State private var detail: CommunityDocumentRequestDetailDTO?
    /// `nil` — свои документы ещё не пришли или не загрузились (`documentsFailure`).
    @State private var documents: [CommunityDocumentDTO]?
    @State private var documentsFailure: String?
    @State private var documentsOffline = false
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var choosingFor: CommunityDocumentRequestDetailDTO.Item?
    @State private var isBusy = false
    @State private var submitted = 0
    @State private var uploading = false
    @State private var uploadType: String?

    private let api = CommunityAPI()

    var body: some View {
        Group {
            if let detail {
                content(detail)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(CommunityScreen.documentRequest(id: requestID).title))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $choosingFor) { item in
            CommunityDocumentChooser(
                title: item.title,
                documents: documents?.filter { $0.type == item.documentType && ($0.fileCount ?? $0.files?.count ?? 0) > 0 },
                failure: documentsFailure,
                isOffline: documentsOffline,
                retry: { await loadDocuments() },
                onUpload: {
                    uploadType = item.documentType
                    uploading = true
                }
            ) { document in
                Task { await link(item, documentID: document.id) }
            }
        }
        .sheet(isPresented: $uploading, onDismiss: { Task { await load() } }) {
            CommunityDocumentUploadView(presetType: uploadType) { _ in }
        }
        .sensoryFeedback(.success, trigger: submitted)
        .actionFailureAlert($actionFailure)
    }

    private func content(_ detail: CommunityDocumentRequestDetailDTO) -> some View {
        List {
            HeroHeader(
                visual: .symbol("tray.and.arrow.up.fill", tint: TileTint.orange),
                title: detail.title,
                subtitle: detail.dueAt.map { String(localized: "community.requests.due", defaultValue: "Срок: \(DisplayFormat.date($0))") },
                subtitleTint: (detail.dueAt ?? .distantFuture) < Date() ? Palette.destructive : Palette.mutedForeground
            ) {
                if let status = CommunityText.documentStatus(detail.submission?.status) {
                    StatusBadge(text: status.text, tint: status.tint)
                }
            }

            if let description = detail.description, !description.isEmpty {
                Section {
                    Text(description)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Section {
                ForEach(detail.items.sorted { ($0.order ?? 0) < ($1.order ?? 0) }) { item in
                    itemRow(item, entry: detail.submission?.items?.first { $0.requestItemId == item.id }, editable: detail.acceptsSubmissions != false)
                }
            } header: {
                Text(String(localized: "community.requests.items", defaultValue: "Что нужно"))
            } footer: {
                Text(String(localized: "community.requests.items.hint", defaultValue: "К пункту привязывается документ из раздела «Документы» того же типа и с файлом."))
            }

            if detail.acceptsSubmissions != false {
                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        HStack {
                            Label(String(localized: "community.requests.submit", defaultValue: "Отправить на проверку"), systemImage: "paperplane")
                            if isBusy { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(isBusy || !requiredFilled(detail))
                } footer: {
                    if !requiredFilled(detail) {
                        Text(String(localized: "community.requests.fillRequired", defaultValue: "Привяжите документы ко всем обязательным пунктам"))
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .pullToRefresh { await load() }
    }

    @ViewBuilder
    private func itemRow(
        _ item: CommunityDocumentRequestDetailDTO.Item,
        entry: CommunityDocumentRequestDetailDTO.Submission.Entry?,
        editable: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.required == true ? "\(item.title) *" : item.title)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                if let status = CommunityText.documentStatus(entry?.status), entry?.document != nil {
                    StatusBadge(text: status.text, tint: status.tint)
                }
            }
            Text(CommunityText.documentType(item.documentType))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            if let document = entry?.document {
                Label(document.title ?? CommunityText.documentType(document.type ?? item.documentType), systemImage: "doc.text")
                    .font(Typography.meta)
                    .foregroundStyle(Palette.primary)
            }
            if let reason = entry?.rejectionReason, !reason.isEmpty {
                Text(reason).font(Typography.meta).foregroundStyle(Palette.destructive)
            }
            if editable {
                HStack(spacing: Spacing.md) {
                    Button(entry?.document == nil
                        ? String(localized: "community.requests.attach", defaultValue: "Выбрать документ")
                        : String(localized: "community.requests.replace", defaultValue: "Заменить")) {
                        choosingFor = item
                    }
                    if entry?.document != nil {
                        Button(String(localized: "community.requests.detach", defaultValue: "Отвязать"), role: .destructive) {
                            Task { await link(item, documentID: nil) }
                        }
                    }
                }
                .buttonStyle(.borderless)
                .font(Typography.meta.weight(.medium))
                .padding(.top, Spacing.xs)
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    private func requiredFilled(_ detail: CommunityDocumentRequestDetailDTO) -> Bool {
        detail.items.filter { $0.required == true }.allSatisfy { item in
            detail.submission?.items?.contains { $0.requestItemId == item.id && $0.document != nil } ?? false
        }
    }

    @MainActor
    private func load() async {
        do {
            async let request = api.documentRequest(id: requestID)
            async let mine = api.allDocuments()
            detail = try await request
            failure = nil
            do {
                documents = try await mine
                documentsFailure = nil
            } catch is CancellationError {
                return
            } catch {
                documentsFailure = error.userMessage
                documentsOffline = error.isOffline
            }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    /// «Повторить» в выборе документа: только свои документы, без перезагрузки запроса.
    @MainActor
    private func loadDocuments() async {
        do {
            documents = try await api.allDocuments()
            documentsFailure = nil
        } catch is CancellationError {
            return
        } catch {
            documentsFailure = error.userMessage
            documentsOffline = error.isOffline
        }
    }

    /// Сервер принимает весь набор привязок разом — собираем его из текущих плюс изменение.
    @MainActor
    private func link(_ item: CommunityDocumentRequestDetailDTO.Item, documentID: String?) async {
        guard let detail else { return }
        var links: [(itemID: String, documentID: String?)] = (detail.submission?.items ?? []).compactMap { entry in
            guard entry.requestItemId != item.id, let id = entry.document?.id else { return nil }
            return (entry.requestItemId, id)
        }
        links.append((item.id, documentID))
        do {
            self.detail = try await api.saveSubmission(requestID: requestID, links: links)
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func submit() async {
        isBusy = true
        defer { isBusy = false }
        do {
            detail = try await api.submitRequest(id: requestID)
            submitted += 1
        } catch {
            actionFailure = error.userMessage
        }
    }
}

/// Выбор своего документа — для пункта запроса или требования заявки.
struct CommunityDocumentChooser: View {
    let title: String
    /// `nil` — свои документы ещё грузятся или не загрузились (тогда `failure`).
    let documents: [CommunityDocumentDTO]?
    var failure: String?
    var isOffline = false
    var retry: (() async -> Void)?
    var onUpload: (() -> Void)?
    let choose: (CommunityDocumentDTO) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let onUpload {
                    Section {
                        Button {
                            dismiss()
                            onUpload()
                        } label: {
                            IconRow(
                                title: String(localized: "community.documents.upload", defaultValue: "Загрузить документ"),
                                symbol: "doc.badge.plus",
                                tint: TileTint.blue
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                if let failure, documents == nil {
                    // Список не загрузился — не «Подходящих документов нет».
                    ErrorStateView(message: failure, isOffline: isOffline, retry: retry)
                        .listRowBackground(Color.clear)
                } else if documents == nil {
                    LoadingStateView().listRowBackground(Color.clear)
                } else if let documents, documents.isEmpty {
                    EmptyStateView(
                        title: String(localized: "community.documents.noneSuitable", defaultValue: "Подходящих документов нет"),
                        symbol: "doc",
                        hint: String(localized: "community.documents.noneSuitable.hint", defaultValue: "Загрузите документ нужного типа с файлом")
                    )
                    .listRowBackground(Color.clear)
                } else if let documents {
                    Section {
                        ForEach(documents) { document in
                            Button {
                                choose(document)
                                dismiss()
                            } label: {
                                CommunityDocumentRow(document: document)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
