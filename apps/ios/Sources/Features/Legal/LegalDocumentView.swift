import SwiftUI

/// Юридический документ — нативный экран, а не страница веба.
///
/// Разделы раскрываются по одному (`DisclosureGroup`): документ длинный, а нужен обычно
/// один раздел — «кто видит мои данные», «что с моим контентом». Текст целиком, без
/// сокращений, выделяется и копируется. Стекла в тексте нет: это слой для чтения.
/// Шапка — как у карточек приложения: значок документа, название и дата редакции по центру.
struct LegalDocumentView<Route: Hashable>: View {
    let document: LegalDocument
    /// Ссылка на второй документ: внутри приложения — маршрутом оболочки, до входа —
    /// маршрутом экранов входа. Каждый стек знает только свои маршруты.
    let route: (LegalDocument) -> Route

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded: Set<Int> = []

    var body: some View {
        List {
            HeroHeader(
                visual: .symbol(document.symbol, tint: TileTint.blue),
                title: document.title,
                subtitle: LegalDocument.updated
            )

            Section {
                Text(document.intro)
                    .font(.body)
                    .foregroundStyle(Palette.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .padding(.vertical, Spacing.xs)
            }

            Section {
                ForEach(document.sections) { section in
                    DisclosureGroup(isExpanded: binding(for: section.id)) {
                        Text(section.body)
                            .font(.body)
                            .foregroundStyle(Palette.foreground)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                            .padding(.vertical, Spacing.sm)
                    } label: {
                        Text(section.heading)
                            .font(.headline)
                            .foregroundStyle(Palette.foreground)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.vertical, Spacing.xs)
                    }
                    .accessibilityIdentifier("legal.section.\(section.id)")
                }
            }

            Section {
                NavigationLink(value: route(document.other)) {
                    IconRow(title: document.other.title, symbol: document.other.symbol, tint: TileTint.gray)
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .navigationTitle(Text(verbatim: "StudentHub"))
        .softTopEdge()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    toggleAll()
                } label: {
                    Image(systemName: allExpanded
                        ? "arrow.down.right.and.arrow.up.left"
                        : "arrow.up.left.and.arrow.down.right")
                }
                .accessibilityLabel(Text(allExpanded
                    ? String(localized: "legal.collapseAll", defaultValue: "Свернуть все разделы")
                    : String(localized: "legal.expandAll", defaultValue: "Развернуть все разделы")))
            }
        }
    }

    private var allExpanded: Bool {
        expanded.count == document.sections.count
    }

    private func binding(for id: Int) -> Binding<Bool> {
        Binding(
            get: { expanded.contains(id) },
            set: { isOpen in
                withAnimation(Motion.respecting(.snappy, reduceMotion: reduceMotion)) {
                    if isOpen { expanded.insert(id) } else { expanded.remove(id) }
                }
            }
        )
    }

    private func toggleAll() {
        withAnimation(Motion.respecting(.snappy, reduceMotion: reduceMotion)) {
            expanded = allExpanded ? [] : Set(document.sections.map(\.id))
        }
    }
}

extension LegalDocumentView where Route == AuthRoute {
    /// До входа: стек экранов входа.
    init(document: LegalDocument) {
        self.init(document: document, route: { AuthRoute.legal($0) })
    }
}

extension LegalDocumentView where Route == AppRoute {
    /// Внутри приложения: стек вкладки.
    init(inApp document: LegalDocument) {
        self.init(document: document, route: { AppRoute.legal($0) })
    }
}
