package kz.studenthub.app.support

import kz.studenthub.app.core.session.RefreshCookieStore
import java.util.Base64

/** Действует до 2100 года — чтобы тест не начал падать однажды утром. Роль — преподаватель. */
const val LONG_LIVED_TOKEN =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWZ1dHVyZSIsInJvbGUiOiJURUFDSEVSIiwidW5pdmVyc2l0eUlkIjoidS05IiwiZmFjdWx0eUlkIjpudWxsLCJncm91cElkIjpudWxsLCJ0ZmEiOnRydWUsImV4cCI6NDEwMjQ0NDgwMH0.signature"

/** Токен с произвольным payload — для проверки ролей и сроков. */
fun tokenWith(payloadJson: String): String =
    "header.${Base64.getUrlEncoder().withoutPadding().encodeToString(payloadJson.toByteArray())}.signature"

/** Банка cookie процесса в тестах не нужна: подставляем значение в памяти. */
class MemoryCookies(private var stored: String? = null) : RefreshCookieStore {
    @Synchronized override fun value(): String? = stored

    @Synchronized override fun restore(value: String) {
        stored = value
    }

    @Synchronized override fun clear() {
        stored = null
    }
}
