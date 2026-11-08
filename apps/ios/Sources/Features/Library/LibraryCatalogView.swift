import SwiftUI

/// Каталог библиотеки вуза: поиск, наличие на полке, переход к брони.
///
/// Экран для студента и старосты — тот же каталог, что в вебе в режиме читателя.
/// Пагинация серверная: следующая страница подтягивается, когда человек докрутил
/// до конца списка. Подача — как список чатов: поиск всегда виден, разделы — капсулами
/// под ним, «только на полке» — в меню фильтра панели.
struct LibraryCatalogView: View {
    @State private var model = LibraryCatalogModel()

    var body: some View {
        List {
            if model.isDisabled {
                LibraryDisabledView()
            } else {
                if !model.sections.isEmpty {
                    FilterChipsRow(options: sectionOptions, selection: $model.query.section)
                }

                if model.query.text.isEmpty {
                    Section {
                        NavigationLink(value: AppRoute.myBooks) {
                            IconRow(
                                title: String(localized: "library.tabMine", defaultValue: "Мои книги"),
                                symbol: "books.vertical.fill",
                                tint: TileTint.yellow
                            )
                        }
                    }
                }

                if let failure = model.failure, !model.books.isEmpty {
                    StaleDataBanner(message: failure) { await model.refresh() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }

                books
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(String(localized: "library.title", defaultValue: "Библиотека")))
        .searchable(
            text: $model.query.text,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text(String(localized: "library.searchPlaceholder", defaultValue: "Название, автор или ISBN"))
        )
        .autocorrectionDisabled()
        .toolbar {
            if !model.isDisabled {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Toggle(isOn: $model.query.onlyAvailable) {
                            Label(
                                String(localized: "library.onlyAvailable", defaultValue: "Есть на полке"),
                                systemImage: "checkmark.circle"
                            )
                        }
                    } label: {
                        Image(systemName: model.query.onlyAvailable
                            ? "line.3.horizontal.decrease.circle.fill"
                            : "line.3.horizontal.decrease.circle")
                    }
                    .accessibilityLabel(Text(String(localized: "library.filter", defaultValue: "Фильтр")))
                }
            }
        }
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

    private var sectionOptions: [(value: String?, title: String)] {
        var options: [(value: String?, title: String)] = [
            (value: nil, title: String(localized: "library.allSections", defaultValue: "Все разделы")),
        ]
        options += model.sections.map { (value: String?.some($0), title: $0) }
        return options
    }

    @ViewBuilder
    private var books: some View {
        if model.books.isEmpty {
            if model.loadedQuery == nil {
                if let failure = model.failure, !model.isLoading {
                    ErrorStateView(message: failure) { await model.refresh() }
                        .listRowBackground(Color.clear)
                } else {
                    LoadingStateView().listRowBackground(Color.clear)
                }
            } else if model.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            } else if model.query.isFiltered {
                EmptyStateView(
                    title: String(localized: "library.nothingFound", defaultValue: "Ничего не найдено"),
                    symbol: "magnifyingglass",
                    hint: String(localized: "services.notFound.hint", defaultValue: "Попробуйте другое слово")
                )
                .listRowBackground(Color.clear)
            } else {
                EmptyStateView(
                    title: String(localized: "library.emptyCatalog", defaultValue: "Библиотека ещё заполняет каталог — загляните позже."),
                    symbol: "books.vertical"
                )
                .listRowBackground(Color.clear)
            }
        } else {
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
                if model.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                }
            } footer: {
                if model.total > 0 {
                    Text(String(localized: "common.totalCount", defaultValue: "Всего: \(model.total.formatted())"))
                }
            }
        }
    }
}

/// Строка каталога: обложка, название, авторы и год, наличие.
private struct BookRow: View {
    let book: BookCardDTO

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.lg) {
            BookCoverView(url: book.coverUrl, width: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(book.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                if !book.byline.isEmpty {
                    Text(book.byline)
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1)
                }
                ShelfBadge(availability: book.availability)
                    .padding(.top, 2)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
