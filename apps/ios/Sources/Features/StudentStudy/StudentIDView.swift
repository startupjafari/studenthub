import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// «Цифровой студенческий» (веб `/student-id`): карта с фото, ФИО, статусом и
/// реквизитами и динамический QR для проверки сотрудником. Код обновляется каждые
/// 45 секунд (токен живёт около двух минут), просроченный не выдаётся за действующий.
struct StudentIDView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var card: StudentIDCardDTO?
    /// QR рисуется один раз на загрузку, а не на каждый тик таймера.
    @State private var qrImage: UIImage?
    @State private var loadedAt = Date()
    @State private var failure: String?
    @State private var isOffline = false
    @State private var isRefreshing = false
    @State private var isQRExpanded = false

    private static let refreshSeconds = 45

    var body: some View {
        Group {
            if let card {
                ScrollView {
                    VStack(spacing: Spacing.xl) {
                        StudentIDCardFace(card: card)
                        qrPanel(card)
                    }
                    .padding(Spacing.xl)
                }
                .refreshable { await load() }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "student.id.title", defaultValue: "Цифровой студенческий")))
        .navigationBarTitleDisplayMode(.inline)
        // Тихое обновление кода, пока экран открыт.
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(Self.refreshSeconds))
            }
        }
        // После блокировки экрана код на руках старше срока — обновляем при возврате.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, Date().timeIntervalSince(loadedAt) >= Double(Self.refreshSeconds) {
                Task { await load() }
            }
        }
        .sheet(isPresented: $isQRExpanded) {
            if card != nil {
                NavigationStack {
                    VStack(spacing: Spacing.lg) {
                        StudentQRImage(image: qrImage)
                            .frame(maxWidth: 360)
                        Text(String(localized: "student.id.qrHint", defaultValue: "Сотрудник сканирует код, чтобы подтвердить подлинность билета."))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                            .multilineTextAlignment(.center)
                    }
                    .padding(Spacing.xl)
                    .navigationTitle(Text(String(localized: "student.id.qrTitle", defaultValue: "QR студенческого")))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button(String(localized: "common.ok", defaultValue: "Понятно")) { isQRExpanded = false }
                        }
                    }
                }
                .presentationDetents([.large])
            }
        }
    }

    private func qrPanel(_ card: StudentIDCardDTO) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let expired = context.date >= card.expiresAt
            let remaining = max(0, Self.refreshSeconds - Int(context.date.timeIntervalSince(loadedAt)))
            VStack(spacing: Spacing.md) {
                Button {
                    isQRExpanded = true
                } label: {
                    StudentQRImage(image: qrImage)
                        .frame(width: 260, height: 260)
                        .opacity(expired ? 0.2 : 1)
                        .blur(radius: expired ? 4 : 0)
                        .overlay(alignment: .bottomTrailing) {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.caption.weight(.semibold))
                                .padding(Spacing.sm)
                                .foregroundStyle(.white)
                                .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.md))
                                .padding(Spacing.sm)
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(String(localized: "student.id.qrEnlarge", defaultValue: "Открыть QR крупнее")))

                if expired {
                    Button {
                        Task { await load() }
                    } label: {
                        if isRefreshing {
                            ProgressView()
                        } else {
                            Label(String(localized: "student.id.qrExpired", defaultValue: "Код устарел — обновить"), systemImage: "arrow.clockwise")
                        }
                    }
                    .buttonStyle(QuietButtonStyle())
                } else {
                    Label(
                        String(localized: "student.id.refreshIn", defaultValue: "Обновится через \(String(remaining)) с"),
                        systemImage: "arrow.clockwise"
                    )
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                }
                Text(String(localized: "student.id.qrHint", defaultValue: "Сотрудник сканирует код, чтобы подтвердить подлинность билета."))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(Spacing.xl)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
        }
    }

    @MainActor
    private func load() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let fresh = try await StudentStudyAPI().studentID()
            card = fresh
            qrImage = StudentQRImage.image(for: fresh)
            loadedAt = Date()
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            // Карта уже на экране — оставляем её: просроченный код помечен сам.
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

