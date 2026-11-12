import { CHAT_CHECKLIST_LIMITS } from '@studenthub/shared-schemas'
import type { MessageChecklist } from '../model/types'

/**
 * Права на чек-лист в сообщении — те же, что проверяет сервер (`ChatChecklistsService`).
 * Автор списка — отправитель сообщения (`mine`). UI-скрытие не защита: сервер проверяет сам.
 */

/** Отмечать пункты: автор всегда, остальные — если автор разрешил. */
export function canMarkChecklist(checklist: MessageChecklist, mine: boolean): boolean {
  return mine || checklist.othersCanMark
}

/** Добавлять пункты: автор всегда, остальные — при `othersCanAdd`; не больше 50 пунктов. */
export function canAddChecklistItem(checklist: MessageChecklist, mine: boolean): boolean {
  if (checklist.items.length >= CHAT_CHECKLIST_LIMITS.ITEMS_MAX) return false
  return mine || checklist.othersCanAdd
}

/**
 * Убирать пункт: сервер пускает автора списка и того, кто пункт добавил. Кто добавил пункт,
 * в DTO чек-листа нет (`createdById` сервер не отдаёт) — поэтому кнопку видит только автор
 * списка; добавивший чужой пункт убрать его с веба пока не может.
 */
export function canRemoveChecklistItem(mine: boolean): boolean {
  return mine
}
