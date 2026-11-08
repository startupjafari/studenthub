import SwiftUI

/// Справка «задолженностей в библиотеке нет» — для обходного листа при выпуске или переводе.
///
/// То же, что `/my-books/clearance` в вебе: статус на момент запроса, а при долгах — список
/// того, что вернуть, вместо справки. Печать — в вебе; здесь справку показывают с экрана.
struct LibraryClearanceView: View {
    @State private var model = LibraryClearanceModel()

    var body: some View {
        List {
            if let summary = model.summary {
                statusSection(summary)
                if !summary.isClear {
                    debtsSection(summary)
                }
                detailsSection(summary)
            } else if let failure = model.failure, !model.isLoading {
                ErrorStateView(message: failure) { await model.refresh() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .navigationTitle(Text(String(localized: "library.clearance", defaultValue: "Справка из библиотеки")))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
    }

    // MARK: - Секции

    /// Итог крупно, как шапка карточки: зелёная печать — справку можно показывать,
    /// красный треугольник — сначала вернуть долги.
    private func statusSection(_ summary: ClearanceSummary) -> some View {
        Section {
            if summary.isClear {
                HeroHeader(
                    visual: .symbol("checkmark.seal.fill", tint: Palette.success),
                    title: String(localized: "library.clearTitle", defaultValue: "Задолженностей нет"),
                    subtitle: LibraryText.fill(
                        String(
                            localized: "library.clearBody",
                            defaultValue: "За {name} нет книг на руках на {date}."
                        ),
                        ["name": summary.reader.name, "date": Self.checked(summary.checkedAt)]
                    )
                )
            } else {
                HeroHeader(
                    visual: .symbol("exclamationmark.triangle.fill", tint: Palette.destructive),
                    title: LibraryText.fill(
                        String(
                            localized: "library.notClearTitle",
                            defaultValue: "Долгов перед библиотекой: {count}. Верните книги, чтобы получить справку."
                        ),
                        ["count": String(summary.debts.count)]
                    ),
                    subtitle: summary.reader.name
                )
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
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
    }

    private func debtsSection(_ summary: ClearanceSummary) -> some View {
        Section {
            ForEach(summary.debts) { loan in
                NavigationLink(value: AppRoute.book(id: loan.book.id)) {
                    HStack(alignment: .center, spacing: Spacing.lg) {
                        BookCoverView(url: loan.book.coverUrl, width: 44)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(loan.book.title)
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Palette.foreground)
                                .lineLimit(2)
                            Text(LibraryText.fill(
                                String(localized: "library.inventoryNumber", defaultValue: "инв. {number}"),
                                ["number": loan.copy.inventoryNumber]
                            ))
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                            ClearanceDebtBadge(loan: loan)
                                .padding(.top, 2)
                        }
                    }
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .combine)
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
    }

    private func detailsSection(_ summary: ClearanceSummary) -> some View {
        Section {
            detailRow(String(localized: "library.clearanceName", defaultValue: "ФИО"), summary.reader.name, symbol: "person")
            detailRow(String(localized: "library.clearanceGroup", defaultValue: "Группа"), summary.reader.group, symbol: "person.3")
            detailRow(String(localized: "library.clearanceFaculty", defaultValue: "Факультет"), summary.reader.faculty, symbol: "building.columns")
            detailRow(
                String(localized: "library.clearanceCard", defaultValue: "№ студенческого"),
                summary.reader.studentCardNumber,
                symbol: "person.text.rectangle"
            )
            detailRow(String(localized: "library.clearanceUniversity", defaultValue: "Вуз"), summary.university, symbol: "graduationcap")
            detailRow(
                String(localized: "library.clearanceChecked", defaultValue: "Проверено"),
                Self.checked(summary.checkedAt),
                symbol: "clock"
            )
        } header: {
            Text(String(localized: "library.clearanceDetails", defaultValue: "Сведения"))
        }
    }

    /// Строка сведений; пустое поле (нет группы, не указан билет) не рисуется вовсе.
    @ViewBuilder
    private func detailRow(_ label: String, _ value: String?, symbol: String) -> some View {
        if let value, !value.trimmingCharacters(in: .whitespaces).isEmpty {
            DetailRow(title: label, value: value, symbol: symbol)
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
