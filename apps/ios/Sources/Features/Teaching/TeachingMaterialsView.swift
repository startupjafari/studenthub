import SwiftUI
import UniformTypeIdentifiers

/// Учебные материалы: свои и все доступные, добавление с файлами, открытие файлов,
/// прикрепление новых, удаление. Правки самого материала API не даёт — у веба её тоже нет.
struct TeachingMaterialsView: View {
    @Environment(\.viewerID) private var viewerID

    /// `nil` — мои, `all` — все.
    @State private var tab: String?
    @State private var loader = PagedLoader<TeachingMaterialDTO>(limit: 30) { request in
        try await TeachingAPI().materials(request, mine: true)
    }
    @State private var creating = false
    @State private var deleting: TeachingMaterialDTO?
    @State private var actionFailure: String?

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "teaching.materials.empty", defaultValue: "Материалов нет"),
                symbol: "folder",
                actionTitle: String(localized: "teaching.materials.add", defaultValue: "Добавить материал"),
                action: { creating = true }
            )
        ) {
            FilterChipsRow(
                options: [
                    (nil, String(localized: "teaching.materials.mine", defaultValue: "Мои")),
                    ("all", String(localized: "teaching.filter.all", defaultValue: "Все")),
                ],
                selection: $tab
            )
        } row: { material in
            NavigationLink {
                TeachingMaterialDetailView(materialID: material.id, loader: loader, canManage: canManage(material))
            } label: {
                TeachingMaterialRow(material: material)
            }
            .swipeActions {
                if canManage(material) {
                    Button(role: .destructive) {
                        deleting = material
                    } label: {
                        Label(String(localized: "teaching.delete", defaultValue: "Удалить"), systemImage: "trash")
                    }
                }
            }
        }
        .navigationTitle(Text(TeacherScreen.materials.title))
        .floatingAction(String(localized: "teaching.materials.add", defaultValue: "Добавить материал")) {
            creating = true
        }
        .sheet(isPresented: $creating) {
            TeachingMaterialForm { await loader.reload() }
        }
        .confirmDestructive(
            $deleting,
            title: { material in String(localized: "teaching.materials.delete.confirm", defaultValue: "Удалить материал «\(material.title)»?") },
            actionTitle: String(localized: "teaching.delete", defaultValue: "Удалить")
        ) { material in
            do {
                try await TeachingAPI().deleteMaterial(id: material.id)
                loader.remove(id: material.id)
            } catch {
                actionFailure = error.userMessage
            }
        }
        .actionFailureAlert($actionFailure)
        .onChange(of: tab) {
            let mine = tab == nil
            Task { await loader.replace { request in try await TeachingAPI().materials(request, mine: mine) } }
        }
    }

    private func canManage(_ material: TeachingMaterialDTO) -> Bool {
        material.teacher?.id == viewerID
    }
}

/// Материал строкой как чат: папка цвета дисциплины, название, дата справа, ниже —
/// дисциплина и автор; число файлов — счётчиком.
private struct TeachingMaterialRow: View {
    let material: TeachingMaterialDTO

    var body: some View {
        let subject = material.subject ?? String(localized: "teaching.materials.noSubject", defaultValue: "Без дисциплины")
        let files = material.media?.count ?? 0
        TelegramStyleRow(
            title: material.title,
            subtitle: StudyText.join([subject, material.teacher?.name], separator: "\n"),
            meta: material.createdAt.map { DisplayFormat.date($0) }
        ) {
            RowSymbol(symbol: "folder.fill", tint: ScheduleSubjectTint.color(for: subject))
        } accessory: {
            if files > 0 {
                Label(files.formatted(), systemImage: "paperclip")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Palette.mutedForeground)
                    .accessibilityLabel(Text(String(localized: "teaching.materials.filesCount", defaultValue: "Файлов: \(files.formatted())")))
            }
        }
    }
}

/// Материал: описание, ссылка, файлы. Автор прикрепляет файлы и удаляет материал.
private struct TeachingMaterialDetailView: View {
    let materialID: String
    let loader: PagedLoader<TeachingMaterialDTO>
    let canManage: Bool

    @State private var opener = RemoteFileOpener()
    @State private var importing = false
    @State private var isUploading = false
    @State private var deleting: TeachingMaterialDTO?
    @State private var actionFailure: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private var material: TeachingMaterialDTO? { loader.items.first { $0.id == materialID } }

