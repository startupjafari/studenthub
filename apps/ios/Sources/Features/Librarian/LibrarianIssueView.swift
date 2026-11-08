import SwiftUI

/// Выдача книг (веб `/library/issue`). Два скана: студенческий читателя (разовый QR —
/// сервер выдаёт пропуск на 15 минут) и наклейка экземпляра; срок — по правилам вуза.
/// По одному пропуску можно выдать несколько книг подряд. Читатель без телефона —
/// поиск по номеру билета и обязательная отметка «без телефона».
struct LibrarianIssueView: View {
    /// Токен студенческого из общего сканера: читатель открывается сразу.
    var initialToken: String?

    @State private var session: LibrarianReaderSessionDTO?
    @State private var busy = false
    @State private var failure: String?
    @State private var round = 0
    @State private var cameraUnavailable = false
    @State private var notice: String?
    @State private var manualCode = ""
    @State private var manualInvalid = false
    @State private var cardNumber = ""
    @State private var startedInitial = false

    private let api = LibrarianAPI()

    var body: some View {
        Group {
            if let session {
                LibrarianReaderSessionView(session: session) {
                    self.session = nil
                    round += 1
                }
            } else {
                identify
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(LibrarianScreen.issue.title))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard !startedInitial, let initialToken, !initialToken.isEmpty else { return }
            startedInitial = true
            await resolve(token: initialToken)
        }
    }

    private var identify: some View {
        List {
            Section {
                ZStack {
                    if busy {
                        LoadingStateView(title: String(localized: "librarian.issue.checkingReader", defaultValue: "Проверяем читателя…"))
                    } else if let failure {
                        VStack(spacing: Spacing.md) {
                            Image(systemName: "person.crop.circle.badge.exclamationmark")
                                .font(.largeTitle)
                                .foregroundStyle(Palette.destructive)
                            Text(String(localized: "librarian.issue.readerFailed", defaultValue: "Не удалось проверить читателя"))
                                .font(Typography.sectionTitle)
                            Text(failure)
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                                .multilineTextAlignment(.center)
                            Button(String(localized: "librarian.issue.scanAgain", defaultValue: "Сканировать снова")) {
                                self.failure = nil
                                round += 1
                            }
                            .buttonStyle(.borderedProminent)
                        }
                        .padding(Spacing.xl)
                    } else if cameraUnavailable {
                        ContentUnavailableView(
                            String(localized: "librarian.scan.noCamera", defaultValue: "Нет доступа к камере"),
                            systemImage: "video.slash",
                            description: Text(String(localized: "librarian.issue.noCameraHint", defaultValue: "Вставьте ссылку из QR студенческого или найдите читателя по номеру билета ниже."))
                        )
                    } else {
                        QRScannerView(onScan: handleScan, onUnavailable: { cameraUnavailable = true })
                            .id(round)
                    }
                }
                .frame(height: 300)
                .frame(maxWidth: .infinity)
                .background(busy || failure != nil || cameraUnavailable ? Palette.card : .black)
                .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
                .listRowInsets(EdgeInsets())
            } header: {
                Text(String(localized: "librarian.issue.scanReader", defaultValue: "Студенческий читателя"))
            } footer: {
                if let notice {
                    Label(notice, systemImage: "exclamationmark.triangle").foregroundStyle(Palette.warning)
                } else {
                    Text(String(localized: "librarian.issue.scanReaderHint", defaultValue: "Попросите показать цифровой студенческий в приложении"))
                }
            }
            .listRowBackground(Color.clear)

            Section {
                TextField(String(localized: "librarian.issue.manualPlaceholder", defaultValue: "Код из QR студенческого"), text: $manualCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit(submitManual)
                Button(String(localized: "librarian.issue.manualSubmit", defaultValue: "Открыть"), action: submitManual)
                    .disabled(manualCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
            } header: {
                Text(String(localized: "librarian.issue.manualTitle", defaultValue: "Без камеры"))
            } footer: {
                if manualInvalid {
                    Text(String(localized: "librarian.issue.manualInvalid", defaultValue: "Это не код студенческого — отсканируйте QR из приложения студента"))
                        .foregroundStyle(Palette.destructive)
                } else {
                    Text(String(localized: "librarian.issue.manualHint", defaultValue: "Вставьте ссылку из QR студенческого"))
                }
            }
            .listRowBackground(Palette.card)

            Section {
                TextField(String(localized: "librarian.issue.cardPlaceholder", defaultValue: "Номер студенческого билета"), text: $cardNumber)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                    .onSubmit { Task { await lookup() } }
                Button(String(localized: "librarian.issue.cardSubmit", defaultValue: "Найти")) {
                    Task { await lookup() }
                }
                .disabled(cardNumber.trimmingCharacters(in: .whitespaces).isEmpty || busy)
            } header: {
                Text(String(localized: "librarian.issue.noPhoneTitle", defaultValue: "Читатель без телефона"))
            } footer: {
                Text(String(localized: "librarian.issue.noPhoneHint", defaultValue: "Нет цифрового студенческого под рукой? Найдите читателя по номеру студенческого билета и сверьте ФИО и фото."))
            }
            .listRowBackground(Palette.card)

            Section(String(localized: "librarian.issue.howTo", defaultValue: "Как выдать")) {
                Label(String(localized: "librarian.issue.step1", defaultValue: "Студент открывает «Студенческий» в приложении"), systemImage: "1.circle")
                Label(String(localized: "librarian.issue.step2", defaultValue: "Сканируете его QR — появится карточка читателя"), systemImage: "2.circle")
                Label(String(localized: "librarian.issue.step3", defaultValue: "Сканируете наклейку книги или вводите инвентарный номер"), systemImage: "3.circle")
            }
            .font(Typography.meta)
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
    }

    private func handleScan(_ raw: String) {
        if case .studentID(let token) = LibrarianQRTarget.parse(raw) {
            notice = nil
            Task { await resolve(token: token) }
        } else {
            notice = String(localized: "librarian.issue.notStudentID", defaultValue: "Это не QR студенческого билета")
            round += 1
        }
    }

    private func submitManual() {
        let raw = manualCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return }
        if case .studentID(let token) = LibrarianQRTarget.parse(raw) {
            manualInvalid = false
            manualCode = ""
            Task { await resolve(token: token) }
        } else if !raw.contains("/"), !raw.contains(" "), raw.count >= 16 {
            // Ручной сканер «печатает» содержимое QR — иногда только сам код.
            manualInvalid = false
            manualCode = ""
            Task { await resolve(token: raw) }
        } else {
            manualInvalid = true
        }
    }

    @MainActor
    private func resolve(token: String) async {
        busy = true
        defer { busy = false }
        do {
            session = try await api.resolveReader(token: token)
            failure = nil
        } catch {
            failure = LibrarianText.deskMessage(error)
        }
    }

    @MainActor
    private func lookup() async {
        let card = cardNumber.trimmingCharacters(in: .whitespaces)
        guard !card.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            session = try await api.lookupReader(card: card)
            failure = nil
            cardNumber = ""
        } catch {
            if (error as? APIError)?.code == .notFound {
                failure = String(localized: "librarian.issue.cardNotFound", defaultValue: "Читатель с таким номером студенческого в вузе не найден")
            } else {
                failure = LibrarianText.deskMessage(error)
            }
        }
    }
}

/// Сессия выдачи: читатель, можно ли выдавать, книга и срок, выданное сейчас.
private struct LibrarianReaderSessionView: View {
    let session: LibrarianReaderSessionDTO
    let reset: () -> Void

