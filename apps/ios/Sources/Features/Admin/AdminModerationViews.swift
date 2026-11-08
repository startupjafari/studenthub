import SwiftUI

// MARK: - Модерация публикаций

/// Публикации, которые роль вправе снимать: платформа — все вузы, вуз — свой. Пост
/// открывается целиком, снять или закрепить — жестом по строке.
struct AdminPostsModerationView: View {
    @State private var loader = PagedLoader<PostDTO>(limit: 20) { request in
        try await AdminAPI().moderationPosts(request: request)
    }
    @State private var deleting: PostDTO?
    @State private var actionFailure: String?

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "admin.posts.empty", defaultValue: "Публикаций нет"),
                symbol: "newspaper"
            )
        ) { post in
            NavigationLink(value: AppRoute.post(id: post.id)) {
                AdminPostRow(post: post)
            }
            .swipeActions(edge: .trailing) {
                Button(role: .destructive) {
                    deleting = post
                } label: {
                    Label(String(localized: "admin.posts.delete", defaultValue: "Удалить"), systemImage: "trash")
                }
            }
            .swipeActions(edge: .leading) {
                Button {
                    Task { await pin(post) }
                } label: {
                    Label(
                        post.pinnedAt == nil
                            ? String(localized: "admin.posts.pin", defaultValue: "Закрепить")
                            : String(localized: "admin.posts.unpin", defaultValue: "Открепить"),
                        systemImage: post.pinnedAt == nil ? "pin" : "pin.slash"
                    )
                }
                .tint(Palette.primary)
            }
            .contextMenu {
                Button {
                    Task { await pin(post) }
                } label: {
                    Label(
                        post.pinnedAt == nil
                            ? String(localized: "admin.posts.pin", defaultValue: "Закрепить")
                            : String(localized: "admin.posts.unpin", defaultValue: "Открепить"),
                        systemImage: post.pinnedAt == nil ? "pin" : "pin.slash"
                    )
                }
                Button(role: .destructive) {
                    deleting = post
                } label: {
                    Label(String(localized: "admin.posts.delete", defaultValue: "Удалить"), systemImage: "trash")
                }
            }
        }
        .navigationTitle(Text(AdminScreen.postsModeration.title))
        .confirmDestructive(
            $deleting,
            title: { _ in String(localized: "admin.posts.deleteConfirm", defaultValue: "Удалить публикацию? Она пропадёт у всех.") },
            actionTitle: String(localized: "admin.posts.delete", defaultValue: "Удалить")
        ) { post in
            await delete(post)
        }
        .actionFailureAlert($actionFailure)
    }

    @MainActor
    private func delete(_ post: PostDTO) async {
        do {
            try await AdminAPI().deletePost(id: post.id)
            loader.remove(id: post.id)
        } catch {
            actionFailure = error.userMessage
        }
    }

    /// Закрепить можно только пост автора ниже по роли — иначе сервер ответит 403.
    @MainActor
    private func pin(_ post: PostDTO) async {
        do {
            try await AdminAPI().pinPost(id: post.id, pinned: post.pinnedAt == nil)
            await loader.reload()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

private struct AdminPostRow: View {
    let post: PostDTO

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.md) {
                AvatarView(url: post.author?.avatarUrl, name: post.author?.name, size: 32)
                VStack(alignment: .leading, spacing: 0) {
                    Text(post.speaker?.name ?? post.author?.name ?? "—")
                        .font(Typography.meta.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(1)
                    Text(DisplayFormat.dateTime(post.publishedAt ?? post.createdAt))
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                }
                Spacer(minLength: Spacing.md)
                if post.pinnedAt != nil {
                    Image(systemName: "pin.fill")
                        .foregroundStyle(Palette.primary)
                        .accessibilityLabel(Text(String(localized: "admin.posts.pinned", defaultValue: "Закреплено")))
                }
            }
            if let title = post.title, !title.isEmpty {
                Text(title).font(Typography.cardTitle).foregroundStyle(Palette.foreground).lineLimit(2)
            }
            if let content = post.content, !content.isEmpty {
                Text(content).font(Typography.body).foregroundStyle(Palette.foreground).lineLimit(4)
            }
            let media = post.media?.count ?? 0
            Text(verbatim: [
                media > 0 ? String(localized: "admin.posts.media", defaultValue: "Вложений: \(media.formatted())") : nil,
                String(localized: "admin.posts.comments", defaultValue: "Комментариев: \(post.commentsCount.formatted())"),
                post.views.map { String(localized: "admin.posts.views", defaultValue: "Просмотров: \($0.formatted())") },
            ].compactMap { $0 }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(Palette.mutedForeground)
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Спец-доступ к документам

/// Доступ к содержимому чужих документов — только по обоснованной причине. Каждое
/// открытие пишется в аудит и журнал документа вместе с причиной; журнал обращений ниже.
struct AdminDocumentAccessView: View {
    @State private var documentID = ""
    @State private var reason = ""
    @State private var document: AdminPlatformDocumentDTO?
    @State private var grantedReason = ""
    @State private var urls: [String: String] = [:]
    @State private var isLoading = false
    @State private var failure: String?
    @State private var log: [AdminAuditEntryDTO]?
    @State private var logFailure: String?
    @State private var opener = RemoteFileOpener()

    private let api = AdminAPI()
    private static let reasonMin = 5

    private var canSubmit: Bool {
        !documentID.trimmingCharacters(in: .whitespaces).isEmpty
            && reason.trimmingCharacters(in: .whitespacesAndNewlines).count >= Self.reasonMin
    }

    var body: some View {
        List {
            Section {
                Label(
                    String(localized: "admin.docs.warning", defaultValue: "Каждое открытие файла фиксируется в аудите и в журнале документа вместе с причиной."),
                    systemImage: "exclamationmark.triangle"
                )
                .font(Typography.meta)
                .foregroundStyle(Palette.warning)
                TextField(String(localized: "admin.docs.id", defaultValue: "ID документа"), text: $documentID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                TextField(String(localized: "admin.docs.reason", defaultValue: "Причина доступа"), text: $reason, axis: .vertical)
                    .lineLimit(2...4)
                Button {
                    Task { await open() }
                } label: {
                    HStack {
                        if isLoading { ProgressView() }
                        Text(String(localized: "admin.docs.open", defaultValue: "Открыть документ"))
                    }
                }
                .disabled(!canSubmit || isLoading)
            } footer: {
                if let failure {
                    Text(failure).foregroundStyle(Palette.destructive)
                } else {
                    Text(String(localized: "admin.docs.reasonHint", defaultValue: "Например: проверка жалобы №12. Не короче 5 символов."))
                }
            }

            if let document {
                documentSection(document)
            }

            Section {
                if let log {
                    if log.isEmpty {
                        Text(String(localized: "admin.docs.logEmpty", defaultValue: "Обращений к чужим документам ещё не было"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(log) { entry in
                        AdminDocumentLogRow(entry: entry) {
                            documentID = entry.entityId ?? ""
                            reason = entry.metadata?["reason"]?.string ?? ""
                        }
                    }
                } else if let logFailure {
                    Text(logFailure).foregroundStyle(Palette.destructive)
                } else {
                    ProgressView()
                }
            } header: {
                Text(String(localized: "admin.docs.log", defaultValue: "Журнал спец-доступа"))
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(AdminScreen.documentAccess.title))
        .refreshable { await loadLog() }
        .task { await loadLog() }
        .remoteFilePreview(opener)
    }

    private func documentSection(_ document: AdminPlatformDocumentDTO) -> some View {
        Section {
            Text(document.title).font(Typography.cardTitle).foregroundStyle(Palette.foreground)
            if let number = document.numberMasked {
                DetailRow(title: String(localized: "admin.docs.number", defaultValue: "Номер"), value: number)
            }
            if let issuedBy = document.issuedBy {
                DetailRow(title: String(localized: "admin.docs.issuedBy", defaultValue: "Кем выдан"), value: issuedBy)
            }
            if let issuedAt = document.issuedAt {
                DetailRow(title: String(localized: "admin.docs.issuedAt", defaultValue: "Дата выдачи"), value: DisplayFormat.date(issuedAt))
            }
            if let expiresAt = document.expiresAt {
                DetailRow(title: String(localized: "admin.docs.expiresAt", defaultValue: "Срок действия"), value: DisplayFormat.date(expiresAt))
            }
            if let comment = document.comment, !comment.isEmpty {
                DetailRow(title: String(localized: "admin.docs.comment", defaultValue: "Комментарий"), value: comment)
            }
            Text(String(localized: "admin.docs.reasonLogged", defaultValue: "Основание: \(grantedReason)"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            let files = (document.files ?? []).sorted { ($0.order ?? 0) < ($1.order ?? 0) }
            if files.isEmpty {
                Text(String(localized: "admin.docs.noFiles", defaultValue: "У документа нет файлов"))
                    .foregroundStyle(Palette.mutedForeground)
            }
            ForEach(Array(files.enumerated()), id: \.element.id) { index, file in
                Button {
                    Task { await openFile(file, index: index, all: files) }
                } label: {
                    Label {
                        HStack {
                            Text(String(localized: "admin.docs.file", defaultValue: "Файл \((index + 1).formatted())"))
                            Spacer()
                            Text(verbatim: DisplayFormat.fileSize(file.size))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    } icon: {
                        Image(systemName: file.mime?.hasPrefix("image/") == true ? "photo" : "doc")
                    }
                }
            }
        } header: {
            Text(String(localized: "admin.docs.document", defaultValue: "Документ"))
        }
    }

    @MainActor
    private func open() async {
        let id = documentID.trimmingCharacters(in: .whitespaces)
        let why = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        isLoading = true
        defer { isLoading = false }
        do {
            document = try await api.platformDocument(id: id, reason: why)
            grantedReason = why
            urls = [:]
            failure = nil
            await loadLog()
        } catch {
            document = nil
            failure = error.userMessage
        }
    }

    /// Ссылки берутся пачкой на все файлы: одно обращение — одна строка в журнале.
    @MainActor
    private func openFile(_ file: AdminPlatformDocumentDTO.File, index: Int, all: [AdminPlatformDocumentDTO.File]) async {
        guard let document else { return }
        let reason = grantedReason
        let ext = Self.fileExtension(file.mime)
        await opener.open(name: "document-\(index + 1)\(ext)") {
            if let cached = urls[file.id], let url = URL(string: cached) { return url }
            let fresh = try await api.platformDocumentURLs(id: document.id, fileIDs: all.map(\.id), reason: reason)
            await MainActor.run { urls = fresh }
            guard let raw = fresh[file.id], let url = URL(string: raw) else {
                throw APIError.malformedResponse(statusCode: 200)
            }
            return url
        }
    }

    private static func fileExtension(_ mime: String?) -> String {
        switch mime {
        case "application/pdf": return ".pdf"
        case "image/jpeg": return ".jpg"
        case "image/png": return ".png"
        case "image/heic": return ".heic"
        case "image/webp": return ".webp"
        default: return ""
        }
    }

    @MainActor
    private func loadLog() async {
        do {
            async let views = api.audit(action: "DOCUMENT_PLATFORM_VIEW", request: PageRequest(cursor: nil, page: 1, limit: 20))
            async let downloads = api.audit(action: "DOCUMENT_PLATFORM_DOWNLOAD", request: PageRequest(cursor: nil, page: 1, limit: 20))
            let merged = try await views.items + downloads.items
            log = merged.sorted { $0.createdAt > $1.createdAt }
            logFailure = nil
        } catch is CancellationError {
            return
        } catch {
            logFailure = error.userMessage
        }
    }
}

private struct AdminDocumentLogRow: View {
    let entry: AdminAuditEntryDTO
    let repeatRequest: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.sm) {
                    StatusBadge(
                        text: entry.action == "DOCUMENT_PLATFORM_DOWNLOAD"
                            ? String(localized: "admin.docs.actionFile", defaultValue: "Файл")
                            : String(localized: "admin.docs.actionCard", defaultValue: "Карточка"),
                        tint: entry.action == "DOCUMENT_PLATFORM_DOWNLOAD" ? Palette.warning : Palette.info
                    )
                    Text(DisplayFormat.dateTime(entry.createdAt))
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                }
                Text(verbatim: entry.entityId ?? "—")
                    .font(Typography.meta.monospaced())
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let reason = entry.metadata?["reason"]?.string {
                    Text(reason)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: Spacing.sm)
            Button(String(localized: "admin.docs.repeat", defaultValue: "Повторить"), action: repeatRequest)
                .buttonStyle(.borderless)
                .font(Typography.meta)
        }
    }
}
