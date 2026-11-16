import SwiftUI
import XCTest

@testable import StudentHub

/// Снимки общих компонентов (`DesignSystem`): из них собраны почти все экраны, так что
/// сдвиг или пропажа элемента здесь видна раньше, чем на каждом экране по отдельности.
///
/// Данные — фиксированные строки; ни сети, ни дат «сейчас».
final class DesignSystemSnapshotTests: SnapshotTestCase {
    /// Каждое состояние — на своём экране, как в приложении. Втроём на одном экране при
    /// крупном шрифте они не помещаются, и `ContentUnavailableView` сжимается: пропадает
    /// значок, обрезается текст — снимок ловил бы дефект теста, а не вида.
    func testEmptyState() {
        let view = EmptyStateView(
            title: "Пока пусто", symbol: "tray",
            hint: "Здесь появятся ваши заявки", actionTitle: "Создать", action: {})
            .padding()
        assertSnapshots(of: view, named: "state-empty")
    }

    func testErrorState() {
        assertSnapshots(of: ErrorStateView(message: "Не удалось загрузить расписание").padding(), named: "state-error")
    }

    func testOfflineState() {
        assertSnapshots(of: ErrorStateView(message: "Нет соединения", isOffline: true).padding(), named: "state-offline")
    }

    func testRows() {
        let view = List {
            Section {
                IconRow(title: "Расписание", symbol: "calendar", subtitle: "Сегодня 4 пары", value: "2")
                SettingsRow(title: "Уведомления", symbol: "bell", showsChevron: true)
                SettingsRow(title: "Язык", symbol: "globe", value: "Русский", showsChevron: true)
                SettingsRow(title: "Выйти", symbol: "rectangle.portrait.and.arrow.right", isDestructive: true)
            }
            Section {
                DetailRow(title: "Группа", value: "ИС-21", symbol: "person.3")
                PersonRow(name: "Айгерим Сапарова", subtitle: "Староста", trailing: "09:41")
                ListCardRow(
                    title: "Справка с места учёбы", subtitle: "№ 1024",
                    status: (text: "Готово", tint: Palette.success), lines: ["Выдана 12 ноября"])
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        assertSnapshots(of: view, named: "rows")
    }

    /// Плитки — в `StatGrid`, как на экранах: при крупном шрифте сетка сама уходит в одну
    /// колонку. Снимок — во весь экран: в полосе фиксированной высоты крупный шрифт
    /// сжимал бы плитки, и снимок ловил бы тесноту теста, а не вид.
    func testStatTiles() {
        let view = VStack(spacing: 12) {
            StatGrid {
                StatTile(title: "Средний балл", value: "3.62", symbol: "chart.bar", caption: "за семестр")
                StatTile(title: "Пропуски", value: "4", symbol: "clock", tint: Palette.warning)
            }
            ShareBar(title: "Посещаемость", fraction: 0.82, valueText: "82 %")
        }
        .padding()
        .frame(maxHeight: .infinity, alignment: .top)
        assertSnapshots(of: view, named: "stat-tiles")
    }

    func testButtons() {
        let view = VStack(spacing: 16) {
            Button("Войти") {}.buttonStyle(PrimaryButtonStyle())
            Button("Отмена") {}.buttonStyle(QuietButtonStyle())
            Button {} label: {
                Label("Карточка", systemImage: "doc.text")
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Palette.card, in: RoundedRectangle(cornerRadius: 16))
            }
            .buttonStyle(.pressable)
        }
        .padding()
        .background(Palette.background)
        assertSnapshots(of: view, named: "buttons", height: 300)
    }

    func testFilterChips() {
        let view = FilterChipsHost()
            .padding(.vertical)
            .background(Palette.background)
        // Полоса фильтров — на стекле: блик по её краю плавает между запусками.
        assertSnapshots(of: view, named: "filter-chips", height: 120, tolerance: .glass)
    }

    func testHeroHeader() {
        let view = ScrollView {
            HeroHeader(
                visual: .avatar(url: nil, name: "Айгерим Сапарова"),
                title: "Айгерим Сапарова", subtitle: "Студентка · ИС-21",
                actions: [
                    HeroAction(title: "Написать", symbol: "message", action: {}),
                    HeroAction(title: "Звонок", symbol: "phone", action: {}),
                ])
        }
        .background(Palette.background)
        assertSnapshots(of: view, named: "hero-header", height: 420)
    }
}

/// `FilterChips` хочет `Binding` — держим выбор в своём состоянии.
private struct FilterChipsHost: View {
    @State private var selection: String? = "all"

    var body: some View {
        FilterChips(
            options: [("all", "Все"), ("unread", "Непрочитанные"), ("groups", "Группы"), ("channels", "Каналы")],
            selection: $selection)
    }
}