    @State private var copy: LibrarianCopyRef?
    @State private var dueDate: Date
    @State private var issued: [LibrarianLoanDTO] = []
    @State private var noPhoneChecked = false
    @State private var failure: String?
    @State private var notice: String?
    @State private var isIssuing = false
    @State private var expired: String?

    private let api = LibrarianAPI()

    init(session: LibrarianReaderSessionDTO, reset: @escaping () -> Void) {
        self.session = session
        self.reset = reset
        _dueDate = State(initialValue: LibrarianText.date(fromDay: session.defaultDueDate) ?? Date())
    }

    /// Выданное в этот раз считается на месте: пропуск по второму QR не обновить.
    private var active: Int { session.eligibility.activeLoans + issued.count }
    private var noPhone: Bool { session.via == "card" }

    private var blockers: [String] {
        var list = session.eligibility.blockers.filter { $0 != "limit" }
        if active >= session.eligibility.maxActiveLoans { list.append("limit") }
        return list
    }

    /// С сегодняшнего дня до предельного срока правил; сервер проверит сам. Верхняя граница
    /// не ниже нижней — иначе диапазон дат уронил бы экран.
    private var dueRange: ClosedRange<Date> {
        let today = Calendar.current.startOfDay(for: Date())
        let maxDay = LibrarianText.date(fromDay: session.maxDueDate) ?? Date.distantFuture
        return today...max(today, maxDay)
    }

    private var ready: Bool { copy != nil && blockers.isEmpty && (!noPhone || noPhoneChecked) && !isIssuing }

