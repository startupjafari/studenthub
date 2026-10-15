package kz.studenthub.app.features.chats

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import kz.studenthub.app.R
import kz.studenthub.app.core.storage.ChatKind

/**
 * Заголовок чата — как `chatTitle` в вебе. Официальные чаты сервер создаёт без названия:
 * у чата предмета за него говорит предмет (он уже подставлен в `title` запросом списка),
 * у остальных — сам тип. «Сохранённые» подписываются всегда, их название не задаётся.
 */
@Composable
fun chatTitle(kind: ChatKind, title: String?): String {
    if (kind == ChatKind.SAVED) return stringResource(R.string.chats_saved)
    if (!title.isNullOrBlank()) return title
    val label = when (kind) {
        ChatKind.GROUP_OFFICIAL -> R.string.chats_typeGroupOfficial
        ChatKind.FACULTY -> R.string.chats_typeFaculty
        ChatKind.DEAN -> R.string.chats_typeDean
        ChatKind.SUPPORT -> R.string.chats_typeSupport
        ChatKind.SUPPORT_PLATFORM -> R.string.chats_typeSupportPlatform
        ChatKind.SUBJECT -> R.string.chats_typeSubject
        else -> R.string.chats_untitled
    }
    return stringResource(label)
}
