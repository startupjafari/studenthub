import type { ChatAction } from '@studenthub/shared-schemas'

/**
 * Кто что делает в чате прямо сейчас (§9.1): «печатает…», «записывает голосовое…»,
 * «отправляет фото…».
 *
 * Состояние эфемерное и живёт только в памяти вкладки: в БД его нет, в Redux — тоже
 * (в чате состояние держат React Query и локальный `useState`). Сервер шлёт только значение
 * действия, текст собирает интерфейс через i18n.
 *
 * Логика вынесена из `chat-window.tsx` в отдельный модуль не ради красоты: она вся про
 * «когда подпись появляется и когда гаснет», и без тестов на неё легко получить вечное
 * «печатает…» у человека, который давно закрыл вкладку.
 */

/** Действие одного участника и момент последнего подтверждения. */
export interface ChatActor {
  action: ChatAction
  /** Date.now() последнего события. По нему подпись и гаснет. */
  ts: number
}

/** Участники одного чата: userId → действие. */
export type ChatActors = Record<string, ChatActor>

/** Действия по всем чатам: chatId → участники. */
export type ActionsByChat = Record<string, ChatActors>

/**
 * Сколько подпись живёт без подтверждения.
 *
 * Нужно не только на случай потерянного «стоп»: человек мог закрыть вкладку или потерять
 * сеть, и тогда стопа не будет вовсе. В строке списка чатов это заметнее, чем в шапке —
 * туда никто не заходит, чтобы сбросить зависшую подпись.
 */
export const ACTION_TTL_MS = 4000

/**
 * Не чаще этого отправитель повторяет «я всё ещё это делаю».
 *
 * Строго меньше {@link ACTION_TTL_MS}, иначе подпись у получателя будет мигать: гаснуть
 * раньше, чем придёт следующее подтверждение.
 */
export const ACTION_REPEAT_MS = 3000

/** Пауза перед тем, как сообщать о загрузке. Смысл — в {@link uploadActionOf}. */
export const UPLOAD_ACTION_DELAY_MS = 400

/** Записать действие участника; `null` — участник закончил. */
export function applyAction(
  prev: ActionsByChat,
  chatId: string,
  userId: string,
  action: ChatAction | null,
  now: number = Date.now(),
): ActionsByChat {
  const inChat = prev[chatId]

  if (action === null) {
    if (!inChat || !(userId in inChat)) return prev
    const rest = { ...inChat }
    delete rest[userId]
    const next = { ...prev }
    if (Object.keys(rest).length === 0) delete next[chatId]
    else next[chatId] = rest
    return next
  }

  return { ...prev, [chatId]: { ...inChat, [userId]: { action, ts: now } } }
}

/** Убрать подписи, которые давно не подтверждали. Возвращает прежний объект, если убирать нечего. */
export function sweepActions(prev: ActionsByChat, now: number = Date.now()): ActionsByChat {
  const next: ActionsByChat = {}
  let changed = false
  for (const [chatId, actors] of Object.entries(prev)) {
    const alive: ChatActors = {}
    for (const [userId, actor] of Object.entries(actors)) {
      if (now - actor.ts < ACTION_TTL_MS) alive[userId] = actor
    }
    if (Object.keys(alive).length !== Object.keys(actors).length) changed = true
    if (Object.keys(alive).length > 0) next[chatId] = alive
  }
  return changed ? next : prev
}

/** Что показать в одной строке: одинаковое действие у всех или разнобой. */
export type ActorsSummary =
  | { kind: 'single'; action: ChatAction; userId: string }
  | { kind: 'same'; action: ChatAction; count: number; firstUserId: string }
  | { kind: 'mixed'; count: number; firstUserId: string }

/**
 * Свести действия участников к одной подписи.
 *
 * Перечислять «Алия печатает, Данияр отправляет фото» в строку нельзя: и в шапке, и в строке
 * списка чатов места на одну короткую фразу, а обрезка по ширине превратит её в мусор.
 * Поэтому разнобой сворачивается в «кто-то и ещё N…», а одинаковое действие — во множественную
 * форму этого же действия.
 *
 * «Первый» — тот, кто начал раньше: у него подпись успели прочитать, и менять её местами при
 * каждом обновлении чужого таймера незачем.
 */
export function summarizeActors(actors: ChatActors | undefined): ActorsSummary | null {
  const entries = Object.entries(actors ?? {})
  if (entries.length === 0) return null

  const sorted = [...entries].sort((a, b) => a[1].ts - b[1].ts || a[0].localeCompare(b[0]))
  const firstUserId = sorted[0]![0]
  const firstAction = sorted[0]![1].action

  if (sorted.length === 1) return { kind: 'single', action: firstAction, userId: firstUserId }
  if (sorted.every(([, actor]) => actor.action === firstAction)) {
    return { kind: 'same', action: firstAction, count: sorted.length, firstUserId }
  }
  return { kind: 'mixed', count: sorted.length, firstUserId }
}

/**
 * Какое действие сообщать при отправке вложений.
 *
 * Альбом обычно однородный, поэтому смотрим на набор целиком: только снимки — «фото», только
 * ролики — «видео». Смесь снимков с роликами — тоже «фото»: это медиа-альбом, и слово «файл»
 * для него читается неверно. Всё остальное — «файл».
 *
 * Голосовое возвращает `null`. Отправлять после «записывает голосовое…» ещё и «отправляет
 * файл…» — значит показать два разных действия на одно понятное человеку («он делает
 * голосовое»). Запись длится секунды, загрузка опуса занимает доли секунды, и пауза между
 * ними незаметна.
 */
export function uploadActionOf(files: { type: string; name: string }[]): ChatAction | null {
  if (files.length === 0) return null
  if (files.some((f) => /^voice-/i.test(f.name))) return null

  const images = files.filter((f) => f.type.startsWith('image/')).length
  const videos = files.filter((f) => f.type.startsWith('video/')).length
  if (images + videos !== files.length) return 'UPLOADING_FILE'
  return videos === files.length ? 'UPLOADING_VIDEO' : 'UPLOADING_PHOTO'
}