    var body: some View {
        List {
            Section {
                HStack(spacing: Spacing.lg) {
                    AvatarView(url: session.reader.avatarUrl, name: session.reader.fullName, size: 64)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(session.reader.fullName).font(Typography.sectionTitle)
                        HStack(spacing: Spacing.xs) {
                            LibrarianBadge(
                                text: blockers.isEmpty
                                    ? String(localized: "librarian.issue.canBorrow", defaultValue: "Можно выдавать")
                                    : String(localized: "librarian.issue.cannotBorrow", defaultValue: "Выдавать нельзя"),
                                tint: blockers.isEmpty ? Palette.success : Palette.destructive
                            )
                            LibrarianBadge(
                                text: String(localized: "librarian.issue.onHands", defaultValue: "На руках \(active.formatted()) из \(session.eligibility.maxActiveLoans.formatted())"),
                                tint: Palette.mutedForeground
                            )
                        }
                        if noPhone {
                            LibrarianBadge(text: String(localized: "librarian.noPhoneBadge", defaultValue: "Без телефона"), tint: Palette.warning)
                        }
                    }
                }
                .padding(.vertical, Spacing.xs)
                if let group = session.reader.group {
                    DetailRow(title: String(localized: "librarian.reader.group", defaultValue: "Группа"), value: group)
                }
                if let course = session.reader.course {
                    DetailRow(title: String(localized: "librarian.reader.course", defaultValue: "Курс"), value: String(course))
                }
                if let faculty = session.reader.faculty {
                    DetailRow(title: String(localized: "librarian.reader.faculty", defaultValue: "Факультет"), value: faculty)
                }
                if let card = session.reader.studentCardNumber {
                    DetailRow(title: String(localized: "librarian.reader.card", defaultValue: "№ билета"), value: card)
                }
            } footer: {
                Text(String(
                    localized: "librarian.issue.ticketUntil",
                    defaultValue: "Пропуск на выдачу действует до \(session.ticketExpiresAt.formatted(.dateTime.hour().minute()))"
                ))
            }
            .listRowBackground(Palette.card)

            if noPhone {
                Section {
                    Text(String(localized: "librarian.issue.noPhoneWarning", defaultValue: "Читатель найден по номеру билета, без скана QR. Сверьте ФИО и фото с человеком у стойки — выдача будет отмечена «без телефона» и попадёт в журнал удостоверений."))
                        .font(Typography.meta)
                    Toggle(String(localized: "librarian.issue.noPhoneMark", defaultValue: "Читатель без телефона: ФИО и фото сверены"), isOn: $noPhoneChecked)
                }
                .listRowBackground(Palette.warning.opacity(0.12))
            }

            if !blockers.isEmpty {
                Section {
                    ForEach(blockers, id: \.self) { blocker in
                        Label(LibrarianText.blocker(blocker), systemImage: "xmark.octagon")
                            .foregroundStyle(Palette.destructive)
                    }
                }
                .listRowBackground(Palette.destructive.opacity(0.1))
            }

            Section {
                LibrarianCopyField(value: $copy)
                DatePicker(
                    String(localized: "librarian.issue.dueDate", defaultValue: "Вернуть до"),
                    selection: $dueDate,
                    in: dueRange,
                    displayedComponents: .date
                )
                Button {
                    Task { await issue() }
                } label: {
                    HStack {
                        Spacer()
                        if isIssuing { ProgressView() } else { Text(String(localized: "librarian.issue.submit", defaultValue: "Выдать")).bold() }
                        Spacer()
                    }
                }
                .disabled(!ready)
            } header: {
                Text(String(localized: "librarian.issue.book", defaultValue: "Выдать книгу"))
            } footer: {
                if let failure {
                    Text(failure).foregroundStyle(Palette.destructive)
                } else if let notice {
                    Text(notice).foregroundStyle(Palette.success)
                } else {
                    Text(String(localized: "librarian.issue.bookHint", defaultValue: "Отсканируйте наклейку на книге или введите инвентарный номер"))
                }
            }
            .listRowBackground(Palette.card)

            if !issued.isEmpty {
                Section {
                    ForEach(issued) { LibrarianLoanRow(loan: $0, showReader: false) }
                } header: {
                    Text(String(localized: "librarian.issue.issuedNow", defaultValue: "Выдано сейчас"))
                } footer: {
                    Text(String(localized: "librarian.issue.issuedNowHint", defaultValue: "Читателю пришло уведомление со сроком"))
                }
                .listRowBackground(Palette.card)
            }

            Section {
                let open = session.loans.filter { $0.status == "OPEN" }
                if open.isEmpty {
                    Text(String(localized: "librarian.issue.noOpenLoans", defaultValue: "Книг на руках нет"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                ForEach(open) { LibrarianLoanRow(loan: $0, showReader: false) }
            } header: {
                Text(String(localized: "librarian.issue.readerLoans", defaultValue: "Книги на руках"))
            } footer: {
                Text(String(localized: "librarian.issue.readerLoansHint", defaultValue: "До этой выдачи"))
            }
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(String(localized: "librarian.issue.nextReader", defaultValue: "Следующий читатель"), action: reset)
            }
        }
        .alert(expired ?? "", isPresented: Binding(get: { expired != nil }, set: { if !$0 { expired = nil } })) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) { reset() }
        }
    }

    @MainActor
    private func issue() async {
        guard let copy, ready else { return }
        isIssuing = true
        defer { isIssuing = false }
        do {
            let loan = try await api.issue(
                ticket: session.ticket,
                copy: copy,
                dueDate: LibrarianText.dayString(dueDate),
                withoutPhone: noPhone
            )
            issued.insert(loan, at: 0)
            self.copy = nil
            failure = nil
            notice = String(localized: "librarian.issue.issuedToast", defaultValue: "Выдано: «\(loan.book.title)»")
        } catch {
            if LibrarianText.isTicketError(error) {
                expired = LibrarianText.deskMessage(error)
                return
            }
            notice = nil
            failure = LibrarianText.deskMessage(error)
        }
    }
}
