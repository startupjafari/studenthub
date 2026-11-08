import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Состояние файлов работы: открытие, выбор, загрузка, удаление. Отдельно от секции:
/// окна (просмотр, выбор файла, подтверждение) вешаются на экран целиком, а не на
/// секцию списка — модификатор на секции размножился бы на каждую её строку.
@MainActor
@Observable
final class StudentSubmissionFilesModel {
    let assignmentID: String
    /// Список поменялся — карточка перечитывает задание.
    @ObservationIgnored var onChanged: () async -> Void = {}

    let opener = RemoteFileOpener()
    var isImportingFile = false
    var photo: PhotosPickerItem?
    var isUploading = false
    var removing: StudentSubmissionFileDTO?
    var failure: String?

    init(assignmentID: String) {
        self.assignmentID = assignmentID
    }

    func open(_ file: StudentSubmissionFileDTO, submissionID: String?) {
        guard let submissionID else { return }
        let name = file.name ?? file.id
        Task {
            await opener.open(name: name) {
                try await StudentStudyAPI().submissionFileURL(submissionID: submissionID, fileID: file.id)
            }
        }
    }

    func attachFile(_ result: Result<URL, Error>) async {
        guard case .success(let url) = result else { return }
        // Файл из чужого каталога читается только так: иначе чтение запрещает песочница.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            failure = String(localized: "student.files.readFailed", defaultValue: "Не удалось прочитать файл")
            return
        }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        await upload(data: data, name: url.lastPathComponent, mime: mime)
    }

    /// Снимок iPhone — HEIC, ролик — MOV: сервер такие не берёт, поэтому файл сначала
    /// переводится в JPEG или MP4 — так же, как в ленте и чатах.
    func attachPhoto() async {
        guard let item = photo else { return }
        photo = nil
        do {
            let prepared = try await MediaPreparation.prepare(item)
            await upload(data: prepared.data, name: prepared.filename, mime: prepared.mime)
        } catch {
            failure = error.userMessage
        }
    }

    func remove(_ file: StudentSubmissionFileDTO) async {
        do {
            try await StudentStudyAPI().removeSubmissionFile(assignmentID: assignmentID, fileID: file.id)
            await onChanged()
        } catch {
            failure = error.userMessage
        }
    }

    private func upload(data: Data, name: String, mime: String) async {
        isUploading = true
        defer { isUploading = false }
        do {
            _ = try await StudentStudyAPI().attachSubmissionFile(assignmentID: assignmentID, data: data, name: name, mime: mime)
            await onChanged()
        } catch {
            failure = error.userMessage
        }
    }
}

extension View {
    /// Окна файлов работы — на экран карточки задания.
    func studentSubmissionFilesPresentation(_ model: StudentSubmissionFilesModel) -> some View {
        modifier(StudentSubmissionFilesPresentation(model: model))
    }
}

private struct StudentSubmissionFilesPresentation: ViewModifier {
    @Bindable var model: StudentSubmissionFilesModel

    func body(content: Content) -> some View {
        content
            .remoteFilePreview(model.opener)
            .fileImporter(isPresented: $model.isImportingFile, allowedContentTypes: [.item]) { result in
                Task { await model.attachFile(result) }
            }
            .onChange(of: model.photo) {
                Task { await model.attachPhoto() }
            }
            .confirmDestructive(
                $model.removing,
                title: { String(localized: "student.files.removeConfirm", defaultValue: "Убрать «\($0.name.orEmpty)» из работы?") },
                actionTitle: String(localized: "student.files.remove", defaultValue: "Убрать файл")
            ) { file in
                await model.remove(file)
            }
            .actionFailureAlert($model.failure)
    }
}

/// Файлы работы студента (веб `submission-files.tsx`): список с открытием, а пока
/// работа не отправлена — прикрепить файл или фото и убрать лишнее. До десяти файлов.
struct StudentSubmissionFilesSection: View {
    @Bindable var model: StudentSubmissionFilesModel
    let submissionID: String?
    let files: [StudentSubmissionFileDTO]
    let isEditable: Bool

    static let maxFiles = 10

    var body: some View {
        Section {
            if files.isEmpty && !isEditable {
                Text(String(localized: "student.files.none", defaultValue: "Файлов нет"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            ForEach(files) { file in
                Button {
                    model.open(file, submissionID: submissionID)
                } label: {
                    HStack(spacing: Spacing.md) {
                        Image(systemName: Self.symbol(for: file.mime))
                            .foregroundStyle(Palette.primary)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(file.name ?? String(localized: "student.files.file", defaultValue: "Файл"))
                                .font(Typography.body)
                                .foregroundStyle(Palette.foreground)
                                .lineLimit(2)
                            if let size = file.size {
                                Text(verbatim: DisplayFormat.fileSize(size))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                        }
                        Spacer(minLength: Spacing.md)
                        Image(systemName: "arrow.down.circle")
                            .foregroundStyle(Palette.mutedForeground)
                            .accessibilityHidden(true)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityHint(Text(String(localized: "student.files.download", defaultValue: "Скачать файл")))
                .swipeActions {
                    if isEditable {
                        Button(role: .destructive) {
                            model.removing = file
                        } label: {
                            Label(String(localized: "student.files.remove", defaultValue: "Убрать файл"), systemImage: "trash")
                        }
                    }
                }
                .contextMenu {
                    if isEditable {
                        Button(role: .destructive) {
                            model.removing = file
                        } label: {
                            Label(String(localized: "student.files.remove", defaultValue: "Убрать файл"), systemImage: "trash")
                        }
                    }
                }
            }
            if isEditable {
                if model.isUploading {
                    HStack(spacing: Spacing.md) {
                        ProgressView()
                        Text(String(localized: "student.files.uploading", defaultValue: "Загружаем файл…"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                } else if files.count < Self.maxFiles {
                    Button {
                        model.isImportingFile = true
                    } label: {
                        Label(String(localized: "student.files.attach", defaultValue: "Прикрепить файл"), systemImage: "paperclip")
                    }
                    PhotosPicker(selection: $model.photo, matching: .any(of: [.images, .videos])) {
                        Label(String(localized: "student.files.attachPhoto", defaultValue: "Прикрепить фото или видео"), systemImage: "photo")
                    }
                }
            }
        } header: {
            Text(String(localized: "student.files.title", defaultValue: "Файлы"))
        } footer: {
            if isEditable {
                Text(String(localized: "student.files.hint", defaultValue: "До \(String(Self.maxFiles)) файлов: документы, изображения, архивы"))
            }
        }
        .listRowBackground(Palette.card)
    }

    static func symbol(for mime: String?) -> String {
        guard let mime else { return "doc" }
        if mime.hasPrefix("image/") { return "photo" }
        if mime.hasPrefix("video/") { return "film" }
        if mime.hasPrefix("audio/") { return "waveform" }
        if mime.contains("pdf") { return "doc.richtext" }
        if mime.contains("zip") || mime.contains("compressed") { return "doc.zipper" }
        return "doc"
    }
}
