import SwiftUI

/// Каталог библиотеки вуза: поиск, наличие на полке, переход к брони.
///
/// Экран для студента и старосты — тот же каталог, что в вебе в режиме читателя.
/// Пагинация серверная: следующая страница подтягивается, когда человек докрутил
/// до конца списка.
struct LibraryCatalogView: View {
    @State private var model = LibraryCatalogModel()

    var body: some View {
        List {
            if model.isDisabled {
                LibraryDisabledView()
            } else {
                if let failure = model.failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                Section {
                    NavigationLink(value: AppRoute.myBooks) {
                        Label(
                            String(localized: "library.tabMine", defaultValue: "Мои книги"),
                            systemImage: "books.vertical"
                        )
                        .font(Typography.body)
                    }
                }
                .listRowBackground(Palette.card)

                Section {
                    Picker(selection: $model.query.section) {
                        Text(String(localized: "library.allSections", defaultValue: "Все разделы"))
                            .tag(String?.none)
                        ForEach(model.sections, id: \.self) { section in
                            Text(section).tag(String?.some(section))
                        }
                    } label: {
                        Text(String(localized: "library.section", defaultValue: "Раздел"))
                    }
                    Toggle(
                        String(localized: "library.onlyAvailable", defaultValue: "Есть на полке"),
                        isOn: $model.query.onlyAvailable
                    )
                }
                .font(Typography.body)
                .listRowBackground(Palette.card)

                Section {
                    ForEach(model.books) { book in
                        NavigationLink(value: AppRoute.book(id: book.id)) {
                            BookRow(book: book)
                        }
                        .onAppear {
                            if book.id == model.books.last?.id {
                                Task { await model.loadMore() }
                            }
                        }
                    }

                    if model.isLoading, !model.books.isEmpty {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .listRowBackground(Color.clear)
                    }

                    if model.books.isEmpty, !model.isLoading, model.loadedQuery != nil {
                        if model.query.isFiltered {
                            EmptyRow(text: String(localized: "library.nothingFound", defaultValue: "Ничего не найдено"))
                        } else {
                            EmptyRow(text: String(
                                localized: "library.emptyCatalog",
                                defaultValue: "Библиотека ещё заполняет каталог — загляните позже."
                            ))
                        }
                    }
                }
                .listRowBackground(Palette.card)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "library.title", defaultValue: "Библиотека")))
        .searchable(
            text: $model.query.text,
            prompt: Text(String(localized: "library.searchPlaceholder", defaultValue: "Название, автор или ISBN"))
        )
        .autocorrectionDisabled()
        .refreshable { await model.refresh() }
        .task(id: model.query) {
            // Возврат с карточки книги не перезагружает список: подгруженные страницы
            // и прокрутка остаются на месте. Свежее — по жесту обновления.
            guard model.loadedQuery != model.query else { return }
            // Поиск печатают по букве: ждём паузу, чтобы не слать запрос на каждую.
            // Первая загрузка экрана ждать не должна.
            if model.loadedQuery != nil {
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
            }
            await model.refresh()
        }
    }
}

/// Строка каталога: обложка, название, авторы и год, наличие.
private struct BookRow: View {
    let book: BookCardDTO

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            BookCoverView(url: book.coverUrl)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(book.title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                if !book.byline.isEmpty {
                    Text(book.byline)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1)
                }
                ShelfBadge(availability: book.availability)
            }
        }
        .padding(.vertical, Spacing.xs)
    }
}
