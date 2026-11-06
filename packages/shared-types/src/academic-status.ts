// Учебный статус студента — единый источник для api и веба (docs/PROJECT.md §3, «Учебные
// данные ведёт вуз»; §3.11–3.12). Из него берут значения справочник формы учебных данных
// (`ACADEMIC_STATUS_DICT` в вебе), проверка выдачи книг и входа на пост охраны
// (`isTerminalAcademicStatus` в api). Переименование статуса здесь меняет все места разом:
// раньше справочник веба и список блокирующих статусов в api правились порознь, и опечатка
// в одном открыла бы выдачу отчисленному.
//
// Значение — написание в базе и в форме. Ключ — код, которым статус хранили сид и импорт до
// закрытого справочника: такие записи в базе остались, и распознавать нужно оба вида.

export const AcademicStatus = {
  ACTIVE: 'Обучающийся',
  ACADEMIC_LEAVE: 'Академический отпуск',
  GRADUATED: 'Выпускник',
  EXPELLED: 'Отчислен',
  TRANSFERRED: 'Переведён',
} as const

export type AcademicStatusCode = keyof typeof AcademicStatus
export type AcademicStatus = (typeof AcademicStatus)[AcademicStatusCode]

/** Справочник в порядке показа в форме. */
export const ACADEMIC_STATUSES: readonly AcademicStatus[] = Object.values(AcademicStatus)

/**
 * Студент числится в вузе: выдача книг, брони и вход на пост ему открыты. Академический
 * отпуск — здесь намеренно: студент из вуза не ушёл и вернётся к учёбе.
 */
export const STUDYING_ACADEMIC_STATUS_CODES = [
  'ACTIVE',
  'ACADEMIC_LEAVE',
] as const satisfies readonly AcademicStatusCode[]

/**
 * Студент ушёл из вуза: книги не выдаются, брони снимаются, на пост не пускают, от даты
 * перехода считаются сроки хранения ПДн (docs/PERSONAL_DATA.md §4).
 */
export const LEFT_ACADEMIC_STATUS_CODES = [
  'GRADUATED',
  'EXPELLED',
  'TRANSFERRED',
] as const satisfies readonly AcademicStatusCode[]

export type LeftAcademicStatusCode = (typeof LEFT_ACADEMIC_STATUS_CODES)[number]

// Страж сборки: статус, не попавший ни в один из списков, не соберёт пакет. Попадание сразу
// в оба проверяет тест (apps/api/src/modules/users/academic-status.spec.ts).
type Unclassified = Exclude<
  AcademicStatusCode,
  (typeof STUDYING_ACADEMIC_STATUS_CODES)[number] | LeftAcademicStatusCode
>
const everyStatusClassified: [Unclassified] extends [never] ? true : never = true
void everyStatusClassified

/** Статусы, закрывающие выдачу книг (и вход на пост охраны), — в написании справочника. */
export const BLOCKED_ACADEMIC_STATUSES: readonly AcademicStatus[] = LEFT_ACADEMIC_STATUS_CODES.map(
  (code) => AcademicStatus[code],
)

/** Статусы, которые выдачу не закрывают, — в написании справочника. */
export const NON_BLOCKING_ACADEMIC_STATUSES: readonly AcademicStatus[] =
  STUDYING_ACADEMIC_STATUS_CODES.map((code) => AcademicStatus[code])

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace('переведен', 'переведён')
}

const CODE_BY_KEY = new Map<string, AcademicStatusCode>(
  (Object.keys(AcademicStatus) as AcademicStatusCode[]).flatMap((code) => [
    [normalize(AcademicStatus[code]), code],
    [code.toLowerCase(), code],
  ]),
)

/**
 * Код статуса по сохранённому значению: написание справочника или код сида и импорта, без
 * учёта регистра и пробелов по краям, «переведен» через «е» — тоже. Пусто или не из
 * справочника — `null`.
 */
export function academicStatusCode(raw: string | null | undefined): AcademicStatusCode | null {
  if (!raw) return null
  return CODE_BY_KEY.get(normalize(raw)) ?? null
}

/** Ушёл ли студент из вуза: отчислен, выпущен или переведён (в любом из двух видов записи). */
export function isLeftAcademicStatus(raw: string | null | undefined): boolean {
  return leftAcademicStatusCode(raw) !== null
}

/** Код ушедшего студента или `null`, если он учится (или статус не заполнен). */
export function leftAcademicStatusCode(
  raw: string | null | undefined,
): LeftAcademicStatusCode | null {
  const code = academicStatusCode(raw)
  return LEFT_ACADEMIC_STATUS_CODES.find((c) => c === code) ?? null
}
