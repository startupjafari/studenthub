import type { ErrorDetail } from '@studenthub/shared-types'

// Подпись конфликта по полю из `details[]` — ключи Schedule.conflict*.
const FIELD_KEY: Record<string, string> = {
  roomId: 'conflictRoom',
  newRoomId: 'conflictRoom',
  teacherId: 'conflictTeacher',
  newTeacherId: 'conflictTeacher',
  groupId: 'conflictGroup',
  date: 'conflictCancelled',
}

/**
 * Описание конфликта расписания для тоста. Подробности (с какой парой и во сколько
 * столкнулись) сервер пишет по-русски — их показываем в русском интерфейсе; в kk/en —
 * перевод по полю конфликта (FRONTEND_RULES §10): раньше там стоял русский текст сервера.
 */
export function conflictDescription(
  details: ErrorDetail[] | undefined,
  locale: string,
  t: (key: string) => string,
): string {
  const list = details ?? []
  if (list.length === 0) return t('conflictGeneric')
  if (locale === 'ru') return list.map((d) => d.message).join('; ')
  const phrases = list.map((d) => t(FIELD_KEY[d.field] ?? 'conflictGeneric'))
  return [...new Set(phrases)].join('; ')
}
