/**
 * Закрытый справочник учебных статусов — тот же, что в вебе (`ACADEMIC_STATUS_DICT`).
 * Свободный ввод пропускал «Отчислена» и «отчислен(а)», и такой студент не считался ушедшим:
 * не ставилась дата ухода, от которой считаются сроки хранения ПДн (PERSONAL_DATA §4).
 */
export const ACADEMIC_STATUSES = [
  'Обучающийся',
  'Академический отпуск',
  'Выпускник',
  'Отчислен',
  'Переведён',
] as const

/**
 * Статус из справочника в его написании: без учёта регистра и пробелов по краям, «переведен»
 * через «е» — тоже. Пустая строка — очистка поля, проходит как есть. Значение не из
 * справочника — `null`.
 */
export function canonicalAcademicStatus(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace('переведен', 'переведён')
  if (key === '') return ''
  return ACADEMIC_STATUSES.find((s) => s.toLowerCase() === key) ?? null
}

/**
 * Статусы, с которыми студент больше не учится в вузе. Записи, внесённые до закрытого
 * справочника, могут отличаться регистром, а сид и импорт пишут коды (`EXPELLED`,
 * `GRADUATED`, `TRANSFERRED`), поэтому распознаём оба представления, без регистра и с обоими
 * написаниями «переведён». Тот же набор закрывает вход на посту охраны и выдачу книг в
 * библиотеке.
 */
const TERMINAL_ACADEMIC_STATUSES = [
  'отчислен',
  'выпускник',
  'переведён',
  'переведен',
  'expelled',
  'graduated',
  'transferred',
]

export function isTerminalAcademicStatus(status: string | null | undefined): boolean {
  if (!status) return false
  return TERMINAL_ACADEMIC_STATUSES.includes(status.trim().toLowerCase())
}

/**
 * Новое значение `User.leftUniversityAt` при смене учебного статуса. От этой даты считаются
 * сроки хранения ПДн ушедшего студента (docs/PERSONAL_DATA.md §4).
 *
 * - статус не меняется (поля нет в запросе) — дата не трогается (`undefined`);
 * - ушёл — первая дата ухода сохраняется: «Отчислен» → «Переведён» не продлевает срок, а
 *   повторное сохранение того же статуса не сдвигает его вперёд;
 * - вернулся к учёбе (восстановление, ошибка оператора) — дата обнуляется, и уборка его
 *   больше не видит.
 */
export function nextLeftUniversityAt(
  status: string | null | undefined,
  current: Date | null,
  now: Date = new Date(),
): Date | null | undefined {
  if (status === undefined) return undefined
  if (!isTerminalAcademicStatus(status)) return null
  return current ?? now
}
