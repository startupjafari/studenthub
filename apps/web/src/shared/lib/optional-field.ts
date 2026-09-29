/**
 * Регистрация необязательного текстового поля в react-hook-form.
 *
 * Незаполненный `<input>` отдаёт пустую строку, а схемы объявляют такие поля как
 * `z.string().min(1).optional()` или `z.string().email().optional()` — и `''` их не
 * проходит: `.optional()` разрешает отсутствие значения, но не пустую строку.
 * Форма молча оставалась невалидной, и кнопка отправки выглядела нерабочей.
 *
 * Использование: `{...form.register('shortName', OPTIONAL_TEXT)}`.
 */
export const OPTIONAL_TEXT = {
  setValueAs: (v: unknown): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s === '' ? undefined : s
  },
}

/**
 * То же для необязательного ЧИСЛА.
 *
 * Отдельная константа нужна, потому что у числа поломка хуже, чем у строки: схемы
 * объявляют такие поля как `z.coerce.number().min(1).optional()`, а `z.coerce` превращает
 * пустую строку не в `undefined`, а в **ноль** — и поле, которое человек не трогал,
 * отклоняется с «должно быть не меньше 1». Незаполненная необязательная графа делала
 * форму неотправляемой, а сообщение об этом показывалось у поля, которое заполнять и
 * не требовалось.
 *
 * Использование: `{...form.register('studentsEstimate', OPTIONAL_NUMBER)}`.
 */
export const OPTIONAL_NUMBER = {
  setValueAs: (v: unknown): number | undefined => {
    const s = typeof v === 'string' ? v.trim() : v
    if (s === '' || s === undefined || s === null) return undefined
    const n = Number(s)
    // NaN отдаём как есть: пусть схема скажет «должно быть числом», а не молча примет
    // пропуск там, где человек что-то ввёл.
    return n
  },
}
