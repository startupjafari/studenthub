package kz.studenthub.app.core.model

/**
 * Роли платформы (PROJECT.md §2). Источник — реестр в `packages/shared-types`.
 *
 * `UNKNOWN` — для совместимости со старыми сборками: роль на сервере может появиться
 * раньше, чем человек обновит приложение, и неизвестное значение не должно ронять
 * разбор токена.
 */
enum class Role(val raw: String) {
    PLATFORM_ADMIN("PLATFORM_ADMIN"),
    PLATFORM_MODERATOR("PLATFORM_MODERATOR"),
    UNIVERSITY_ADMIN("UNIVERSITY_ADMIN"),
    UNIVERSITY_MODERATOR("UNIVERSITY_MODERATOR"),
    DEAN("DEAN"),
    TEACHER("TEACHER"),
    STAROSTA("STAROSTA"),
    STUDENT("STUDENT"),
    EMPLOYER("EMPLOYER"),
    UNKNOWN(""),
    ;

    /** Роли, ради которых делается приложение (план, «Область и границы»). */
    val isSupportedOnPhone: Boolean get() = this == STUDENT || this == STAROSTA || this == TEACHER

    companion object {
        fun from(raw: String?): Role = entries.firstOrNull { it.raw == raw && it != UNKNOWN } ?: UNKNOWN
    }
}
