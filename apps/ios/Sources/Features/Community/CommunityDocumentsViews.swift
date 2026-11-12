import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// Документы (`/documents`): свои действующие и архив, открытые мне, запросы; загрузка
// нового документа, файлы, доступ (кому открыт), правка, архив, удаление.

struct CommunityDocumentsScreen: View {
    @Environment(\.viewerRole) private var role
    @State private var section: Shelf = .mine
    @State private var search = ""
    @State private var mine = PagedLoader<CommunityDocumentDTO>(limit: 30) { request in
        try await CommunityAPI().documents(view: "active", page: request, search: nil, category: nil)
    }
    @State private var archive = PagedLoader<CommunityDocumentDTO>(limit: 30) { request in
        try await CommunityAPI().documents(view: "archived", page: request, search: nil, category: nil)
    }
    @State private var shared = PagedLoader<CommunitySharedDocumentDTO>(limit: 30) { request in
        try await CommunityAPI().sharedWithMe(page: request)
    }
    @State private var uploading = false
    @State private var opener = RemoteFileOpener()

    enum Shelf: Hashable {
        case mine, archive, shared
    }

    var body: some View {
        Group {
            switch section {
            case .mine: ownList(mine)
            case .archive: ownList(archive)
            case .shared: sharedList
            }
        }
        .navigationTitle(Text(String(localized: "more.documents", defaultValue: "Документы")))
        .debouncedSearch($search, prompt: String(localized: "community.documents.search", defaultValue: "Название документа")) { needle in
            await mine.replace { request in
                try await CommunityAPI().documents(view: "active", page: request, search: needle.isEmpty ? nil : needle, category: nil)
            }
        }
        .floatingAction(String(localized: "community.documents.upload", defaultValue: "Загрузить документ"), symbol: "doc.badge.plus") {
            uploading = true
        }
        .sheet(isPresented: $uploading) {
            CommunityDocumentUploadView(presetType: nil) { _ in Task { await mine.reload() } }
        }
        .remoteFilePreview(opener)
    }

    private var picker: some View {
        FilterChipsRow(
            options: [
                (value: Shelf.mine, title: String(localized: "community.documents.mine", defaultValue: "Мои")),
                (value: Shelf.archive, title: String(localized: "community.documents.archive", defaultValue: "Архив")),
                (value: Shelf.shared, title: String(localized: "community.documents.shared", defaultValue: "Мне открыли")),
            ],
            selection: Binding(get: { section }, set: { if let next = $0 { section = next } })
        )
    }

    private func ownList(_ loader: PagedLoader<CommunityDocumentDTO>) -> some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "documents.empty", defaultValue: "Документов пока нет"),
                symbol: "doc",
                hint: String(localized: "community.documents.empty.hint", defaultValue: "Загрузите удостоверение, аттестат или справку — их можно будет приложить к заявке")
            )
        ) {
            picker
            if role == .student || role == .starosta, section == .mine {
                Section {
                    NavigationLink(value: AppRoute.community(.documentRequests)) {
                        IconRow(title: CommunityScreen.documentRequests.title, symbol: "tray.and.arrow.up.fill", tint: TileTint.orange)
                    }
                }
            }
        } row: { document in
            NavigationLink {
                CommunityDocumentDetailView(documentID: document.id, initial: document) {
                    Task {
                        await mine.reload()
                        await archive.reload()
                    }
                }
            } label: {
                CommunityDocumentRow(document: document)
            }
        }
        .id(section)
    }

    private var sharedList: some View {
        PagedList(
            loader: shared,
            empty: EmptyStateView(
                title: String(localized: "community.documents.sharedEmpty", defaultValue: "Вам пока ничего не открыли"),
                symbol: "person.2.badge.key"
            )
        ) {
            picker
        } row: { item in
            VStack(alignment: .leading, spacing: Spacing.sm) {
                CommunityDocumentRow(document: item.document)
                let from = [item.owner?.name, item.reason].compactMap { $0 }.joined(separator: " · ")
                if !from.isEmpty {
                    Label(from, systemImage: "person.crop.circle")
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                ForEach(item.document.files ?? []) { file in
                    Button {
                        Task {
                            await opener.open(name: "\(item.document.title).\(CommunityDocumentText.ext(file.mime))") {
                                try await CommunityAPI().documentFileURL(documentID: item.document.id, fileID: file.id)
                            }
                        }
                    } label: {
                        Label(CommunityDocumentText.fileTitle(file), systemImage: "doc.text")
                            .font(Typography.meta)
                    }
                    .buttonStyle(.borderless)
                }
            }
        }
    }
}

