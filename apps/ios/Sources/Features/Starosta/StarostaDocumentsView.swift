import SwiftUI

/// Сбор документов группы: кто из группы уже сдал комплект по запросам университета.
/// Староста видит статусы, чтобы напомнить, — самих документов здесь нет.
struct StarostaGroupDocumentsView: View {
    @State private var reloadToken = 0

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: { try await StarostaAPI().groupProgress() }) { requests in
            List {
                Section {
                    Text(String(localized: "starosta.documents.subtitle", defaultValue: "Кто из группы уже сдал комплект по запросам университета. Сами документы здесь не видны"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                .listRowBackground(Color.clear)

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

/// Карточка запроса: название, срок, вид, доля принятых и счётчики.
private struct StarostaProgressCard: View {
    let request: StarostaGroupProgressDTO

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text(request.title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(3)
                Spacer(minLength: Spacing.md)
                let kind = StarostaText.kind(request.kind)
                StatusBadge(text: kind.text, tint: kind.tint)
            }
            Text(StarostaText.due(request))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            ShareBar(
                title: String(localized: "starosta.documents.accepted", defaultValue: "Принято \(request.counts.accepted.formatted()) из \(request.counts.total.formatted())"),
                fraction: request.acceptedShare,
                tint: Palette.success
            )
            Text(StarostaText.counts(request.counts))
                .font(Typography.meta.monospacedDigit())
                .foregroundStyle(Palette.mutedForeground)
        }
        .padding(.vertical, Spacing.xs)
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
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text(request.title)
                        .font(Typography.sectionTitle)
                        .foregroundStyle(Palette.foreground)
                    Text(StarostaText.due(request))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                    ShareBar(
                        title: String(localized: "starosta.documents.accepted", defaultValue: "Принято \(request.counts.accepted.formatted()) из \(request.counts.total.formatted())"),
                        fraction: request.acceptedShare,
                        tint: Palette.success
                    )
                }
                .padding(.vertical, Spacing.xs)
            }

            Section {
                StatGrid {
                    StatTile(
                        title: StarostaText.status("ACCEPTED").text,
                        value: request.counts.accepted.formatted(),
                        symbol: "checkmark.seal",
                        tint: Palette.success
                    )
                    StatTile(
                        title: StarostaText.status("SUBMITTED").text,
                        value: request.counts.submitted.formatted(),
                        symbol: "hourglass",
                        tint: Palette.info
                    )
                    if let needsFix = request.counts.needsFix {
                        StatTile(
                            title: StarostaText.status("NEEDS_FIX").text,
                            value: needsFix.formatted(),
                            symbol: "exclamationmark.triangle",
                            tint: Palette.destructive
                        )
                    }
                    StatTile(
                        title: String(localized: "starosta.documents.notSubmitted", defaultValue: "Не отправили"),
                        value: request.counts.notSubmitted.formatted(),
                        symbol: "tray",
                        tint: Palette.warning
                    )
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

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
                        HStack {
                            Text(member.name).font(Typography.body).foregroundStyle(Palette.foreground)
                            Spacer(minLength: Spacing.md)
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
