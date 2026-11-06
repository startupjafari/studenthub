package kz.studenthub.app.core.storage

/**
 * Тип чата (PROJECT.md §3.6). Значения те же, что в `ChatType` на сервере. `UNKNOWN` —
 * не перестраховка: новый тип появится на сервере раньше, чем человек обновит
 * приложение, и такой чат просто покажется без особого оформления.
 */
enum class ChatKind(val raw: String) {
    PRIVATE("PRIVATE"),
    GROUP("GROUP"),
    GROUP_OFFICIAL("GROUP_OFFICIAL"),
    SUBJECT("SUBJECT"),
    FACULTY("FACULTY"),
    DEAN("DEAN"),
    SUPPORT("SUPPORT"),
    SUPPORT_PLATFORM("SUPPORT_PLATFORM"),
    EVENT("EVENT"),
    SAVED("SAVED"),
    UNKNOWN(""),
    ;

    /** Официальные чаты заводит система: названия и состава в них не меняют. */
    val isOfficial: Boolean
        get() = this in setOf(GROUP_OFFICIAL, SUBJECT, FACULTY, DEAN, SUPPORT, SUPPORT_PLATFORM, EVENT)

    companion object {
        fun from(raw: String): ChatKind = entries.firstOrNull { it.raw == raw && it != UNKNOWN } ?: UNKNOWN
    }
}