/// Строка документа как строка чата: значок, название, срок справа, тип и номер ниже,
/// плашка статуса.
struct CommunityDocumentRow: View {
    let document: CommunityDocumentDTO

    var body: some View {
        TelegramStyleRow(
            title: document.title,
            subtitle: subtitle,
            meta: document.expiresAt.map { DisplayFormat.date($0) },
            metaTint: CommunityDocumentText.isExpiring(document) ? Palette.warning : Palette.mutedForeground
        ) {
            RowSymbol(symbol: CommunityDocumentText.symbol(document), tint: CommunityDocumentText.tint(document))
        } accessory: {
            if let status = CommunityText.documentStatus(document.status) {
                StatusBadge(text: status.text, tint: status.tint)
            }
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        parts.append(CommunityText.documentType(document.type))
        if let category = document.category.map(CommunityText.documentCategory) { parts.append(category) }
        if let number = document.numberMasked { parts.append("№ \(number)") }
        parts.append(CommunityDocumentText.summary(document))
        return parts.joined(separator: " · ")
    }
}

enum CommunityDocumentText {
    static func symbol(_ document: CommunityDocumentDTO) -> String {
        if document.issuedByUniversity == true { return "building.columns.fill" }
        if document.archivedAt != nil || document.status == "ARCHIVED" { return "archivebox.fill" }
        return "doc.text.fill"
    }

    static func tint(_ document: CommunityDocumentDTO) -> Color {
        if document.archivedAt != nil || document.status == "ARCHIVED" { return TileTint.gray }
        if document.issuedByUniversity == true { return TileTint.indigo }
        return TileTint.blue
    }

    /// Срок действия кончается в ближайший месяц — дату справа подсвечиваем.
    static func isExpiring(_ document: CommunityDocumentDTO) -> Bool {
        guard let expires = document.expiresAt else { return false }
        return expires.timeIntervalSinceNow < 30 * 24 * 3600
    }

    static func ext(_ mime: String?) -> String {
        switch mime {
        case "application/pdf": return "pdf"
        case "image/png": return "png"
        default: return "jpg"
        }
    }

    static func fileTitle(_ file: CommunityDocumentDTO.File) -> String {
        let kind = file.mime == "application/pdf" ? "PDF" : String(localized: "community.documents.image", defaultValue: "Изображение")
        let size = DisplayFormat.fileSize(file.size)
        return size.isEmpty ? kind : "\(kind), \(size)"
    }

