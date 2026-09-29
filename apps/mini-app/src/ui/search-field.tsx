import { IconSearch } from './icons'

/**
 * Строка поиска.
 *
 * Лупа слева — не украшение: поле без неё отличается от поля ввода имени только текстом
 * подсказки, а подсказка исчезает с первой набранной буквой. Значок остаётся.
 *
 * `type="search"` даёт на телефоне крестик очистки и кнопку «Искать» вместо «Ввод» —
 * обе бесплатны и обе тут уместны.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="search">
      <span className="search-icon" aria-hidden>
        <IconSearch size={18} />
      </span>
      <input
        className="search-input"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </div>
  )
}