    /// Ссылка, прикрепить файл и удалить — круглыми кнопками шапки.
    private func heroActions(_ material: TeachingMaterialDTO) -> [HeroAction] {
        var actions: [HeroAction] = []
        if let link = material.url, let url = URL(string: link) {
            actions.append(HeroAction(title: String(localized: "teaching.materials.link", defaultValue: "Ссылка"), symbol: "link") {
                openURL(url)
            })
        }
        if canManage {
            actions.append(HeroAction(title: String(localized: "teaching.materials.attachShort", defaultValue: "Файл"), symbol: "paperclip") {
                importing = true
            })
            actions.append(HeroAction(title: String(localized: "teaching.delete", defaultValue: "Удалить"), symbol: "trash", role: .destructive) {
                deleting = material
            })
        }
        return actions
    }

    var body: some View {
        List {
            if let material {
                Section {
                    HeroHeader(
                        visual: HeroVisual.symbol("folder.fill", tint: ScheduleSubjectTint.color(for: material.subject ?? material.title)),
                        title: material.title,
                        subtitle: material.subject ?? String(localized: "teaching.materials.noSubject", defaultValue: "Без дисциплины"),
                        actions: heroActions(material)
                    )
                }
                Section {
                    if let teacher = material.teacher {
                        NavigationLink(value: AppRoute.profile(id: teacher.id)) {
                            PersonRow(name: teacher.name, subtitle: DisplayFormat.date(material.createdAt), avatarURL: teacher.avatarUrl)
                        }
                    }
                    if let description = material.description, !description.isEmpty {
                        Text(description).textSelection(.enabled)
                    }
                }

                Section {
                    let files = material.media ?? []
                    if files.isEmpty {
                        Text(String(localized: "teaching.materials.noFiles", defaultValue: "Файлов нет"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(files) { file in
                        Button {
                            Task {
                                await opener.open(name: file.name ?? "file") {
                                    try await TeachingAPI().materialFileURL(materialID: material.id, fileID: file.id)
                                }
                            }
                        } label: {
                            IconRow(
                                title: file.name ?? String(localized: "teaching.materials.file", defaultValue: "Файл"),
                                symbol: "doc.fill",
                                tint: TileTint.indigo,
                                value: DisplayFormat.fileSize(file.size)
                            )
                        }
                    }
                    if canManage {
                        Button {
                            importing = true
                        } label: {
                            if isUploading {
                                HStack {
                                    ProgressView()
                                    Text(String(localized: "teaching.materials.uploading", defaultValue: "Загрузка…"))
                                }
                            } else {
                                Label(String(localized: "teaching.materials.attach", defaultValue: "Прикрепить файл"), systemImage: "paperclip")
                            }
                        }
                        .disabled(isUploading)
                    }
                } header: {
                    Text(String(localized: "teaching.materials.files", defaultValue: "Файлы"))
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(material == nil) {
            EmptyStateView(title: String(localized: "teaching.materials.gone", defaultValue: "Материал удалён"), symbol: "folder")
        }
        .navigationTitle(Text(material?.title ?? TeacherScreen.materials.title))
        .navigationBarTitleDisplayMode(.inline)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item]) { result in
            Task { await upload(result) }
        }
        .confirmDestructive(
            $deleting,
            title: { material in String(localized: "teaching.materials.delete.confirm", defaultValue: "Удалить материал «\(material.title)»?") },
            actionTitle: String(localized: "teaching.delete", defaultValue: "Удалить")
        ) { material in
            do {
                try await TeachingAPI().deleteMaterial(id: material.id)
                loader.remove(id: material.id)
                dismiss()
            } catch {
                actionFailure = error.userMessage
            }
        }
        .remoteFilePreview(opener)
        .actionFailureAlert($actionFailure)
        .pullToRefresh { await loader.reload() }
    }

    @MainActor
    private func upload(_ result: Result<URL, Error>) async {
        isUploading = true
        defer { isUploading = false }
        do {
            let file = try TeachingPickedFile.read(try result.get())
            try await TeachingAPI().uploadMaterialFile(materialID: materialID, data: file.data, filename: file.name, mime: file.mime)
            await loader.reload()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

/// Новый материал для группы: дисциплина — из своих дисциплин в этой группе.
/// Файлы можно выбрать сразу: они загрузятся после создания.
private struct TeachingMaterialForm: View {
    let saved: () async -> Void

    @State private var courses: [CourseDTO] = []
    @State private var coursesFailure: String?
    @State private var coursesOffline = false
    @State private var groupID = ""
    @State private var subject = ""
    @State private var title = ""
    @State private var description = ""
    @State private var link = ""
    @State private var files: [TeachingPickedFile] = []
    @State private var importing = false
    @State private var importFailure: String?
    /// Материал уже создан, а файл не загрузился: повтор догружает файлы, а не
    /// создаёт второй материал.
    @State private var createdID: String?

    var body: some View {
        FormSheet(
            title: String(localized: "teaching.materials.add", defaultValue: "Добавить материал"),
            canSave: isValid,
            save: save,
            saved: saved
        ) {
            if let coursesFailure {
                // Дисциплины не пришли — пустой выбор без объяснения выглядел бы как «у вас их нет».
                Section {
                    StaleDataBanner(message: coursesFailure, isOffline: coursesOffline) { await loadCourses() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
            }
            Section {
                Picker(String(localized: "teaching.materials.group", defaultValue: "Группа"), selection: $groupID) {
                    Text(String(localized: "teaching.materials.group.pick", defaultValue: "Выберите группу")).tag("")
                    ForEach(groups, id: \.id) { group in Text(group.name).tag(group.id) }
                }
                .onChange(of: groupID) { subject = subjects.first ?? "" }
                if !groupID.isEmpty {
                    Picker(String(localized: "teaching.materials.subject", defaultValue: "Предмет"), selection: $subject) {
                        Text(String(localized: "teaching.materials.noSubject", defaultValue: "Без дисциплины")).tag("")
                        ForEach(subjects, id: \.self) { Text($0).tag($0) }
                    }
                }
            } footer: {
                if !groupID.isEmpty, subjects.isEmpty {
                    Text(String(localized: "teaching.materials.noSubjectsHint", defaultValue: "У группы нет ваших дисциплин. Выложить материал можно, только если у вас есть пары в этой группе, — тогда студенты найдут его в «Прочих материалах»."))
                }
            }

            Section {
                TextField(String(localized: "teaching.materials.title", defaultValue: "Название"), text: $title)
                TextField(String(localized: "teaching.materials.description", defaultValue: "Описание"), text: $description, axis: .vertical)
                    .lineLimit(2...6)
                TextField(String(localized: "teaching.materials.url", defaultValue: "Ссылка (необязательно)"), text: $link)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            Section {
                ForEach(Array(files.enumerated()), id: \.offset) { index, file in
                    HStack {
                        IconRow(title: file.name, symbol: "doc", tint: TileTint.indigo, value: DisplayFormat.fileSize(file.data.count))
                        Button {
                            files.remove(at: index)
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "teaching.materials.removeFile", defaultValue: "Убрать файл")))
                    }
                }
                Button {
                    importing = true
                } label: {
                    Label(String(localized: "teaching.materials.attach", defaultValue: "Прикрепить файл"), systemImage: "paperclip")
                }
            } header: {
                Text(String(localized: "teaching.materials.files", defaultValue: "Файлы"))
            } footer: {
                if let importFailure { Text(importFailure).foregroundStyle(Palette.destructive) }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            do {
                for url in try result.get() { files.append(try TeachingPickedFile.read(url)) }
                importFailure = nil
            } catch {
                importFailure = error.userMessage
            }
        }
        .task {
            guard courses.isEmpty else { return }
            await loadCourses()
        }
    }

    @MainActor
    private func loadCourses() async {
        do {
            courses = try await CoursesAPI().courses(mine: true)
            coursesFailure = nil
            if groups.count == 1 { groupID = groups[0].id }
        } catch is CancellationError {
            return
        } catch {
            coursesFailure = error.userMessage
            coursesOffline = error.isOffline
        }
    }

    private var groups: [CourseDTO.Group] {
        var seen = Set<String>()
        return courses.compactMap(\.group)
            .filter { seen.insert($0.id).inserted }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    private var subjects: [String] {
        Array(Set(courses.filter { $0.group?.id == groupID }.map(\.subject.name))).sorted()
    }

    private var isValid: Bool {
        let name = title.trimmingCharacters(in: .whitespaces)
        guard !groupID.isEmpty, !name.isEmpty, name.count <= 200, description.count <= 2000 else { return false }
        let url = link.trimmingCharacters(in: .whitespaces)
        if !url.isEmpty {
            guard let parsed = URL(string: url), ["http", "https"].contains(parsed.scheme?.lowercased() ?? "") else { return false }
        }
        return true
    }

    @MainActor
    private func save() async throws {
        let api = TeachingAPI()
        if let createdID {
            try await upload(to: createdID, api: api)
            return
        }
        var fields: [String: JSONValue] = [
            "groupId": .string(groupID),
            "title": .string(title.trimmingCharacters(in: .whitespaces)),
        ]
        let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { fields["description"] = .string(text) }
        if !subject.isEmpty { fields["subject"] = .string(subject) }
        let url = link.trimmingCharacters(in: .whitespaces)
        if !url.isEmpty { fields["url"] = .string(url) }
        let material = try await api.createMaterial(JSONBody(fields))
        createdID = material.id
        try await upload(to: material.id, api: api)
    }

    @MainActor
    private func upload(to materialID: String, api: TeachingAPI) async throws {
        while let file = files.first {
            try await api.uploadMaterialFile(materialID: materialID, data: file.data, filename: file.name, mime: file.mime)
            files.removeFirst()
        }
    }
}
