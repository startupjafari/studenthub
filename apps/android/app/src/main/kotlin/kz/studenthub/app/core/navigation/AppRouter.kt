package kz.studenthub.app.core.navigation

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kz.studenthub.app.core.model.Role

/** Шаг внутри вкладки. */
sealed interface AppRoute {
    data class Section(val section: MoreSection) : AppRoute

    data class Chat(val id: String) : AppRoute

    data class Post(val id: String) : AppRoute

    data class Application(val id: String) : AppRoute

    data class Event(val id: String) : AppRoute

    data class Lesson(val id: String) : AppRoute

    data class Assignment(val id: String) : AppRoute

    data class Service(val id: String) : AppRoute

    /** Книга библиотеки — из каталога, из «Моих книг» или из уведомления. */
    data class Book(val id: String) : AppRoute

    /** Экземпляр по коду с QR-наклейки: экран сам узнаёт книгу и показывает её. */
    data class BookCopy(val code: String) : AppRoute

    /** Чужой профиль: из ленты, из чата, из списка группы. */
    data class Profile(val userId: String) : AppRoute
}

/**
 * Навигация оболочки: выбранная вкладка и путь внутри каждой.
 *
 * У каждой вкладки свой стек, а не один общий: человек уходит из чата в расписание и
 * возвращается ровно в тот чат, а не к списку. Так устроен iOS-клиент, и на Android
 * это поведение нижней навигации Material тоже (сохранение стека вкладки).
 *
 * Состояние — снапшоты Compose: экран перерисовывается сам, а в тестах роутер
 * читается как обычный объект.
 */
class AppRouter {
    var selectedTab by mutableStateOf(AppTab.HOME)
        private set

    private val stacks = mutableStateMapOf<AppTab, List<AppRoute>>()

    fun stack(tab: AppTab): List<AppRoute> = stacks[tab].orEmpty()

    /** Открыть ссылку. `false` — «не наше»: ссылку открывает браузер. */
    fun open(url: String, role: Role): Boolean {
        val link = DeepLink.parse(url) ?: return false
        return open(link, role)
    }

    fun open(link: DeepLink, role: Role): Boolean {
        when (link) {
            is DeepLink.Tab -> select(link.tab)
            is DeepLink.Section -> {
                // Ссылка на чужой раздел не должна открывать пустой экран.
                if (link.section !in MoreSection.sections(role)) return false
                replace(AppTab.MORE, listOf(AppRoute.Section(link.section)))
            }
            is DeepLink.Chat -> replace(AppTab.CHATS, listOf(AppRoute.Chat(link.id)))
            is DeepLink.Post -> replace(AppTab.HOME, listOf(AppRoute.Post(link.id)))
            is DeepLink.Lesson -> replace(AppTab.SCHEDULE, listOf(AppRoute.Lesson(link.id)))
            // Под карточкой оставляем список: «назад» из заявки, открытой пушем, ведёт к
            // заявкам, а не выбрасывает на главную.
            is DeepLink.Application -> replace(
                AppTab.MORE,
                listOf(AppRoute.Section(MoreSection.APPLICATIONS), AppRoute.Application(link.id)),
            )
            is DeepLink.Event -> replace(
                AppTab.MORE,
                listOf(AppRoute.Section(MoreSection.EVENTS), AppRoute.Event(link.id)),
            )
            DeepLink.Books -> return openLibrary(role, null)
            DeepLink.MyBooks -> return openLibrary(role, AppRoute.Section(MoreSection.MY_BOOKS))
            is DeepLink.Book -> return openLibrary(role, AppRoute.Book(link.id))
            is DeepLink.BookCopy -> return openLibrary(role, AppRoute.BookCopy(link.code))
        }
        return true
    }

    /**
     * Библиотека — только читателям: студенту и старосте. Под книгой и «Моими книгами»
     * остаётся каталог, чтобы «назад» из уведомления вело в раздел, а не на главную.
     * Включена ли библиотека в вузе, здесь не известно — это скажет экран (`409 module`).
     */
    private fun openLibrary(role: Role, top: AppRoute?): Boolean {
        if (!MoreSection.readsLibrary(role)) return false
        replace(AppTab.MORE, listOfNotNull(AppRoute.Section(MoreSection.LIBRARY), top))
        return true
    }

    /** Выбрать вкладку и вернуть её к корню — поведение повторного нажатия на вкладку. */
    fun select(tab: AppTab) {
        selectedTab = tab
        stacks[tab] = emptyList()
    }

    /** Перейти на вкладку, сохранив её стек: обычное нажатие на соседнюю вкладку. */
    fun switchTo(tab: AppTab) {
        if (tab == selectedTab) select(tab) else selectedTab = tab
    }

    fun push(route: AppRoute) {
        stacks[selectedTab] = stack(selectedTab) + route
    }

    /** Шаг назад внутри вкладки. `false` — стек пуст, «назад» уходит системе. */
    fun pop(): Boolean {
        val current = stack(selectedTab)
        if (current.isEmpty()) return false
        stacks[selectedTab] = current.dropLast(1)
        return true
    }

    /** Сессия кончилась: следующему человеку — чистая оболочка. */
    fun reset() {
        stacks.clear()
        selectedTab = AppTab.HOME
    }

    private fun replace(tab: AppTab, routes: List<AppRoute>) {
        selectedTab = tab
        stacks[tab] = routes
    }
}
