import Photos
import SwiftUI
import UniformTypeIdentifiers

/// Итог пересылки по каждому чату — сервер отвечает за всех сразу, и часть может не
/// пройти (запрос на переписку не принят, участника исключили).
struct ForwardOutcome: Equatable {
    var delivered: [String] = []
    var failed: [String] = []
    /// Ошибка всего запроса (нет сети, сервер упал) — повтор с тем же ключом безопасен.
    var failure: String?

    var isComplete: Bool { failure == nil && failed.isEmpty && !delivered.isEmpty }
}

/// Лист «Поделиться» как в Telegram: сверху — закрыть, заголовок и системное
/// «Поделиться», под ними — поиск, ниже — сетка чатов с аватарами («Избранное» первым,
/// дальше по свежести), выбор нескольких галочками. Выбрали — поле «Подпись…» и
/// «Отправить N»; ничего не выбрано — «Сохранить в галерею» (если пересылаются медиа).
///
/// Им же открывается «Переслать» из меню сообщения и из режима выбора.
///
/// Повторное нажатие и сетевой повтор не дублируют сообщения: ключ идемпотентности
/// создаётся один раз на лист и уходит с каждой попыткой (сервер отдаёт прежний ответ).
struct ChatShareSheet: View {
    let send: (_ chatIDs: [String], _ comment: String?, _ requestID: UUID) async -> ForwardOutcome
    /// Файлы для системного «Поделиться» и «Сохранить в галерею»; `nil` — медиа нет.
    var exportFiles: (() async throws -> [URL])?
    /// Текст для системного «Поделиться», когда файлов нет.
    var shareText: String?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.motionReduced) private var reduceMotion
    @State private var rows: [ChatListRow] = []
    /// База прочитана — до этого пустой список не значит «чатов нет».
    @State private var loaded = false
    @State private var selected: [String] = []
    @State private var query = ""
    @State private var comment = ""
    @State private var isSending = false
    @State private var isExporting = false
    @State private var failure: String?
    @State private var sentTick = 0
    @State private var savedTick = 0
    @State private var systemShare: SharePayload?
    /// Один ключ на лист: повтор после сбоя сети сервер узнает и не отправит второй раз.
    @State private var requestID = UUID()

    var body: some View {
        VStack(spacing: Spacing.md) {
            header
            ExpressionSearchField(
                query: $query,
                prompt: String(localized: "chats.forward.search", defaultValue: "Поиск")
            )
            .padding(.horizontal, Spacing.xl)
            grid
        }
        .padding(.top, Spacing.lg)
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomPanel }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isSending)
        .sensoryFeedback(.success, trigger: sentTick)
        .sensoryFeedback(.success, trigger: savedTick)
        .sensoryFeedback(.selection, trigger: selected)
        .sheet(item: $systemShare) { payload in
            ShareSheet(items: payload.items)
                .presentationDetents([.medium, .large])
        }
        .task { await load() }
    }

    // MARK: Шапка

    private var header: some View {
        HStack(spacing: Spacing.md) {
            GlassCloseButton { dismiss() }
            VStack(spacing: 0) {
                Text(String(localized: "chats.share.title", defaultValue: "Поделиться"))
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                Text(subtitle)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
            Button {
                Task { await openSystemShare() }
            } label: {
                ZStack {
                    if isExporting {
                        ProgressView()
                    } else {
                        Image(systemName: "square.and.arrow.up")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Palette.foreground)
                    }
                }
                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                .floatingGlass(in: Circle())
                .contentShape(Circle())
            }
            .buttonStyle(.pressableIcon)
            .disabled(isExporting || (exportFiles == nil && shareText?.isEmpty != false))
            .accessibilityLabel(Text(String(localized: "chats.share.system", defaultValue: "Поделиться через…")))
        }
        .padding(.horizontal, Spacing.xl)
    }

    /// Под заголовком — кого выбрали, как в Telegram; пока никого — подсказка.
    private var subtitle: String {
        let names = selected.compactMap { id in rows.first { $0.id == id }?.displayTitle }
        return names.isEmpty
            ? String(localized: "chats.share.pick", defaultValue: "Выберите чаты")
            : names.joined(separator: ", ")
    }

    // MARK: Сетка

    private static let columns = [GridItem(.adaptive(minimum: 64, maximum: 84), spacing: Spacing.sm, alignment: .top)]

    private var grid: some View {
        ScrollView {
            LazyVGrid(columns: Self.columns, spacing: Spacing.lg) {
                ForEach(filtered) { row in
                    Button {
                        toggle(row.id)
                    } label: {
                        ShareTargetCell(row: row, isSelected: selected.contains(row.id))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected.contains(row.id) ? .isSelected : [])
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.lg)
        }
        .scrollDismissesKeyboard(.immediately)
        .overlay {
            if loaded, filtered.isEmpty {
                EmptyStateView(
                    title: query.trimmingCharacters(in: .whitespaces).isEmpty
                        ? String(localized: "chats.empty", defaultValue: "Чатов пока нет")
                        : String(localized: "services.notFound", defaultValue: "Ничего не нашлось"),
                    symbol: query.trimmingCharacters(in: .whitespaces).isEmpty ? "bubble.left.and.bubble.right" : "magnifyingglass"
                )
            }
        }
    }

    // MARK: Нижняя панель

    @ViewBuilder
    private var bottomPanel: some View {
        VStack(spacing: Spacing.sm) {
            if let failure {
                Text(failure)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !selected.isEmpty {
                TextField(
                    text: $comment,
                    prompt: Text(String(localized: "chats.share.caption", defaultValue: "Подпись…")),
                    axis: .vertical
                ) {
                    Text(String(localized: "chats.share.caption", defaultValue: "Подпись…"))
                }
                .lineLimit(1...4)
                .font(Typography.body)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
                .frame(minHeight: ControlHeight.lg)
                .composerGlass(in: RoundedRectangle(cornerRadius: ControlHeight.lg / 2, style: .continuous))
                .transition(.move(edge: .bottom).combined(with: .opacity))

                Button {
                    Task { await submit() }
                } label: {
                    HStack(spacing: Spacing.sm) {
                        Text(String(localized: "chats.send", defaultValue: "Отправить"))
                        Text(verbatim: selected.count.formatted())
                            .font(Typography.meta.weight(.bold))
                            .foregroundStyle(Palette.primary)
                            .padding(.horizontal, Spacing.sm)
                            .frame(minWidth: 22, minHeight: 22)
                            .background(Palette.primaryForeground, in: Capsule())
                    }
                }
                .buttonStyle(PrimaryButtonStyle(isLoading: isSending))
                .disabled(isSending)
            } else if exportFiles != nil {
                Button {
                    Task { await saveToGallery() }
                } label: {
                    Text(String(localized: "chats.share.saveToGallery", defaultValue: "Сохранить в галерею"))
                }
                .buttonStyle(PrimaryButtonStyle(isLoading: isExporting))
                .disabled(isExporting)
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: selected.isEmpty)
    }

    // MARK: Выбор и отправка

    private func toggle(_ id: String) {
        failure = nil
        if let index = selected.firstIndex(of: id) {
            selected.remove(at: index)
        } else {
            selected.append(id)
        }
    }

    private func submit() async {
        guard !selected.isEmpty, !isSending else { return }
        isSending = true
        failure = nil
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        let outcome = await send(selected, trimmed.isEmpty ? nil : String(trimmed.prefix(4000)), requestID)
        isSending = false
        if outcome.isComplete {
            sentTick += 1
            dismiss()
            return
        }
        if let message = outcome.failure {
            // Сеть или сервер: повтор пойдёт с тем же ключом и не задвоит пересланное.
            failure = message
            return
        }
        // Часть чатов отказала: дошедшие убираем из выбора, новая попытка — новый ключ
        // (прежний запрос сервер уже завершил и повторил бы его ответ).
        selected.removeAll { outcome.delivered.contains($0) }
        requestID = UUID()
        failure = String(
            localized: "chats.forward.partial",
            defaultValue: "Не удалось переслать в некоторые чаты — они остались отмеченными"
        )
    }

    private func openSystemShare() async {
        failure = nil
        if let exportFiles {
            isExporting = true
            defer { isExporting = false }
            do {
                systemShare = SharePayload(items: try await exportFiles())
            } catch is CancellationError {
                return
            } catch {
                failure = error.userMessage
            }
        } else if let shareText, !shareText.isEmpty {
            systemShare = SharePayload(items: [shareText])
        }
    }

    private func saveToGallery() async {
        guard let exportFiles else { return }
        failure = nil
        isExporting = true
        defer { isExporting = false }
        do {
            try await PhotoLibrarySaver.save(try await exportFiles())
            savedTick += 1
            dismiss()
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    // MARK: Данные

    private var filtered: [ChatListRow] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return rows }
        return rows.filter { $0.displayTitle.localizedCaseInsensitiveContains(trimmed) }
    }

    /// Список читается из базы: делятся в знакомые чаты, а сеть для выбора не нужна.
    private func load() async {
        let all = (try? await AppServices.database.reader.read { db in
            try ChatListQuery.rows(for: .all).fetchAll(db)
        }) ?? []
        rows = Self.ordered(all)
        loaded = true
    }

    /// «Избранное» первым, дальше — по свежести последнего сообщения, как в Telegram:
    /// закрепление в этом листе не важно. Туда, где висит непринятый запрос, писать нельзя.
    static func ordered(_ all: [ChatListRow]) -> [ChatListRow] {
        let writable = all.filter { !$0.requestIncoming }
        let saved = writable.filter { $0.kind == .saved }
        let rest = writable
            .filter { $0.kind != .saved }
            .sorted { ($0.lastCreatedAt ?? $0.updatedAt) > ($1.lastCreatedAt ?? $1.updatedAt) }
        return saved + rest
    }

    private struct SharePayload: Identifiable {
        let id = UUID()
        let items: [Any]
    }
}

/// Чат в сетке: аватар с галочкой выбора и подпись в две строки.
private struct ShareTargetCell: View {
    let row: ChatListRow
    let isSelected: Bool

    private static let avatar: CGFloat = 60

    var body: some View {
        VStack(spacing: Spacing.xs) {
            ChatAvatarView(title: row.title ?? row.displayTitle, kind: row.kind, avatarURL: row.avatarUrl, size: Self.avatar)
                .padding(3)
                .overlay {
                    Circle()
                        .strokeBorder(Palette.primary, lineWidth: 2)
                        .opacity(isSelected ? 1 : 0)
                }
                .overlay(alignment: .bottomTrailing) {
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title3)
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(Palette.primaryForeground, Palette.primary)
                            .background(Circle().fill(Palette.background).padding(2))
                            .transition(.scale.combined(with: .opacity))
                    }
                }
            Text(row.displayTitle)
                .font(Typography.meta)
                .foregroundStyle(isSelected ? Palette.primary : Palette.foreground)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: .infinity)
        }
        .contentShape(Rectangle())
        .animation(Motion.isReducedNow ? nil : Motion.lively, value: isSelected)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - «Фото»

/// Сохранение снимков и роликов в «Фото». Видео или снимок — по расширению файла.
enum PhotoLibrarySaver {
    struct Denied: LocalizedError {
        var errorDescription: String? {
            String(localized: "media.photosDenied", defaultValue: "Нет доступа к «Фото». Разрешите его в Настройках")
        }
    }

    static func save(_ files: [URL]) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { throw Denied() }
        try await PHPhotoLibrary.shared().performChanges {
            for file in files {
                if UTType(filenameExtension: file.pathExtension)?.conforms(to: .movie) == true {
                    PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: file)
                } else {
                    PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: file)
                }
            }
        }
    }
}
