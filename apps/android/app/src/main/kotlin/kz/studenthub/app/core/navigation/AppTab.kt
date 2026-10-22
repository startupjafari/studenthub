package kz.studenthub.app.core.navigation

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Assignment
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Bookmarks
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.LocalLibrary
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.ui.graphics.vector.ImageVector
import kz.studenthub.app.R
import kz.studenthub.app.core.model.Role

/**
 * Пять разделов оболочки (план, «Карта экранов»). Состав одинаков у всех трёх ролей —
 * меняется наполнение; так устроены и веб, и iOS.
 */
enum class AppTab(@StringRes val title: Int, val icon: ImageVector) {
    HOME(R.string.tab_home, Icons.Outlined.Home),
    SCHEDULE(R.string.tab_schedule, Icons.Outlined.CalendarMonth),
    CHATS(R.string.tab_chats, Icons.Outlined.Forum),
    STUDY(R.string.tab_study, Icons.Outlined.School),
    MORE(R.string.tab_more, Icons.Outlined.MoreHoriz),
}

/**
 * Разделы вкладки «Ещё». Роль решает состав: у студента пять пунктов, у старосты к ним
 * добавляется его группа, у преподавателя — дисциплины и группы. Список один и для
 * экрана, и для разбора диплинка — иначе ссылка открывала бы раздел, которого у роли нет.
 */
enum class MoreSection(@StringRes val title: Int, val icon: ImageVector) {
    PROFILE(R.string.more_profile, Icons.Outlined.AccountCircle),
    APPLICATIONS(R.string.more_applications, Icons.Outlined.Description),
    EVENTS(R.string.more_events, Icons.Outlined.Event),
    DOCUMENTS(R.string.more_documents, Icons.Outlined.Folder),
    SETTINGS(R.string.more_settings, Icons.Outlined.Settings),

    // Староста.
    CLASSMATES(R.string.more_classmates, Icons.Outlined.Groups),
    GROUP_REQUESTS(R.string.more_groupRequests, Icons.Outlined.Inbox),

    // Преподаватель.
    SUBJECTS(R.string.more_subjects, Icons.AutoMirrored.Outlined.MenuBook),
    GROUPS(R.string.more_groups, Icons.Outlined.Group),

    // Разделы «Учёбы» и «Главной»: в списке «Ещё» их нет, но маршрут им нужен такой же.
    GRADES(R.string.study_grades, Icons.Outlined.School),
    ATTENDANCE(R.string.study_attendance, Icons.Outlined.CheckCircle),
    ASSIGNMENTS(R.string.study_assignments, Icons.AutoMirrored.Outlined.Assignment),
    MATERIALS(R.string.study_materials, Icons.Outlined.Folder),
    NOTIFICATIONS(R.string.home_notifications, Icons.Outlined.Notifications),
    SERVICE_CATALOG(R.string.applications_catalog, Icons.Outlined.GridView),

    // Библиотека вуза: студент и староста, и только если вуз её включил.
    LIBRARY(R.string.library_title, Icons.Outlined.LocalLibrary),
    MY_BOOKS(R.string.library_myBooks, Icons.Outlined.Bookmarks),
    ;

    companion object {
        /** Общие для всех ролей MVP. */
        val common = listOf(PROFILE, APPLICATIONS, EVENTS, DOCUMENTS, SETTINGS)

        fun sections(role: Role): List<MoreSection> = when (role) {
            Role.STUDENT -> common
            Role.STAROSTA -> common + listOf(CLASSMATES, GROUP_REQUESTS)
            Role.TEACHER -> common + listOf(SUBJECTS, GROUPS)
            // Роли вне MVP приложение не ведёт — им остаётся веб.
            else -> emptyList()
        }

        /** Кто берёт книги в библиотеке вуза: читатели — студент и староста. */
        fun readsLibrary(role: Role): Boolean = role == Role.STUDENT || role == Role.STAROSTA

        /**
         * Список «Ещё» с библиотекой. Включает её админ вуза, поэтому пункт зависит не
         * только от роли, но и от ответа `GET /library/settings`: выключенной библиотеки
         * в списке нет. Встаёт перед настройками — они всегда последние.
         */
        fun sections(role: Role, libraryEnabled: Boolean): List<MoreSection> {
            val base = sections(role)
            if (!libraryEnabled || !readsLibrary(role)) return base
            val at = base.indexOf(SETTINGS).takeIf { it >= 0 } ?: base.size
            return base.take(at) + LIBRARY + base.drop(at)
        }
    }
}
