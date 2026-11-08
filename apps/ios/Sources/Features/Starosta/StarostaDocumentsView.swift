import SwiftUI

/// Сбор документов группы: кто из группы уже сдал комплект по запросам университета.
/// Староста видит статусы, чтобы напомнить, — самих документов здесь нет.
struct StarostaGroupDocumentsView: View {
    @State private var reloadToken = 0

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: { try await StarostaAPI().groupProgress() }) { requests in
            List {
                if requests.isEmpty {
                    EmptyStateView(
                        title: String(localized: "starosta.documents.empty", defaultValue: "Открытых запросов для группы нет"),
                        symbol: "tray",
                        hint: String(localized: "starosta.documents.empty.hint", defaultValue: "Когда университет запросит документы у группы, факультета или всего вуза, здесь появится прогресс сдачи")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(requests) { request in
                            NavigationLink(value: AppRoute.starosta(.groupDocumentRequest(id: request.id))) {
                                StarostaProgressCard(request: request)
                            }
                        }
                    } footer: {
                        Text(String(localized: "starosta.documents.subtitle", defaultValue: "Кто из группы уже сдал комплект по запросам университета. Сами документы здесь не видны"))
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { reloadToken += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(StarostaScreen.groupDocuments.title))
    }
}

/// Запрос строкой как чат: кольцо доли принятых, название, вид справа, ниже — срок
/// и счётчики.
private struct StarostaProgressCard: View {
    let request: StarostaGroupProgressDTO

    var body: some View {
        let kind = StarostaText.kind(request.kind)
        let accepted: String = String(localized: "starosta.documents.accepted", defaultValue: "Принято \(request.counts.accepted.formatted()) из \(request.counts.total.formatted())")
        let subtitle: String = StarostaText.due(request) + "\n" + accepted
        TelegramStyleRow(
            title: request.title,
            subtitle: subtitle,
            meta: kind.text,
            metaTint: kind.tint
        ) {
            StarostaShareRing(share: request.acceptedShare, size: 44)
        }
    }
}

/// Доля принятых кольцом: заполнено — все сдали.
private struct StarostaShareRing: View {
    let share: Double
    var size: CGFloat = 44
    var lineWidth: CGFloat = 4
    var showsValue = false

    var body: some View {
        let clamped: Double = min(max(share, 0), 1)
        let label: String = "\(Int((clamped * 100).rounded()))%"
        let iconSize: CGFloat = size * 0.34
        let inset: CGFloat = lineWidth + Spacing.sm
        ZStack {
            Circle().stroke(Palette.success.opacity(0.18), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(Palette.success, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if showsValue {
                Text(verbatim: label)
                    .font(Typography.tabular(.title2.weight(.bold)))
                    .foregroundStyle(Palette.foreground)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .padding(inset)
            } else {
                Image(systemName: "tray.full.fill")
                    .font(.system(size: iconSize, weight: .semibold))
                    .foregroundStyle(Palette.success)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Один запрос: сводка и поимённый список с фильтром по статусу. По личным
/// документам поимённо не показывается — только цифры.
struct StarostaGroupDocumentRequestView: View {
    let requestID: String

    @State private var reloadToken = 0
    @State private var status: String?

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: { try await StarostaAPI().groupProgress() }) { requests in
            if let request = requests.first(where: { $0.id == requestID }) {
                content(request)
            } else {
                EmptyStateView(
                    title: String(localized: "starosta.documents.gone", defaultValue: "Запрос закрыт или больше не касается группы"),
                    symbol: "tray"
                )
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(StarostaScreen.groupDocumentRequest(id: requestID).title))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ request: StarostaGroupProgressDTO) -> some View {
        List {
            Section {
                VStack(spacing: Spacing.md) {
                    StarostaShareRing(share: request.acceptedShare, size: 112, lineWidth: 10, showsValue: true)
                    Text(request.title)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(StarostaText.due(request))
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .multilineTextAlignment(.center)
                    let kind = StarostaText.kind(request.kind)
                    StatusBadge(text: kind.text, tint: kind.tint)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.sm)
                .listRowBackground(Color.clear)
                .accessibilityElement(children: .combine)
            }

            DashboardMetricsSection(metrics: metrics(request))

            if let members = request.members {
                FilterChipsRow(options: filterOptions(members), selection: $status)
                Section {
                    let visible = members
                        .filter { status == nil || $0.status == status }
                        .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
                    if visible.isEmpty {
                        Text(String(localized: "starosta.documents.noMembers", defaultValue: "Никого с таким статусом"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(visible) { member in
                        HStack(spacing: Spacing.md) {
                            PersonRow(name: member.name, size: 36)
                            let badge = StarostaText.status(member.status)
                            StatusBadge(text: badge.text, tint: badge.tint)
                        }
                    }
                }
            } else {
                Section {
                    Label(
                        String(localized: "starosta.documents.personalHint", defaultValue: "В запросе личные документы — поимённо не показывается, только общие цифры"),
                        systemImage: "lock"
                    )
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { reloadToken += 1 }
    }

    private func metrics(_ request: StarostaGroupProgressDTO) -> [DashboardMetric] {
        var items = [
            DashboardMetric(title: StarostaText.status("ACCEPTED").text, value: request.counts.accepted.formatted(), symbol: "checkmark.seal", tint: Palette.success),
            DashboardMetric(title: StarostaText.status("SUBMITTED").text, value: request.counts.submitted.formatted(), symbol: "hourglass", tint: Palette.info),
        ]
        if let needsFix = request.counts.needsFix {
            items.append(DashboardMetric(title: StarostaText.status("NEEDS_FIX").text, value: needsFix.formatted(), symbol: "exclamationmark.triangle", tint: Palette.destructive))
        }
        items.append(DashboardMetric(
            title: String(localized: "starosta.documents.notSubmitted", defaultValue: "Не отправили"),
            value: request.counts.notSubmitted.formatted(),
            symbol: "tray",
            tint: Palette.warning
        ))
        return items
    }

    private func filterOptions(_ members: [StarostaGroupProgressDTO.Member]) -> [(value: String?, title: String)] {
        var options: [(value: String?, title: String)] = [(nil, String(localized: "starosta.group.all", defaultValue: "Все"))]
        for raw in ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "NEEDS_FIX", "ACCEPTED"] {
            let count = members.filter { $0.status == raw }.count
            if count > 0 { options.append((raw, "\(StarostaText.status(raw).text) · \(count.formatted())")) }
        }
        return options
    }
}

/// Подписи разделов старосты.
enum StarostaText {
    static func kind(_ raw: String) -> (text: String, tint: Color) {
        raw == "ACADEMIC"
            ? (String(localized: "starosta.documents.kind.academic", defaultValue: "Учебный"), Palette.info)
            : (String(localized: "starosta.documents.kind.personal", defaultValue: "Личные документы"), Palette.mutedForeground)
    }

    static func status(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "NOT_STARTED": return (String(localized: "starosta.documents.status.notStarted", defaultValue: "Не начат"), Palette.mutedForeground)
        case "IN_PROGRESS": return (String(localized: "starosta.documents.status.inProgress", defaultValue: "Черновик"), Palette.mutedForeground)
        case "SUBMITTED": return (String(localized: "starosta.documents.status.submitted", defaultValue: "На проверке"), Palette.info)
        case "NEEDS_FIX": return (String(localized: "starosta.documents.status.needsFix", defaultValue: "На исправлении"), Palette.destructive)
        case "ACCEPTED": return (String(localized: "starosta.documents.status.accepted", defaultValue: "Принят"), Palette.success)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func due(_ request: StarostaGroupProgressDTO) -> String {
        var text = request.dueAt.map {
            String(localized: "starosta.documents.due", defaultValue: "Срок — до \($0.formatted(.dateTime.day().month(.wide)))")
        } ?? String(localized: "starosta.documents.noDue", defaultValue: "Без срока")
        if !request.acceptsSubmissions {
            text += " · " + String(localized: "starosta.documents.closed", defaultValue: "приём завершён")
        }
        return text
    }

    static func counts(_ counts: StarostaGroupProgressDTO.Counts) -> String {
        var parts = [
            String(localized: "starosta.documents.count.accepted", defaultValue: "Приняты: \(counts.accepted.formatted())"),
            String(localized: "starosta.documents.count.submitted", defaultValue: "На проверке: \(counts.submitted.formatted())"),
        ]
        if let needsFix = counts.needsFix {
            parts.append(String(localized: "starosta.documents.count.needsFix", defaultValue: "На исправлении: \(needsFix.formatted())"))
        }
        parts.append(String(localized: "starosta.documents.count.notSubmitted", defaultValue: "Не отправили: \(counts.notSubmitted.formatted())"))
        return parts.joined(separator: " · ")
    }
}
