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
                if summary.total == 0 {
                    EmptyStateView(
                        title: String(localized: "student.attendance.empty", defaultValue: "Данных о посещаемости нет"),
                        symbol: "calendar.badge.checkmark",
                        hint: String(localized: "student.attendance.emptyHint", defaultValue: "Отметки появятся после занятий.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        StatGrid {
                            StatTile(
                                title: String(localized: "student.attendance.overall", defaultValue: "Общая посещаемость"),
                                value: "\(summary.rate)%",
                                symbol: "calendar.badge.checkmark",
                                tint: StudentGradeMath.tint(summary.rate)
                            )
                            StatTile(
                                title: String(localized: "student.attendance.lessons", defaultValue: "Занятий"),
                                value: String(summary.total),
                                symbol: "calendar",
                                tint: Palette.mutedForeground
                            )
                            StatTile(title: AttendanceStatus.title("PRESENT"), value: String(summary.present), symbol: "checkmark", tint: Palette.success)
                            StatTile(title: AttendanceStatus.title("LATE"), value: String(summary.late), symbol: "clock", tint: Palette.warning)
                            StatTile(title: AttendanceStatus.title("ABSENT"), value: String(summary.absent), symbol: "xmark", tint: Palette.destructive)
                            StatTile(title: AttendanceStatus.title("EXCUSED"), value: String(summary.excused), symbol: "doc.badge.checkmark", tint: Palette.info)
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }

                    Section {
                        NavigationLink(value: AppRoute.student(.checkin)) {
                            IconRow(title: StudentScreen.checkin.title, symbol: StudentScreen.checkin.symbol, tint: TileTint.green)
                        }
                    }

                    FilterChipsRow(options: Self.filterOptions, selection: $filter)

                    let records = summary.records.filter { filter == nil || $0.status == filter }
                    Section {
                        if records.isEmpty {
                            Text(String(localized: "student.attendance.noRecords", defaultValue: "Нет занятий с такой отметкой"))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
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
            .refreshable { reloadToken += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(StudentScreen.attendance.title))
    }

    private func recordRow(_ record: AttendanceSummaryDTO.Record) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(record.pair?.subject ?? String(localized: "student.attendance.lesson", defaultValue: "Занятие"))
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(3)
                Text(verbatim: [
                    Self.day(record.date),
                    record.pair?.startTime,
                ].compactMap { $0 }.joined(separator: " · "))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                if let note = record.note, !note.isEmpty {
                    Text(note)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(3)
                }
            }
            Spacer(minLength: Spacing.md)
            StatusBadge(text: AttendanceStatus.title(record.status), tint: AttendanceStatus.color(record.status))
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    /// Дата занятия — день вуза, сервер отдаёт её полуночью UTC: показываем по UTC,
    /// иначе к западу от Гринвича занятие уезжало бы на вчера.
    private static func day(_ date: Date) -> String {
        var style = Date.FormatStyle.dateTime.day().month(.abbreviated).year()
        style.timeZone = TimeZone(identifier: "UTC") ?? .current
        return date.formatted(style)
    }
}
