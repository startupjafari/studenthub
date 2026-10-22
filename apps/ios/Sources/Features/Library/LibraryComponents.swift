import SwiftUI

/// Обложка книги или заглушка с иконкой — в пропорциях книги (2:3), как в вебе.
struct BookCoverView: View {
    let url: String?
    var width: CGFloat = 40

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: Radius.md).fill(Palette.muted)
            if let raw = url, let link = URL(string: raw) {
                AsyncImage(url: link) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    placeholder
                }
            } else {
                placeholder
            }
        }
        .frame(width: width, height: width * 1.5)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        Image(systemName: "book.closed")
            .font(.system(size: width * 0.4))
            .foregroundStyle(Palette.mutedForeground)
    }
}

/// Плашка состояния: наличие, срок, бронь. Цвет несёт смысл, поэтому тонов ровно
/// столько, сколько смыслов: хорошо, внимание, плохо, сведения, нейтрально.
struct LibraryBadge: View {
    enum Tone {
        case success, warning, destructive, info, neutral

        var color: Color {
            switch self {
            case .success: return Palette.success
            case .warning: return Palette.warning
            case .destructive: return Palette.destructive
            case .info: return Palette.primary
            case .neutral: return Palette.mutedForeground
            }
        }
    }

    let text: String
    let tone: Tone

    var body: some View {
        Text(text)
            .font(Typography.meta)
            .lineLimit(1)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.xs)
            .background(tone == .neutral ? Palette.muted : tone.color.opacity(0.12), in: Capsule())
            .foregroundStyle(tone.color)
    }
}

/// Наличие на полке. В каталоге «все выданы» — предупреждение, на карточке книги —
/// спокойное «все экземпляры на руках»: там рядом уже есть кнопка очереди.
struct ShelfBadge: View {
    let availability: BookAvailabilityDTO
    var inCard = false

    var body: some View {
        switch ShelfState(availability) {
        case .available(let available, let total):
            LibraryBadge(
                text: LibraryText.fill(
                    String(localized: "library.availableOf", defaultValue: "На полке {available} из {total}"),
                    ["available": String(available), "total": String(total)]
                ),
                tone: .success
            )
        case .allOut:
            if inCard {
                LibraryBadge(
                    text: String(localized: "library.allTaken", defaultValue: "Все экземпляры на руках"),
                    tone: .neutral
                )
            } else {
                LibraryBadge(text: String(localized: "library.allOut", defaultValue: "Все выданы"), tone: .warning)
            }
        case .noCopies:
            LibraryBadge(text: String(localized: "library.noCopies", defaultValue: "Нет экземпляров"), tone: .neutral)
        }
    }
}

/// Срок выдачи: «до 5 нояб.», просрочено — красным, закрытые — статусом.
struct LoanDueBadge: View {
    let loan: LoanDTO

    var body: some View {
        switch loan.status {
        case .returned:
            LibraryBadge(text: String(localized: "library.statusReturned", defaultValue: "Возвращена"), tone: .neutral)
        case .lost:
            LibraryBadge(text: String(localized: "library.statusLost", defaultValue: "Утеряна"), tone: .destructive)
        case .cancelled:
            LibraryBadge(text: String(localized: "library.statusCancelled", defaultValue: "Отменена"), tone: .neutral)
        case .open, .unknown:
            if loan.overdue {
                LibraryBadge(
                    text: LibraryText.fill(
                        String(localized: "library.overdueSince", defaultValue: "просрочено с {date}"),
                        ["date": LibraryDay.short(loan.dueDate)]
                    ),
                    tone: .destructive
                )
            } else {
                LibraryBadge(
                    text: LibraryText.fill(
                        String(localized: "library.dueUntil", defaultValue: "до {date}"),
                        ["date": LibraryDay.short(loan.dueDate)]
                    ),
                    tone: .info
                )
            }
        }
    }
}

/// Бронь: готова до такого-то дня, место в очереди или чем закончилась.
struct ReservationBadge: View {
    let reservation: ReservationDTO

    var body: some View {
        switch reservation.status {
        case .ready:
            if let holdDate = reservation.holdDate {
                LibraryBadge(
                    text: LibraryText.fill(
                        String(localized: "library.resReadyUntil", defaultValue: "Готова до {date}"),
                        ["date": LibraryDay.short(holdDate)]
                    ),
                    tone: .success
                )
            } else {
                LibraryBadge(text: String(localized: "library.resReady", defaultValue: "Готова"), tone: .success)
            }
        case .queued:
            if let position = reservation.position {
                LibraryBadge(
                    text: LibraryText.fill(
                        String(localized: "library.resQueuePosition", defaultValue: "В очереди: {position}-я"),
                        ["position": String(position)]
                    ),
                    tone: .info
                )
            } else {
                LibraryBadge(text: String(localized: "library.resQueued", defaultValue: "В очереди"), tone: .info)
            }
        case .fulfilled:
            LibraryBadge(text: String(localized: "library.resFulfilled", defaultValue: "Выдана"), tone: .neutral)
        case .expired:
            LibraryBadge(text: String(localized: "library.resExpired", defaultValue: "Истекла"), tone: .neutral)
        case .cancelled, .unknown:
            LibraryBadge(text: String(localized: "library.resCancelled", defaultValue: "Отменена"), tone: .neutral)
        }
    }
}

/// Библиотека вуза выключена: объяснение вместо пустого экрана.
struct LibraryDisabledView: View {
    var body: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "books.vertical")
                .font(.system(size: 40))
                .foregroundStyle(Palette.mutedForeground)
                .accessibilityHidden(true)
            Text(String(localized: "library.disabledTitle", defaultValue: "Библиотека выключена"))
                .font(Typography.sectionTitle)
                .foregroundStyle(Palette.foreground)
            Text(String(
                localized: "library.disabledDescription",
                defaultValue: "Каталог появится, когда администратор вуза включит библиотеку."
            ))
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.xxl)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }
}

/// Сообщение об удавшемся действии: «Бронь отменена», «Вы в очереди».
struct LibraryNotice: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "checkmark.circle.fill")
            .font(Typography.meta)
            .foregroundStyle(Palette.success)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}
