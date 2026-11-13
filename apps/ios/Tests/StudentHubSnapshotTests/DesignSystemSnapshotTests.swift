import SwiftUI
import XCTest

@testable import StudentHub

/// Снимки общих компонентов (`DesignSystem`): из них собраны почти все экраны, так что
/// сдвиг или пропажа элемента здесь видна раньше, чем на каждом экране по отдельности.
///
/// Данные — фиксированные строки; ни сети, ни дат «сейчас».
final class DesignSystemSnapshotTests: SnapshotTestCase {
    func testStateViews() {
        let view = VStack(spacing: 32) {
            EmptyStateView(
                title: "Пока пусто", symbol: "tray",
                hint: "Здесь появятся ваши заявки", actionTitle: "Создать", action: {})
            ErrorStateView(message: "Не удалось загрузить расписание")
            ErrorStateView(message: "Нет соединения", isOffline: true)
        }
        .padding()
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Palette.background)
        assertSnapshots(of: view, named: "states")
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

    func testStatTiles() {
        let view = VStack(spacing: 12) {
            HStack(spacing: 12) {
                StatTile(title: "Средний балл", value: "3.62", symbol: "chart.bar", caption: "за семестр")
                StatTile(title: "Пропуски", value: "4", symbol: "clock", tint: Palette.warning)
            }
            ShareBar(title: "Посещаемость", fraction: 0.82, valueText: "82 %")
        }
        .padding()
        .background(Palette.background)
        assertSnapshots(of: view, named: "stat-tiles", height: 280)
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
        assertSnapshots(of: view, named: "filter-chips", height: 120)
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
