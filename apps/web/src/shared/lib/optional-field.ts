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
