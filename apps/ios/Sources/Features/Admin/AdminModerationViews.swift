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
        let name = post.speaker?.name ?? post.author?.name ?? "—"
        TelegramStyleRow(
            title: name,
            subtitle: text,
            meta: DisplayFormat.relative(post.publishedAt ?? post.createdAt)
        ) {
            AvatarView(url: post.author?.avatarUrl, name: post.author?.name, size: 44)
        } accessory: {
            HStack(spacing: Spacing.sm) {
                if let media = post.media, !media.isEmpty {
                    Image(systemName: "photo")
                        .accessibilityLabel(Text(String(localized: "admin.posts.media", defaultValue: "Вложений: \(media.count.formatted())")))
                }
                if post.commentsCount > 0 {
                    Label(post.commentsCount.formatted(), systemImage: "bubble.right")
                        .labelStyle(.titleAndIcon)
                }
                if post.pinnedAt != nil {
                    Image(systemName: "pin.fill")
                        .foregroundStyle(Palette.primary)
                        .accessibilityLabel(Text(String(localized: "admin.posts.pinned", defaultValue: "Закреплено")))
                }
            }
            .font(.caption)
            .foregroundStyle(Palette.mutedForeground)
        }
    }

    private var text: String {
        let parts = [post.title, post.content]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if parts.isEmpty, let media = post.media, !media.isEmpty {
            return String(localized: "admin.posts.media", defaultValue: "Вложений: \(media.count.formatted())")
        }
        return parts.joined(separator: " — ")
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
                HeroHeader(
                    visual: .symbol("lock.doc.fill", tint: TileTint.purple),
                    title: AdminScreen.documentAccess.title,
                    subtitle: String(localized: "admin.docs.warning", defaultValue: "Каждое открытие файла фиксируется в аудите и в журнале документа вместе с причиной.")
                )
            }

            Section {
                TextField(String(localized: "admin.docs.id", defaultValue: "ID документа"), text: $documentID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                TextField(String(localized: "admin.docs.reason", defaultValue: "Причина доступа"), text: $reason, axis: .vertical)
                    .lineLimit(2...4)
            } footer: {
                if let failure {
                    Text(failure).foregroundStyle(Palette.destructive)
                } else {
                    Text(String(localized: "admin.docs.reasonHint", defaultValue: "Например: проверка жалобы №12. Не короче 5 символов."))
                }
            }

            Section {
                Button {
                    Task { await open() }
                } label: {
                    HStack(spacing: Spacing.sm) {
                        Spacer()
                        if isLoading { ProgressView() }
                        Text(String(localized: "admin.docs.open", defaultValue: "Открыть документ"))
                            .fontWeight(.semibold)
                        Spacer()
                    }
                }
                .disabled(!canSubmit || isLoading)
            }

            if let document {
                documentSection(document)
            }

            Section {
                if let log {
                    if log.isEmpty {
                        Label(String(localized: "admin.docs.logEmpty", defaultValue: "Обращений к чужим документам ещё не было"), systemImage: "checkmark.shield")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(log) { entry in
                        AdminDocumentLogRow(entry: entry) {
                            documentID = entry.entityId ?? ""
                            reason = entry.metadata?["reason"]?.string ?? ""
                        }
                    }
                } else if let logFailure {
                    DashboardFailurePlaceholder(message: logFailure) { await loadLog() }
                } else {
                    ProgressView()
                }
            } header: {
                Text(String(localized: "admin.docs.log", defaultValue: "Журнал спец-доступа"))
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .navigationTitle(Text(AdminScreen.documentAccess.title))
        .refreshable { await loadLog() }
        .task { await loadLog() }
        .remoteFilePreview(opener)
    }

    @ViewBuilder
    private func documentSection(_ document: AdminPlatformDocumentDTO) -> some View {
        Section {
            IconRow(title: document.title, symbol: "doc.text.fill", tint: TileTint.purple, subtitle: String(localized: "admin.docs.reasonLogged", defaultValue: "Основание: \(grantedReason)"))
            if let number = document.numberMasked {
                DetailRow(title: String(localized: "admin.docs.number", defaultValue: "Номер"), value: number, symbol: "number")
            }
            if let issuedBy = document.issuedBy {
                DetailRow(title: String(localized: "admin.docs.issuedBy", defaultValue: "Кем выдан"), value: issuedBy, symbol: "building.2")
            }
            if let issuedAt = document.issuedAt {
                DetailRow(title: String(localized: "admin.docs.issuedAt", defaultValue: "Дата выдачи"), value: DisplayFormat.date(issuedAt), symbol: "calendar")
            }
            if let expiresAt = document.expiresAt {
                DetailRow(title: String(localized: "admin.docs.expiresAt", defaultValue: "Срок действия"), value: DisplayFormat.date(expiresAt), symbol: "calendar.badge.clock")
            }
            if let comment = document.comment, !comment.isEmpty {
                DetailRow(title: String(localized: "admin.docs.comment", defaultValue: "Комментарий"), value: comment, symbol: "text.alignleft")
            }
        } header: {
            Text(String(localized: "admin.docs.document", defaultValue: "Документ"))
        }

        Section {
            let files = (document.files ?? []).sorted { ($0.order ?? 0) < ($1.order ?? 0) }
            if files.isEmpty {
                Text(String(localized: "admin.docs.noFiles", defaultValue: "У документа нет файлов"))
                    .foregroundStyle(Palette.mutedForeground)
            }
            ForEach(Array(files.enumerated()), id: \.element.id) { index, file in
                Button {
                    Task { await openFile(file, index: index, all: files) }
                } label: {
                    IconRow(
                        title: String(localized: "admin.docs.file", defaultValue: "Файл \((index + 1).formatted())"),
                        symbol: file.mime?.hasPrefix("image/") == true ? "photo.fill" : "doc.fill",
                        tint: file.mime?.hasPrefix("image/") == true ? TileTint.teal : TileTint.blue,
                        value: DisplayFormat.fileSize(file.size)
                    )
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text(String(localized: "admin.docs.files", defaultValue: "Файлы"))
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
        let isFile = entry.action == "DOCUMENT_PLATFORM_DOWNLOAD"
        Button(action: repeatRequest) {
            TelegramStyleRow(
                title: entry.entityId ?? "—",
                subtitle: entry.metadata?["reason"]?.string,
                meta: DisplayFormat.dateTime(entry.createdAt)
            ) {
                RowSymbol(symbol: isFile ? "arrow.down.doc.fill" : "eye.fill", tint: isFile ? TileTint.orange : TileTint.blue, size: 40)
            } accessory: {
                StatusBadge(
                    text: isFile
                        ? String(localized: "admin.docs.actionFile", defaultValue: "Файл")
                        : String(localized: "admin.docs.actionCard", defaultValue: "Карточка"),
                    tint: isFile ? Palette.warning : Palette.info
                )
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text(String(localized: "admin.docs.repeatHint", defaultValue: "Подставить документ и причину в форму")))
        .swipeActions(edge: .leading) {
            Button(action: repeatRequest) {
                Label(String(localized: "admin.docs.repeat", defaultValue: "Повторить"), systemImage: "arrow.clockwise")
            }
            .tint(Palette.primary)
        }
    }
}
