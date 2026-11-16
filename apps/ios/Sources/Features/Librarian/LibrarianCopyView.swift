import SwiftUI

/// Экземпляр по коду с наклейки глазами библиотекаря (веб `/c/<код>` ведёт к книге в фонде
/// с выделенным экземпляром): сам экземпляр с действиями и книга рядом.
struct LibrarianCopyView: View {
    let code: String

    @State private var token = 0
    private let api = LibrarianAPI()

    var body: some View {
        RemoteContent(reloadToken: token, load: load) { found in
            if let found {
                LibrarianCopyDetail(copy: found.copy, book: found.book) { token += 1 }
                    .id("\(found.copy.id)-\(token)")
            } else {
                EmptyStateView(
                    title: String(localized: "librarian.copy.notFoundTitle", defaultValue: "Наклейка не найдена"),
                    symbol: "book.closed",
                    hint: String(localized: "librarian.copy.notFoundHint", defaultValue: "Код неизвестен или наклейку перевыпустили. Найдите книгу в каталоге.")
                )
            }
        }
        .navigationTitle(Text(LibrarianScreen.copy(code: code).title))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func load() async throws -> LibrarianCopyByCodeDTO? {
        do {
            return try await api.copy(code: code)
        } catch let error as APIError where error.code == .notFound {
            return nil
        }
    }
}

/// Сканер StudentHub для библиотекаря (веб `/scan`): наклейка книги — к экземпляру,
/// студенческий — к выдаче этому читателю, вход на компьютере — к подтверждению входа.
struct LibrarianScanView: View {
    @State private var notice: String?
    @State private var unavailable = false
    @State private var copyCode: String?
    @State private var readerToken: String?
    @State private var approvingLogin = false
    @State private var manual = ""

    var body: some View {
        VStack(spacing: Spacing.lg) {
            LibrarianScannerView(onCode: handle, onUnavailable: { unavailable = true })
                .overlay {
                    if unavailable {
                        ContentUnavailableView(
                            String(localized: "librarian.scan.noCamera", defaultValue: "Нет доступа к камере"),
                            systemImage: "video.slash",
                            description: Text(String(localized: "librarian.scan.noCameraHint", defaultValue: "Разрешите доступ к камере в настройках iPhone или введите номер вручную."))
                        )
                        .background(Palette.card)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
            Text(String(localized: "librarian.scan.hint", defaultValue: "Наведите камеру на QR StudentHub: наклейка книги, студенческий читателя или вход на компьютере"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
            if let notice {
                Label(notice, systemImage: "exclamationmark.triangle")
                    .font(Typography.meta)
                    .foregroundStyle(Palette.warning)
            }
            HStack {
                TextField(String(localized: "librarian.scan.manualPlaceholder", defaultValue: "Код наклейки или ссылка"), text: $manual)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .padding(Spacing.md)
                    .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.md))
                    .onSubmit(submitManual)
                Button(String(localized: "librarian.scan.open", defaultValue: "Открыть"), action: submitManual)
                    .glassButton()
                    .disabled(manual.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(Spacing.xl)
        .background(Palette.background)
        .navigationTitle(Text(LibrarianScreen.scan.title))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $copyCode) { code in LibrarianCopyView(code: code) }
        .navigationDestination(item: $readerToken) { token in LibrarianIssueView(initialToken: token) }
        .fullScreenCover(isPresented: $approvingLogin) { QRApproveView() }
    }

    private func handle(_ raw: String) -> Bool {
        // Сканер продолжает работать под открытым экраном — второй переход не нужен.
        guard copyCode == nil, readerToken == nil, !approvingLogin else { return false }
        switch LibrarianQRTarget.parse(raw) {
        case .copy(let code):
            notice = nil
            copyCode = code
            return true
        case .studentID(let token):
            notice = nil
            readerToken = token
            return true
        case .login:
            // Подтверждение входа живёт своим экраном со своим сканером и предупреждением,
            // чьё устройство просит вход.
            notice = String(localized: "librarian.scan.loginHint", defaultValue: "Это вход на компьютере — отсканируйте код ещё раз в окне подтверждения")
            approvingLogin = true
            return true
        case .other:
            notice = String(localized: "librarian.scan.notStudentHub", defaultValue: "Это не QR StudentHub")
            return false
        }
    }

    private func submitManual() {
        let raw = manual.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return }
        if case .copy(let code) = LibrarianQRTarget.parse(raw) {
            copyCode = code
        } else {
            let cleaned = raw.uppercased().filter { !$0.isWhitespace && $0 != "-" }
            if LibrarianQRTarget.isCode(cleaned) {
                copyCode = cleaned
            } else {
                notice = String(localized: "librarian.scan.codeInvalid", defaultValue: "Код наклейки — 8 букв и цифр, например ABCD-EFGH")
                return
            }
        }
        manual = ""
        notice = nil
    }
}
