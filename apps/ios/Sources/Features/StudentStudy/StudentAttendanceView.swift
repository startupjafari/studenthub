import SwiftUI

/// «Моя посещаемость» (веб `/attendance`): общий процент и разбивка по отметкам
/// плитками, последние занятия — дата, время, дисциплина, отметка, примечание.
struct StudentAttendanceView: View {
    @State private var reloadToken = 0
    @State private var filter: String?

    private static let filterOptions: [(value: String?, title: String)] = {
        var options: [(value: String?, title: String)] = [(nil, String(localized: "student.filter.all", defaultValue: "Все"))]
        for status in ["PRESENT", "LATE", "ABSENT", "EXCUSED"] {
            options.append((status, AttendanceStatus.title(status)))
        }
        return options
    }()

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: { try await StudyAPI().attendance() }) { summary in
            List {
                if summary.total != 0 {
                    Section {
                        StudentAttendanceRing(summary: summary)
                    }
                    DashboardMetricsSection(metrics: [
                        DashboardMetric(title: AttendanceStatus.title("PRESENT"), value: summary.present.formatted(), symbol: "checkmark", tint: Palette.success),
                        DashboardMetric(title: AttendanceStatus.title("LATE"), value: summary.late.formatted(), symbol: "clock", tint: Palette.warning),
                        DashboardMetric(title: AttendanceStatus.title("ABSENT"), value: summary.absent.formatted(), symbol: "xmark", tint: Palette.destructive),
                        DashboardMetric(title: AttendanceStatus.title("EXCUSED"), value: summary.excused.formatted(), symbol: "doc.badge.checkmark", tint: Palette.info),
                    ])

                    Section {
                        NavigationLink(value: AppRoute.student(.checkin)) {
                            IconRow(title: StudentScreen.checkin.title, symbol: StudentScreen.checkin.symbol, tint: TileTint.green)
                        }
                    }

                    FilterChipsRow(options: Self.filterOptions, selection: $filter)

                    let records = summary.records.filter { filter == nil || $0.status == filter }
                    Section {
                        if records.isEmpty {
                            EmptyStateView(
                                title: String(localized: "student.attendance.noRecords", defaultValue: "Нет занятий с такой отметкой"),
                                symbol: "line.3.horizontal.decrease.circle"
                            )
                            .listRowBackground(Color.clear)
                        }
                        ForEach(records) { record in
                            recordRow(record)
                        }
                    } header: {
                        Text(String(localized: "student.attendance.recent", defaultValue: "Последние занятия"))
                    }
                }
            }
            .listStyle(.insetGrouped)
            .screenState(summary.total == 0) {
                EmptyStateView(
                    title: String(localized: "student.attendance.empty", defaultValue: "Данных о посещаемости нет"),
                    symbol: "calendar.badge.checkmark",
                    hint: String(localized: "student.attendance.emptyHint", defaultValue: "Отметки появятся после занятий.")
                )
            }
            .pullToRefresh { reloadToken += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(StudentScreen.attendance.title))
    }

    /// Занятие строкой как чат: значок отметки её цвета, дисциплина, дата справа,
    /// ниже — время и примечание, плашка отметки.
    private func recordRow(_ record: AttendanceSummaryDTO.Record) -> some View {
        TelegramStyleRow(
            title: record.pair?.subject ?? String(localized: "student.attendance.lesson", defaultValue: "Занятие"),
            subtitle: StudyText.join([record.pair?.startTime, record.note]),
            meta: Self.day(record.date)
        ) {
            RowSymbol(symbol: AttendanceStatus.symbol(record.status), tint: AttendanceStatus.color(record.status), size: 40)
        } accessory: {
            StatusBadge(text: AttendanceStatus.title(record.status), tint: AttendanceStatus.color(record.status))
        }
    }

    /// Дата занятия — день вуза, сервер отдаёт её полуночью UTC: показываем по UTC,
    /// иначе к западу от Гринвича занятие уезжало бы на вчера.
    private static func day(_ date: Date) -> String {
        var style = Date.FormatStyle.dateTime.day().month(.abbreviated).year()
        style.timeZone = TimeZone(identifier: "UTC") ?? .current
        return date.formatted(style)
    }
}

/// Общий процент кольцом, как в «Активности»: с первого взгляда видно, хватает ли.
private struct StudentAttendanceRing: View {
    let summary: AttendanceSummaryDTO

    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 96

    var body: some View {
        let tint: Color = StudentGradeMath.tint(summary.rate)
        let fraction: CGFloat = CGFloat(min(max(summary.rate, 0), 100)) / 100
        let side: CGFloat = min(size, 140)
        HStack(spacing: Spacing.xl) {
            ZStack {
                Circle().stroke(tint.opacity(0.18), lineWidth: 10)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(tint, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text(verbatim: "\(summary.rate)%")
                    .font(Typography.tabular(.title2.weight(.bold)))
                    .foregroundStyle(Palette.foreground)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .padding(Spacing.md)
            }
            .frame(width: side, height: side)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(String(localized: "student.attendance.overall", defaultValue: "Общая посещаемость"))
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
                Text(String(localized: "student.attendance.lessonsCount", defaultValue: "Занятий: \(summary.total.formatted())"))
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Spacing.sm)
        .accessibilityElement(children: .combine)
    }
}