/// Лицевая сторона билета: шапка вуза, фото, ФИО, статус, реквизиты (только заполненные).
private struct StudentIDCardFace: View {
    let card: StudentIDCardDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: Spacing.md) {
                Image(systemName: "graduationcap.fill")
                    .accessibilityHidden(true)
                Text(card.universityShort ?? card.university ?? String(localized: "student.id.card", defaultValue: "Студенческий билет"))
                    .font(Typography.meta.weight(.semibold))
                    .lineLimit(2)
                Spacer(minLength: Spacing.md)
                Label {
                    Text(verbatim: "StudentHub")
                } icon: {
                    Image(systemName: "checkmark.seal.fill")
                }
                .font(.caption.weight(.medium))
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, 2)
                .background(.white.opacity(0.18), in: Capsule())
            }
            .foregroundStyle(Palette.primaryForeground)
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.lg)
            .background(LinearGradient(colors: [Palette.primary, Palette.primary.opacity(0.8)], startPoint: .leading, endPoint: .trailing))

            HStack(alignment: .top, spacing: Spacing.lg) {
                AvatarView(url: card.avatarUrl, name: card.fullName, size: 96)
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(card.fullName)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(String(localized: "student.id.card", defaultValue: "Студенческий билет").uppercased())
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Palette.mutedForeground)
                    statusBadge
                }
            }
            .padding(Spacing.xl)

            if !rows.isEmpty {
                Divider()
                LazyVGrid(columns: [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)], alignment: .leading, spacing: Spacing.lg) {
                    ForEach(rows.filter { !$0.wide }, id: \.title) { row in
                        field(row)
                    }
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.top, Spacing.lg)
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    ForEach(rows.filter(\.wide), id: \.title) { row in
                        field(row)
                    }
                }
                .padding(Spacing.xl)
            }
        }
        .background(Palette.card)
        .clipShape(RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))
    }

    private struct Row {
        let title: String
        let value: String
        var wide = false
        var mono = false
    }

    private var statusBadge: some View {
        let code = StudentAcademicStatus.code(card.academicStatus)
        if card.academicStatus == nil || code == "ACTIVE" {
            return StatusBadge(text: String(localized: "student.id.statusActive", defaultValue: "Активен · Обучается"), tint: Palette.success)
        }
        let tint = code == "ACADEMIC_LEAVE" ? Palette.warning : Palette.mutedForeground
        return StatusBadge(text: StudentAcademicStatus.title(card.academicStatus), tint: tint)
    }

    /// Порядок — как на бумажном билете: где учится, что изучает, на каких условиях,
    /// кто он по документам.
    private var rows: [Row] {
        var rows: [Row] = []
        if let value = card.university { rows.append(Row(title: String(localized: "student.id.university", defaultValue: "Университет"), value: value, wide: true)) }
        if let value = card.faculty { rows.append(Row(title: String(localized: "student.id.faculty", defaultValue: "Факультет"), value: value, wide: true)) }
        if let value = card.specialty { rows.append(Row(title: String(localized: "student.id.specialty", defaultValue: "Специальность"), value: value, wide: true)) }
        if let value = card.group { rows.append(Row(title: String(localized: "student.id.group", defaultValue: "Группа"), value: value)) }
        if let value = card.course { rows.append(Row(title: String(localized: "student.id.course", defaultValue: "Курс"), value: String(value))) }
        if let value = card.educationLevel { rows.append(Row(title: String(localized: "student.id.level", defaultValue: "Уровень"), value: Self.level(value))) }
        if let value = card.studyForm { rows.append(Row(title: String(localized: "student.id.form", defaultValue: "Форма обучения"), value: Self.form(value))) }
        if let value = card.fundingType { rows.append(Row(title: String(localized: "student.id.funding", defaultValue: "Финансирование"), value: Self.funding(value))) }
        if let value = card.birthDate { rows.append(Row(title: String(localized: "student.id.birthDate", defaultValue: "Дата рождения"), value: Self.birthDate(value))) }
        if let value = card.enrollmentYear { rows.append(Row(title: String(localized: "student.id.enrollmentYear", defaultValue: "Год поступления"), value: String(value))) }
        if let value = card.graduationYear { rows.append(Row(title: String(localized: "student.id.validUntil", defaultValue: "Действителен до"), value: String(value))) }
        if let value = card.studentCardNumber { rows.append(Row(title: String(localized: "student.id.cardNumber", defaultValue: "№ студенческого"), value: value, mono: true)) }
        if let value = card.dormitory { rows.append(Row(title: String(localized: "student.id.dormitory", defaultValue: "Общежитие"), value: value, wide: true)) }
        return rows
    }

    private func field(_ row: Row) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(row.title)
                .font(.caption)
                .foregroundStyle(Palette.mutedForeground)
            Text(row.value)
                .font(row.mono ? Typography.body.weight(.medium).monospacedDigit() : Typography.body.weight(.medium))
                .foregroundStyle(Palette.foreground)
                .lineLimit(row.wide ? nil : 2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private static func level(_ raw: String) -> String {
        switch raw {
        case "BACHELOR": return String(localized: "student.id.level.bachelor", defaultValue: "Бакалавриат")
        case "MASTER": return String(localized: "student.id.level.master", defaultValue: "Магистратура")
        case "PHD": return String(localized: "student.id.level.phd", defaultValue: "Докторантура (PhD)")
        default: return raw
        }
    }

    private static func form(_ raw: String) -> String {
        switch raw {
        case "FULL_TIME": return String(localized: "student.id.form.fullTime", defaultValue: "Очная")
        case "PART_TIME": return String(localized: "student.id.form.partTime", defaultValue: "Заочная")
        case "DISTANCE": return String(localized: "student.id.form.distance", defaultValue: "Дистанционная")
        default: return raw
        }
    }

    private static func funding(_ raw: String) -> String {
        switch raw {
        case "GRANT": return String(localized: "student.id.funding.grant", defaultValue: "Грант")
        case "PAID": return String(localized: "student.id.funding.paid", defaultValue: "Платное")
        case "QUOTA": return String(localized: "student.id.funding.quota", defaultValue: "Квота")
        default: return raw
        }
    }

    /// Дата рождения — календарная дата без времени: показываем её как есть, без пояса.
    private static func birthDate(_ raw: String) -> String {
        let parts = raw.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return raw }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        guard let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return raw }
        var style = Date.FormatStyle.dateTime.day().month(.wide).year()
        style.timeZone = calendar.timeZone
        return date.formatted(style)
    }
}

