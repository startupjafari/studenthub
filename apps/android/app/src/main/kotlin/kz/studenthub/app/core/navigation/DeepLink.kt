package kz.studenthub.app.core.navigation

import java.net.URI
import java.net.URLDecoder

/**
 * Куда ведёт внешняя ссылка: пуш, уведомление или ссылка из веба.
 *
 * Разбираются две формы одного и того же: собственная схема `studenthub://chats?c=…`
 * (её кладёт в пуш сервер) и адрес веба `https://…/chats?c=…`. Пути совпадают с вебом
 * и с iOS (`Core/Navigation/DeepLink.swift`) — держать их в голове в разных версиях
 * незачем.
 */
sealed interface DeepLink {
    data class Tab(val tab: AppTab) : DeepLink

    data class Section(val section: MoreSection) : DeepLink

    data class Chat(val id: String) : DeepLink

    data class Post(val id: String) : DeepLink

    data class Application(val id: String) : DeepLink

    data class Event(val id: String) : DeepLink

    data class Lesson(val id: String) : DeepLink

    /** Чужой профиль: заявка в друзья, комментарий к статье или опросу (`/profile/<id>`). */
    data class Profile(val userId: String) : DeepLink

    /**
     * Уведомления на главной. Сюда ведут ссылки на разделы, которых в приложении нет
     * (`/appointments` — записи в деканат): текст уведомления там и лежит.
     */
    data object Notifications : DeepLink

    /** Каталог библиотеки (`/books`). */
    data object Books : DeepLink

    /** «Мои книги» — сюда ведут уведомления библиотеки (`/my-books`). */
    data object MyBooks : DeepLink

    data class Book(val id: String) : DeepLink

    /** QR-наклейка экземпляра книги: `/c/<код>`. */
    data class BookCopy(val code: String) : DeepLink

    companion object {
        const val SCHEME = "studenthub"

        /** Формат идентификаторов и кодов в ссылках: uuid, cuid, код наклейки книги. */
        private val ID_PATTERN = Regex("^[A-Za-z0-9_-]{1,64}$")

        private fun id(raw: String?): String? = raw?.takeIf(ID_PATTERN::matches)

        /** `null` — «не наше»: такую ссылку открывает браузер, где работает полная версия. */
        fun parse(raw: String): DeepLink? {
            // Пуш кладёт путь веба без адреса (`/chats?c=1`) — это наша же ссылка.
            val text = raw.trim().let { if (it.startsWith("/")) "$SCHEME:$it" else it }
            // `studenthub://` без раздела — корень, то есть главная; java.net.URI такую
            // запись без хоста не принимает вовсе.
            if (text.equals("$SCHEME://", ignoreCase = true)) return Tab(AppTab.HOME)
            val uri = runCatching { URI(text) }.getOrNull() ?: return null
            val scheme = uri.scheme?.lowercase() ?: return null

            var segments = when (scheme) {
                // В `studenthub://chats?c=1` первый сегмент пути — это host.
                SCHEME -> listOfNotNull(uri.host) + uri.path.orEmpty().split('/')
                "https", "http" -> uri.path.orEmpty().split('/')
                else -> return null
            }.filter { it.isNotEmpty() }

            // Ролевой префикс веба (`/teacher/schedule`) на телефоне не значит ничего.
            if (segments.firstOrNull() == "teacher") segments = segments.drop(1)

            val query = uri.rawQuery.orEmpty().split('&')
                .mapNotNull { pair ->
                    val parts = pair.split('=', limit = 2)
                    if (parts.size == 2 && parts[1].isNotEmpty()) {
                        parts[0] to URLDecoder.decode(parts[1], Charsets.UTF_8.name())
                    } else {
                        null
                    }
                }
                .toMap()

            val head = segments.firstOrNull() ?: return Tab(AppTab.HOME)
            // Глубже двух сегментов адресов у нас нет.
            if (segments.size > 2) return null
            // Идентификатор из ссылки уходит в путь запроса API: `..` или `/` в нём увели бы
            // запрос с токеном человека на другой маршрут. Чужой формат — ссылка не наша.
            val tail = segments.getOrNull(1)?.let { id(it) ?: return null }
            val ref = { key: String -> id(query[key]) }

            return when (head) {
                "chats" -> tail?.let(::Chat) ?: ref("c")?.let(::Chat) ?: Tab(AppTab.CHATS)
                "schedule" -> tail?.let(::Lesson) ?: ref("lesson")?.let(::Lesson) ?: Tab(AppTab.SCHEDULE)
                // Учёба — одна вкладка на несколько разделов веба.
                "academic", "grades", "assignments", "attendance", "courses", "materials", "gradebook", "exams" ->
                    if (tail == null) Tab(AppTab.STUDY) else null
                "posts" -> tail?.let(::Post)
                "applications" -> tail?.let(::Application) ?: ref("a")?.let(::Application)
                    ?: Section(MoreSection.APPLICATIONS)
                "events" -> tail?.let(::Event) ?: Section(MoreSection.EVENTS)
                "profile" -> tail?.let(::Profile) ?: Section(MoreSection.PROFILE)
                // Лента живёт на главной.
                "feed" -> if (tail == null) Tab(AppTab.HOME) else null
                "appointments" -> if (tail == null) Notifications else null
                "documents" -> if (tail == null) Section(MoreSection.DOCUMENTS) else null
                "settings" -> if (tail == null) Section(MoreSection.SETTINGS) else null
                "books" -> tail?.let(::Book) ?: Books
                "my-books" -> if (tail == null) MyBooks else null
                "c" -> tail?.let(::BookCopy)
                "starosta" -> when (tail) {
                    "classmates", "group" -> Section(MoreSection.CLASSMATES)
                    else -> null
                }
                // Незнакомый адрес не угадываем: старая сборка не должна «съедать» ссылку
                // на раздел, которого в ней нет.
                else -> null
            }
        }
    }
}
