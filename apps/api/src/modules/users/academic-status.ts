/**
 * Статусы, с которыми студент больше не учится в вузе. `academicStatus` — свободная строка
 * в двух представлениях: веб пишет русские значения справочника (`ACADEMIC_STATUS_DICT`), а
 * сид, импорт и контракт API — коды (`EXPELLED`, `GRADUATED`, `TRANSFERRED`). Распознаём оба,
 * без регистра и с обоими написаниями «переведён». Тот же набор закрывает вход на посту
 * охраны и выдачу книг в библиотеке.
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