/// QR билета. Рисуется на устройстве (CoreImage) из той же ссылки проверки, что
/// кладёт в код сервер (`<веб>/verify-id?t=…`): без сглаживания, чётко на любом размере.
/// Адреса веба в сборке нет — показываем картинку, которую прислал сервер.
private struct StudentQRImage: View {
    let image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: "qrcode")
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .padding(Spacing.md)
        .background(Color.white, in: RoundedRectangle(cornerRadius: Radius.xl))
        .overlay(RoundedRectangle(cornerRadius: Radius.xl).strokeBorder(Palette.border, lineWidth: 1))
        .accessibilityLabel(Text(String(localized: "student.id.qrAlt", defaultValue: "QR студенческого билета")))
    }

    static func image(for card: StudentIDCardDTO) -> UIImage? {
        if let base = AppConfiguration.webBaseURL,
           var components = URLComponents(url: base.appendingPathComponent("verify-id"), resolvingAgainstBaseURL: false) {
            components.queryItems = [URLQueryItem(name: "t", value: card.token)]
            if let payload = components.url?.absoluteString, let image = generate(payload) {
                return image
            }
        }
        return decodeDataURL(card.qr)
    }

    private static func generate(_ payload: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        guard let cgImage = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }

    private static func decodeDataURL(_ raw: String?) -> UIImage? {
        guard let raw, let comma = raw.firstIndex(of: ",") else { return nil }
        guard let data = Data(base64Encoded: String(raw[raw.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }
}
