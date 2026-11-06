import SwiftUI

/// Справка «задолженностей в библиотеке нет» — для обходного листа при выпуске или переводе.
///
/// То же, что `/my-books/clearance` в вебе: статус на момент запроса, а при долгах — список
/// того, что вернуть, вместо справки. Печать — в вебе; здесь справку показывают с экрана.
struct LibraryClearanceView: View {
    @State private var model = LibraryClearanceModel()

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let summary = model.summary {
                statusSection(summary)
                if !summary.isClear {
                    debtsSection(summary)
                }
                detailsSection(summary)
            } else if model.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "library.clearance", defaultValue: "Справка из библиотеки")))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
    }

    // MARK: - Секции

    private func statusSection(_ summary: ClearanceSummary) -> some View {
        Section {
            if summary.isClear {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(Palette.success)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(String(localized: "library.clearTitle", defaultValue: "Задолженностей нет"))
                            .font(Typography.cardTitle)
                            .foregroundStyle(Palette.foreground)
                        Text(LibraryText.fill(
                            String(
                                localized: "library.clearBody",
                                defaultValue: "За {name} нет книг на руках на {date}."
                            ),
                            ["name": summary.reader.name, "date": Self.checked(summary.checkedAt)]
                        ))
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                    }
                }
                .padding(.vertical, Spacing.xs)
                .accessibilityElement(children: .combine)
            } else {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(Palette.destructive)
                        .accessibilityHidden(true)
                    Text(LibraryText.fill(
                        String(
                            localized: "library.notClearTitle",
                            defaultValue: "Долгов перед библиотекой: {count}. Верните книги, чтобы получить справку."
                        ),
                        ["count": String(summary.debts.count)]
                    ))
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                }
                .padding(.vertical, Spacing.xs)
                .accessibilityElement(children: .combine)
            }
        } footer: {
            Text(summary.isClear
                ? String(
                    localized: "library.clearanceShowHint",
                    defaultValue: """
                        Покажите этот экран в библиотеке или деканате. \
                        Распечатать справку можно в веб-версии.
                        """
                )
                : String(
                    localized: "library.clearanceSubtitle",
                    defaultValue: "Для обходного листа при выпуске или переводе"
                ))
        }
        .listRowBackground(summary.isClear ? Palette.success.opacity(0.1) : Palette.destructive.opacity(0.08))
    }

    private func debtsSection(_ summary: ClearanceSummary) -> some View {
        Section {
            ForEach(summary.debts) { loan in
                NavigationLink(value: AppRoute.book(id: loan.book.id)) {
                    HStack(alignment: .top, spacing: Spacing.lg) {
                        BookCoverView(url: loan.book.coverUrl, width: 32)
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(loan.book.title)
                                .font(Typography.cardTitle)
                                .foregroundStyle(Palette.foreground)
                                .lineLimit(2)
                            Text(LibraryText.fill(
                                String(localized: "library.inventoryNumber", defaultValue: "инв. {number}"),
                                ["number": loan.copy.inventoryNumber]
                            ))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                            ClearanceDebtBadge(loan: loan)
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                }
            }
        } header: {
            Text(String(localized: "library.debtsTitle", defaultValue: "Что вернуть"))
        } footer: {
            if summary.lostDebts > 0 {
                Text(String(
                    localized: "library.lostHint",
                    defaultValue: """
                        Утерянную книгу замените или возместите её стоимость в библиотеке — \
                        библиотекарь отметит, что долг погашен.
                        """
                ))
            }
        }
        .listRowBackground(Palette.card)
    }

    private func detailsSection(_ summary: ClearanceSummary) -> some View {
        Section {
            detailRow(String(localized: "library.clearanceName", defaultValue: "ФИО"), summary.reader.name)
            detailRow(String(localized: "library.clearanceGroup", defaultValue: "Группа"), summary.reader.group)
            detailRow(String(localized: "library.clearanceFaculty", defaultValue: "Факультет"), summary.reader.faculty)
            detailRow(
                String(localized: "library.clearanceCard", defaultValue: "№ студенческого"),
                summary.reader.studentCardNumber
            )
            detailRow(String(localized: "library.clearanceUniversity", defaultValue: "Вуз"), summary.university)
            detailRow(
                String(localized: "library.clearanceChecked", defaultValue: "Проверено"),
                Self.checked(summary.checkedAt)
            )
        } header: {
            Text(String(localized: "library.clearanceDetails", defaultValue: "Сведения"))
        }
        .listRowBackground(Palette.card)
    }

    /// Строка сведений; пустое поле (нет группы, не указан билет) не рисуется вовсе.
    @ViewBuilder
    private func detailRow(_ label: String, _ value: String?) -> some View {
        if let value, !value.trimmingCharacters(in: .whitespaces).isEmpty {
            LabeledContent {
                Text(value)
                    .foregroundStyle(Palette.foreground)
                    .multilineTextAlignment(.trailing)
            } label: {
                Text(label)
                    .foregroundStyle(Palette.mutedForeground)
            }
            .font(Typography.body)
        }
    }

    /// «23 октября 2026 г., 14:05» — момент проверки, как в вебе.
    private static func checked(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.wide).year().hour().minute())
    }
}

/// Долг в справке: книга на руках — срок (просрочка красным), утерянная — «Утеряна — долг».
private struct ClearanceDebtBadge: View {
    let loan: LoanDTO

    var body: some View {
        if loan.status == .lost {
            LibraryBadge(
                text: String(localized: "library.statusLostDebt", defaultValue: "Утеряна — долг"),
                tone: .destructive
            )
        } else {
            LoanDueBadge(loan: loan)
        }
    }
}
