package kz.studenthub.app.core

import kz.studenthub.app.core.model.Role
import kz.studenthub.app.core.navigation.AppRoute
import kz.studenthub.app.core.navigation.AppRouter
import kz.studenthub.app.core.navigation.AppTab
import kz.studenthub.app.core.navigation.DeepLink
import kz.studenthub.app.core.navigation.MoreSection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeepLinkTest {
    /** Форма из пуша: своя схема, идентификатор в запросе. */
    @Test
    fun appSchemeOpensChat() = assertEquals(DeepLink.Chat("chat-42"), DeepLink.parse("studenthub://chats?c=chat-42"))

    /** Форма из переписки: адрес веба, нажатый на телефоне. */
    @Test
    fun webLinkOpensSameChat() = assertEquals(DeepLink.Chat("chat-42"), DeepLink.parse("https://studenthub.kz/chats?c=chat-42"))

    /** Сервер кладёт в пуш путь без адреса — это тоже наша ссылка. */
    @Test
    fun relativePathFromPushIsOurs() = assertEquals(DeepLink.Chat("chat-42"), DeepLink.parse("/chats?c=chat-42"))

    @Test
    fun bareSectionsOpenTabs() {
        assertEquals(DeepLink.Tab(AppTab.HOME), DeepLink.parse("studenthub://"))
        assertEquals(DeepLink.Tab(AppTab.HOME), DeepLink.parse("https://studenthub.kz/"))
        assertEquals(DeepLink.Tab(AppTab.CHATS), DeepLink.parse("https://studenthub.kz/chats"))
        assertEquals(DeepLink.Tab(AppTab.SCHEDULE), DeepLink.parse("https://studenthub.kz/schedule"))
    }

    /** Учёба в вебе — несколько разделов, на телефоне — одна вкладка. */
    @Test
    fun studyRoutesCollapseIntoOneTab() {
        for (path in listOf("grades", "assignments", "attendance", "courses", "academic")) {
            assertEquals("не сошлось на /$path", DeepLink.Tab(AppTab.STUDY), DeepLink.parse("https://studenthub.kz/$path"))
        }
    }

    @Test
    fun rolePrefixIsIgnored() {
        assertEquals(DeepLink.Tab(AppTab.SCHEDULE), DeepLink.parse("https://studenthub.kz/teacher/schedule"))
        assertEquals(DeepLink.Tab(AppTab.CHATS), DeepLink.parse("https://studenthub.kz/teacher/chats"))
    }

    @Test
    fun starostaSectionsAreRecognised() {
        assertEquals(DeepLink.Section(MoreSection.CLASSMATES), DeepLink.parse("https://studenthub.kz/starosta/classmates"))
        assertEquals(DeepLink.Section(MoreSection.GROUP_REQUESTS), DeepLink.parse("https://studenthub.kz/starosta/group-requests"))
    }

    @Test
    fun applicationAndEventCards() {
        assertEquals(DeepLink.Application("app-1"), DeepLink.parse("studenthub://applications?a=app-1"))
        assertEquals(DeepLink.Event("event-1"), DeepLink.parse("https://studenthub.kz/events/event-1"))
        assertEquals(DeepLink.Post("post-1"), DeepLink.parse("https://studenthub.kz/posts/post-1"))
    }

    /** Незнакомый адрес не угадываем: его откроет браузер, где работает полная версия. */
    @Test
    fun unknownRoutesAreNotOurs() {
        listOf(
            "https://studenthub.kz/platform-admin/users",
            "https://studenthub.kz/career/vacancies",
            "https://studenthub.kz/qr?t=3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
            "mailto:support@studenthub.kz",
        ).forEach { assertNull("перехвачен чужой адрес: $it", DeepLink.parse(it)) }
    }
}

class AppRouterTest {
    /** Под карточкой заявки остаётся список: «назад» из пуша ведёт к заявкам. */
    @Test
    fun applicationKeepsListBeneathIt() {
        val router = AppRouter()
        assertTrue(router.open(DeepLink.Application("app-1"), Role.STUDENT))
        assertEquals(AppTab.MORE, router.selectedTab)
        assertEquals(listOf(AppRoute.Section(MoreSection.APPLICATIONS), AppRoute.Application("app-1")), router.stack(AppTab.MORE))
    }

    /** У каждой вкладки свой стек: уход в расписание оставляет открытый чат на месте. */
    @Test
    fun tabsKeepTheirOwnStacks() {
        val router = AppRouter()
        router.open(DeepLink.Chat("chat-1"), Role.STUDENT)
        router.switchTo(AppTab.SCHEDULE)
        assertEquals(AppTab.SCHEDULE, router.selectedTab)
        assertEquals(listOf(AppRoute.Chat("chat-1")), router.stack(AppTab.CHATS))
    }

    /** Повторное нажатие на текущую вкладку возвращает её к корню. */
    @Test
    fun tappingCurrentTabReturnsItToRoot() {
        val router = AppRouter()
        router.open(DeepLink.Chat("chat-1"), Role.STUDENT)
        router.switchTo(AppTab.CHATS)
        assertEquals(emptyList<AppRoute>(), router.stack(AppTab.CHATS))
    }

    @Test
    fun backWalksTheStackThenGivesUp() {
        val router = AppRouter()
        router.push(AppRoute.Section(MoreSection.PROFILE))
        assertTrue(router.pop())
        assertFalse(router.pop())
    }

    /** Ссылка в чужой раздел не открывает пустой экран: у студента нет обращений группы. */
    @Test
    fun sectionForeignToTheRoleIsRefused() {
        val router = AppRouter()
        assertFalse(router.open(DeepLink.Section(MoreSection.GROUP_REQUESTS), Role.STUDENT))
        assertTrue(router.open(DeepLink.Section(MoreSection.GROUP_REQUESTS), Role.STAROSTA))
    }
}

class MoreSectionTest {
    @Test
    fun studentSeesCommonSectionsOnly() = assertEquals(MoreSection.common, MoreSection.sections(Role.STUDENT))

    @Test
    fun starostaAndTeacherAddTheirOwn() {
        assertTrue(MoreSection.CLASSMATES in MoreSection.sections(Role.STAROSTA))
        assertTrue(MoreSection.SUBJECTS in MoreSection.sections(Role.TEACHER))
        assertFalse(MoreSection.CLASSMATES in MoreSection.sections(Role.TEACHER))
    }

    /** Роли вне MVP приложение не ведёт — список для них пуст, а не «как у всех». */
    @Test
    fun rolesOutsideMvpGetNothing() {
        assertTrue(MoreSection.sections(Role.DEAN).isEmpty())
        assertTrue(MoreSection.sections(Role.PLATFORM_ADMIN).isEmpty())
    }
}