    static func summary(_ document: CommunityDocumentDTO) -> String {
        let files = (document.fileCount ?? document.files?.count ?? 0).formatted()
        var parts = [String(localized: "community.documents.files", defaultValue: "Файлов: \(files)")]
        if let access = document.accessCount, access > 0 {
            parts.append(String(localized: "community.documents.accessCount", defaultValue: "Доступов: \(access.formatted())"))
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Карточка документа

struct CommunityDocumentDetailView: View {
    let documentID: String
    let initial: CommunityDocumentDTO
    let changed: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(ViewerProfileModel.self) private var viewer
    @State private var document: CommunityDocumentDTO?
    @State private var access: [CommunityDocumentAccessDTO]?
    /// Список доступов не загрузился — не «никому не открыт».
    @State private var accessFailure: String?
    @State private var opener = RemoteFileOpener()
    @State private var editing = false
    @State private var granting = false
    @State private var confirmingDelete = false
    @State private var revoking: CommunityDocumentAccessDTO?
    @State private var removingFile: CommunityDocumentDTO.File?
    @State private var importing = false
    @State private var photoPick: PhotosPickerItem?
    @State private var pickingPhoto = false
    @State private var isUploading = false
    @State private var actionFailure: String?

    private let api = CommunityAPI()
    private var current: CommunityDocumentDTO { document ?? initial }
    private var isArchived: Bool { current.archivedAt != nil || current.status == "ARCHIVED" }
    private var isIssued: Bool { current.issuedByUniversity == true }

    /// Под шапкой — то, ради чего открывают документ: файл, доступ, правка, архив.
    private var heroActions: [HeroAction] {
        var actions: [HeroAction] = []
        if let file = current.files?.first {
            actions.append(HeroAction(
                title: String(localized: "community.documents.open", defaultValue: "Открыть"),
                symbol: "doc.viewfinder"
            ) {
                Task {
                    await opener.open(name: "\(current.title).\(CommunityDocumentText.ext(file.mime))") {
                        try await api.documentFileURL(documentID: documentID, fileID: file.id)
                    }
                }
            })
        }
        if !isIssued {
            actions.append(HeroAction(
                title: String(localized: "community.documents.grantShort", defaultValue: "Доступ"),
                symbol: "person.badge.key.fill"
            ) { granting = true })
            actions.append(HeroAction(
                title: String(localized: "feed.edit", defaultValue: "Редактировать"),
                symbol: "pencil"
            ) { editing = true })
        }
        actions.append(HeroAction(
            title: isArchived
                ? String(localized: "community.documents.unarchive", defaultValue: "Вернуть из архива")
                : String(localized: "community.documents.toArchive", defaultValue: "В архив"),
            symbol: isArchived ? "arrow.uturn.backward" : "archivebox"
        ) { Task { await toggleArchive() } })
        return actions
    }

    var body: some View {
        List {
            HeroHeader(
                visual: .symbol(CommunityDocumentText.symbol(current), tint: CommunityDocumentText.tint(current)),
                title: current.title,
                subtitle: [CommunityText.documentType(current.type), current.category.map(CommunityText.documentCategory)]
                    .compactMap { $0 }.joined(separator: " · "),
                actions: heroActions
            ) {
                if let status = CommunityText.documentStatus(current.status) {
                    StatusBadge(text: status.text, tint: status.tint)
                }
            }

            Section {
                if let number = current.numberMasked {
                    DetailRow(title: String(localized: "community.documents.numberTitle", defaultValue: "Номер"), value: number, symbol: "number")
                }
                if let expires = current.expiresAt {
                    DetailRow(title: String(localized: "community.documents.validUntil", defaultValue: "Действует до"), value: DisplayFormat.date(expires), symbol: "calendar")
                }
                if let issuedBy = current.issuedBy, !issuedBy.isEmpty {
                    DetailRow(title: String(localized: "community.documents.issuedBy", defaultValue: "Кем выдан"), value: issuedBy, symbol: "building.2")
                }
                if let issuedAt = current.issuedAt {
                    DetailRow(title: String(localized: "community.documents.issuedAt", defaultValue: "Дата выдачи"), value: DisplayFormat.date(issuedAt), symbol: "calendar.badge.checkmark")
                }
                if let comment = current.comment, !comment.isEmpty {
                    DetailRow(title: String(localized: "community.documents.comment", defaultValue: "Комментарий"), value: comment, symbol: "text.bubble")
                }
                if let reason = current.rejectionReason, !reason.isEmpty {
                    DetailRow(title: String(localized: "community.documents.rejection", defaultValue: "Причина отказа"), value: reason, symbol: "exclamationmark.triangle")
                }
            }

            Section {
                ForEach(current.files ?? []) { file in
                    Button {
                        Task {
                            await opener.open(name: "\(current.title).\(CommunityDocumentText.ext(file.mime))") {
                                try await api.documentFileURL(documentID: documentID, fileID: file.id)
                            }
                        }
                    } label: {
                        Label(CommunityDocumentText.fileTitle(file), systemImage: "doc.text")
                    }
                    .swipeActions {
                        if !isIssued, (current.files?.count ?? 0) > 1 {
                            Button(role: .destructive) {
                                removingFile = file
                            } label: {
                                Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                            }
                        }
                    }
                }
                if !isIssued {
                    Menu {
                        Button {
                            importing = true
                        } label: {
                            Label(String(localized: "community.documents.fromFiles", defaultValue: "Из «Файлов»"), systemImage: "folder")
                        }
                        // Окно «Фото» открывает экран, а не пункт меню: меню закрывается
                        // вместе с пунктом, и окно, открытое из него, висело на «Загрузке».
                        Button {
                            pickingPhoto = true
                        } label: {
                            Label(String(localized: "community.documents.fromPhotos", defaultValue: "Из галереи"), systemImage: "photo")
                        }
                    } label: {
                        HStack {
                            Label(String(localized: "community.documents.addPage", defaultValue: "Добавить страницу"), systemImage: "plus")
                            if isUploading { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(isUploading)
                }
            } header: {
                Text(String(localized: "community.documents.pages", defaultValue: "Файлы"))
            }

            if !isIssued {
                Section {
                    if let access {
                        let active = access.filter { $0.active != false && $0.revokedAt == nil }
                        if active.isEmpty {
                            DashboardEmptyRow(
                                text: String(localized: "community.documents.access.empty", defaultValue: "Документ никому не открыт"),
                                symbol: "lock"
                            )
                        }
                        ForEach(active) { grant in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(CommunityText.grantee(grant.granteeType)).font(Typography.body)
                                Text([grant.reason, grant.expiresAt.map { String(localized: "community.documents.until", defaultValue: "до \(DisplayFormat.date($0))") }]
                                    .compactMap { $0 }.joined(separator: " · "))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                            .swipeActions {
                                Button(role: .destructive) {
                                    revoking = grant
                                } label: {
                                    Label(String(localized: "community.documents.revoke", defaultValue: "Закрыть доступ"), systemImage: "lock")
                                }
                            }
                        }
                    } else if let accessFailure {
                        DashboardFailurePlaceholder(message: accessFailure) { await reloadAccess() }
                    } else {
                        ProgressView()
                    }
                    Button {
                        granting = true
                    } label: {
                        Label(String(localized: "community.documents.grant", defaultValue: "Открыть доступ"), systemImage: "person.badge.key")
                    }
                } header: {
                    Text(String(localized: "community.documents.access", defaultValue: "Кому открыт"))
                } footer: {
                    Text(String(localized: "community.documents.access.hint", defaultValue: "Смахните влево, чтобы закрыть доступ"))
                }
            }

            if !isIssued {
                Section {
                    Button(role: .destructive) {
                        confirmingDelete = true
                    } label: {
                        Text(String(localized: "community.documents.delete", defaultValue: "Удалить документ"))
                            .foregroundStyle(Palette.destructive)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .navigationTitle(Text(current.title))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await reloadAccess() }
        .task { await reloadAccess() }
        .remoteFilePreview(opener)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .jpeg, .png], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            Task {
                let files = urls.compactMap { try? CommunityPickedFile.read($0) }
                await addFiles(files)
            }
        }
        .photosPicker(isPresented: $pickingPhoto, selection: $photoPick, matching: .images)
        .task(id: photoPick) {
            guard let photoPick else { return }
            if let prepared = try? await MediaPreparation.prepare(photoPick) {
                await addFiles([CommunityPickedFile(data: prepared.data, mime: prepared.mime, filename: prepared.filename)])
            }
            self.photoPick = nil
        }
        .sheet(isPresented: $editing) {
            CommunityDocumentEditSheet(document: current) { updated in
                document = updated
                changed()
            }
        }
        .sheet(isPresented: $granting) {
            CommunityGrantAccessSheet(documentID: documentID, facultyID: viewer.profile?.facultyId) {
                await reloadAccess()
                changed()
            }
        }
        .confirmDestructive(
            $revoking,
            title: { CommunityText.grantee($0.granteeType) + ": " + String(localized: "community.documents.revoke.title", defaultValue: "закрыть доступ?") },
            actionTitle: String(localized: "community.documents.revoke", defaultValue: "Закрыть доступ")
        ) { grant in
            do {
                try await api.revokeAccess(documentID: documentID, accessID: grant.id)
                await reloadAccess()
                changed()
            } catch {
                actionFailure = error.userMessage
            }
        }
        .confirmDestructive(
            $removingFile,
            title: { _ in String(localized: "community.documents.removeFile.title", defaultValue: "Удалить страницу документа?") },
            actionTitle: String(localized: "feed.delete", defaultValue: "Удалить")
        ) { file in
            do {
                try await api.deleteDocumentFile(documentID: documentID, fileID: file.id)
                document?.files?.removeAll { $0.id == file.id }
                if document == nil {
                    var copy = initial
                    copy.files?.removeAll { $0.id == file.id }
                    document = copy
                }
                changed()
            } catch {
                actionFailure = error.userMessage
            }
        }
        .alert(
            String(localized: "community.documents.delete.title", defaultValue: "Удалить документ?"),
            isPresented: $confirmingDelete
        ) {
            Button(String(localized: "feed.delete", defaultValue: "Удалить"), role: .destructive) {
                Task {
                    do {
                        try await api.deleteDocument(id: documentID)
                        changed()
                        dismiss()
                    } catch {
                        actionFailure = error.userMessage
                    }
                }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
        .actionFailureAlert($actionFailure)
    }

    @MainActor
    private func reloadAccess() async {
        guard !isIssued else { return }
        do {
            access = try await api.documentAccess(id: documentID)
            accessFailure = nil
        } catch is CancellationError {
            return
        } catch {
            // Прежний список остаётся; сбой виден, только когда показать нечего.
            accessFailure = error.userMessage
        }
    }

    @MainActor
    private func addFiles(_ files: [CommunityPickedFile]) async {
        guard !files.isEmpty else { return }
        isUploading = true
        defer { isUploading = false }
        do {
            var ids: [String] = []
            for file in files {
                ids.append(try await api.uploadDocumentFile(file.data, mime: file.mime, filename: file.filename).id)
            }
            try await api.addDocumentFiles(documentID: documentID, fileIDs: ids)
            changed()
            dismiss()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func toggleArchive() async {
        do {
            try await api.setArchived(documentID: documentID, !isArchived)
            changed()
            dismiss()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

private struct CommunityDocumentEditSheet: View {
    let document: CommunityDocumentDTO
    let saved: (CommunityDocumentDTO) -> Void

    @State private var title = ""
    @State private var number = ""
    @State private var issuedBy = ""
    @State private var hasIssued = false
    @State private var issuedAt = Date()
    @State private var hasExpiry = false
    @State private var expiresAt = Date()
    @State private var comment = ""
    @State private var didFill = false

    var body: some View {
        FormSheet(
            title: String(localized: "feed.edit", defaultValue: "Редактировать"),
            canSave: !title.trimmingCharacters(in: .whitespaces).isEmpty,
            save: {
                func value(_ text: String) -> JSONValue {
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    return trimmed.isEmpty ? .null : .string(trimmed)
                }
                var fields: [String: JSONValue] = [
                    "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
                    "issuedBy": value(issuedBy),
                    "issuedAt": hasIssued ? .string(JSONCoding.isoString(issuedAt)) : .null,
                    "expiresAt": hasExpiry ? .string(JSONCoding.isoString(expiresAt)) : .null,
                    "comment": value(comment),
                ]
                // Номер хранится скрытым: пустое поле значит «не менять», а не «стереть».
                if !number.trimmingCharacters(in: .whitespaces).isEmpty { fields["number"] = value(number) }
                saved(try await CommunityAPI().updateDocument(id: document.id, fields: fields))
            }
        ) {
            Section {
                TextField(String(localized: "community.documents.title", defaultValue: "Название"), text: $title)
                TextField(String(localized: "community.documents.number", defaultValue: "Номер (оставьте пустым, чтобы не менять)"), text: $number)
                TextField(String(localized: "community.documents.issuedBy", defaultValue: "Кем выдан"), text: $issuedBy)
                Toggle(String(localized: "community.documents.issuedAt", defaultValue: "Дата выдачи"), isOn: $hasIssued)
                if hasIssued { DatePicker(String(localized: "community.documents.issuedAt", defaultValue: "Дата выдачи"), selection: $issuedAt, displayedComponents: .date) }
                Toggle(String(localized: "community.documents.expiresAt", defaultValue: "Срок действия"), isOn: $hasExpiry)
                if hasExpiry { DatePicker(String(localized: "community.documents.expiresAt", defaultValue: "Срок действия"), selection: $expiresAt, displayedComponents: .date) }
                TextField(String(localized: "community.documents.comment", defaultValue: "Комментарий"), text: $comment, axis: .vertical)
            }
        }
        .onAppear {
            guard !didFill else { return }
            didFill = true
            title = document.title
            issuedBy = document.issuedBy ?? ""
            comment = document.comment ?? ""
            if let date = document.issuedAt { hasIssued = true; issuedAt = date }
            if let date = document.expiresAt { hasExpiry = true; expiresAt = date }
        }
    }
}

private struct CommunityGrantAccessSheet: View {
    let documentID: String
    let facultyID: String?
    let granted: () async -> Void

    @State private var granteeType = "UNIVERSITY"
    @State private var person: SearchResultsDTO.Person?
    @State private var reason = ""
    @State private var hasExpiry = false
    @State private var expiresAt = Date().addingTimeInterval(30 * 24 * 3600)
    @State private var pickingPerson = false

    var body: some View {
        FormSheet(
            title: String(localized: "community.documents.grant", defaultValue: "Открыть доступ"),
            saveTitle: String(localized: "community.documents.grantAction", defaultValue: "Открыть"),
            canSave: canSave,
            save: {
                let target: String?
                switch granteeType {
                case "USER": target = person?.id
                case "DEPARTMENT": target = facultyID
                default: target = nil
                }
                try await CommunityAPI().grantAccess(
                    documentID: documentID,
                    granteeType: granteeType,
                    granteeID: target,
                    reason: reason.trimmingCharacters(in: .whitespacesAndNewlines),
                    expiresAt: hasExpiry ? expiresAt : nil
                )
            },
            saved: granted
        ) {
            Section {
                Picker(String(localized: "community.documents.grantee", defaultValue: "Кому"), selection: $granteeType) {
                    Text(CommunityText.grantee("UNIVERSITY")).tag("UNIVERSITY")
                    if facultyID != nil { Text(CommunityText.grantee("DEPARTMENT")).tag("DEPARTMENT") }
                    Text(CommunityText.grantee("USER")).tag("USER")
                }
                if granteeType == "USER" {
                    Button {
                        pickingPerson = true
                    } label: {
                        LabeledContent(String(localized: "community.grantee.user", defaultValue: "Человек")) {
                            Text(person?.name ?? String(localized: "community.documents.choosePerson", defaultValue: "Выбрать"))
                        }
                    }
                }
                TextField(String(localized: "community.documents.reason", defaultValue: "Зачем (увидит получатель)"), text: $reason)
                Toggle(String(localized: "community.documents.limitTime", defaultValue: "Ограничить срок"), isOn: $hasExpiry)
                if hasExpiry {
                    DatePicker(String(localized: "community.documents.until.label", defaultValue: "До"), selection: $expiresAt, in: Date()..., displayedComponents: .date)
                }
            }
        }
        .sheet(isPresented: $pickingPerson) {
            CommunityPersonPicker(title: String(localized: "community.grantee.user", defaultValue: "Человек")) { person = $0 }
        }
    }

    private var canSave: Bool {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.count <= 300 && (granteeType != "USER" || person != nil)
    }
}

// MARK: - Загрузка документа

struct CommunityDocumentUploadView: View {
    /// Тип, который просит запрос или заявка, — выбран заранее.
    let presetType: String?
    let created: (CommunityDocumentDTO) -> Void

    @State private var types: [CommunityDocumentTypeDTO] = []
    @State private var typeID = ""
    @State private var title = ""
    @State private var number = ""
    @State private var issuedBy = ""
    @State private var hasIssued = false
    @State private var issuedAt = Date()
    @State private var hasExpiry = false
    @State private var expiresAt = Date()
    @State private var comment = ""
    @State private var files: [CommunityPickedFile] = []
    @State private var importing = false
    @State private var photoPicks: [PhotosPickerItem] = []
    @State private var pickingPhotos = false

    private var selectedType: CommunityDocumentTypeDTO? { types.first { $0.typeId == typeID } }
    private var fields: Set<String> { Set(selectedType?.fields ?? ["number", "issuedAt", "expiresAt", "issuedBy", "comment"]) }

    var body: some View {
        FormSheet(
            title: String(localized: "community.documents.upload", defaultValue: "Загрузить документ"),
            saveTitle: String(localized: "community.documents.uploadAction", defaultValue: "Загрузить"),
            canSave: selectedType != nil && !files.isEmpty && !title.trimmingCharacters(in: .whitespaces).isEmpty,
            save: save
        ) {
            Section {
                Picker(String(localized: "community.documents.type", defaultValue: "Тип"), selection: $typeID) {
                    Text(verbatim: "—").tag("")
                    ForEach(types) { type in
                        Text(CommunityText.documentType(type.typeId, label: type.label)).tag(type.typeId)
                    }
                }
                TextField(String(localized: "community.documents.title", defaultValue: "Название"), text: $title)
                if fields.contains("number") {
                    TextField(String(localized: "community.documents.numberPlain", defaultValue: "Номер"), text: $number)
                }
                if fields.contains("issuedBy") {
                    TextField(String(localized: "community.documents.issuedBy", defaultValue: "Кем выдан"), text: $issuedBy)
                }
                if fields.contains("issuedAt") {
                    Toggle(String(localized: "community.documents.issuedAt", defaultValue: "Дата выдачи"), isOn: $hasIssued)
                    if hasIssued { DatePicker(String(localized: "community.documents.issuedAt", defaultValue: "Дата выдачи"), selection: $issuedAt, displayedComponents: .date) }
                }
                if fields.contains("expiresAt") {
                    Toggle(String(localized: "community.documents.expiresAt", defaultValue: "Срок действия"), isOn: $hasExpiry)
                    if hasExpiry { DatePicker(String(localized: "community.documents.expiresAt", defaultValue: "Срок действия"), selection: $expiresAt, displayedComponents: .date) }
                }
                if fields.contains("comment") {
                    TextField(String(localized: "community.documents.comment", defaultValue: "Комментарий"), text: $comment, axis: .vertical)
                }
            }

            Section {
                ForEach(Array(files.enumerated()), id: \.offset) { index, file in
                    HStack {
                        Label(file.filename, systemImage: file.mime == "application/pdf" ? "doc.richtext" : "photo")
                            .lineLimit(1)
                        Spacer()
                        Text(DisplayFormat.fileSize(file.data.count)).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            files.remove(at: index)
                        } label: {
                            Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                    }
                }
                Button {
                    importing = true
                } label: {
                    Label(String(localized: "community.documents.fromFiles", defaultValue: "Из «Файлов»"), systemImage: "folder")
                }
                // Окно «Фото» открывает сама форма, а не её строка: строка списка
                // перерисовывается, пока окно открыто, и оно зависало на «Загрузке».
                Button {
                    pickingPhotos = true
                } label: {
                    Label(String(localized: "community.documents.fromPhotos", defaultValue: "Из галереи"), systemImage: "photo")
                }
            } header: {
                Text(String(localized: "community.documents.pages", defaultValue: "Файлы"))
            } footer: {
                Text(String(localized: "community.documents.formats", defaultValue: "PDF, JPG или PNG. Каждая страница — отдельный файл."))
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .jpeg, .png], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            files += urls.compactMap { try? CommunityPickedFile.read($0) }
        }
        .photosPicker(isPresented: $pickingPhotos, selection: $photoPicks, maxSelectionCount: 10, matching: .images)
        .onChange(of: photoPicks) { _, picks in
            guard !picks.isEmpty else { return }
            Task {
                for pick in picks {
                    if let prepared = try? await MediaPreparation.prepare(pick), !prepared.isVideo {
                        files.append(CommunityPickedFile(data: prepared.data, mime: prepared.mime, filename: "page-\(files.count + 1).jpg"))
                    }
                }
                photoPicks = []
            }
        }
        .onChange(of: typeID) { _, next in
            if title.isEmpty || types.contains(where: { CommunityText.documentType($0.typeId, label: $0.label) == title }) {
                title = next.isEmpty ? "" : CommunityText.documentType(next, label: selectedType?.label)
            }
        }
        .task {
            types = ((try? await CommunityAPI().documentTypes()) ?? []).filter { $0.enabled != false }
            if let presetType, types.contains(where: { $0.typeId == presetType }) { typeID = presetType }
        }
    }

    @MainActor
    private func save() async throws {
        guard let type = selectedType else { return }
        let api = CommunityAPI()
        var ids: [String] = []
        for file in files {
            ids.append(try await api.uploadDocumentFile(file.data, mime: file.mime, filename: file.filename).id)
        }
        func optional(_ text: String) -> String? {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        let document = try await api.createDocument(CommunityDocumentInput(
            category: type.category,
            type: type.typeId,
            title: String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)),
            number: fields.contains("number") ? optional(number) : nil,
            issuedBy: fields.contains("issuedBy") ? optional(issuedBy) : nil,
            issuedAt: fields.contains("issuedAt") && hasIssued ? issuedAt : nil,
            expiresAt: fields.contains("expiresAt") && hasExpiry ? expiresAt : nil,
            comment: fields.contains("comment") ? optional(comment) : nil
        ))
        try await api.addDocumentFiles(documentID: document.id, fileIDs: ids)
        created(document)
    }
}
