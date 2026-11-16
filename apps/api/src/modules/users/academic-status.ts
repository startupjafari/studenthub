import { ACADEMIC_STATUSES, isLeftAcademicStatus } from '@studenthub/shared-types'

/**
 * Закрытый справочник учебных статусов — общий с вебом (`ACADEMIC_STATUS_DICT`), живёт в
 * `@studenthub/shared-types` (`AcademicStatus`). Свободный ввод пропускал «Отчислена» и
 * «отчислен(а)», и такой студент не считался ушедшим: не ставилась дата ухода, от которой
 * считаются сроки хранения ПДн (PERSONAL_DATA §4).
 */
export { ACADEMIC_STATUSES }

/**
 * Статус из справочника в его написании: без учёта регистра и пробелов по краям, «переведен»
 * через «е» — тоже. Пустая строка — очистка поля, проходит как есть. Значение не из
 * справочника — `null`. Коды сида (`EXPELLED` и т. п.) на входе не принимаются: в форме их нет.
 */
export function canonicalAcademicStatus(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace('переведен', 'переведён')
  if (key === '') return ''
  return ACADEMIC_STATUSES.find((s) => s.toLowerCase() === key) ?? null
}

/**
 * Студент больше не учится в вузе: отчислен, выпущен или переведён (`LEFT_ACADEMIC_STATUS_CODES`
 * в shared-types; академический отпуск сюда не входит). Записи, внесённые до закрытого
 * справочника, могут отличаться регистром, а сид и импорт пишут коды (`EXPELLED`,
 * `GRADUATED`, `TRANSFERRED`), поэтому распознаются оба представления. Тот же набор закрывает
 * вход на посту охраны, выдачу и бронь книг в библиотеке и снимает брони читателя.
 */
export function isTerminalAcademicStatus(status: string | null | undefined): boolean {
  return isLeftAcademicStatus(status)
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
