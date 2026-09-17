/**
 * Сравнение версий SemVer: `-1` | `0` | `1`.
 *
 * Строковое сравнение здесь не работает: `'1.10.0' < '1.9.0'` лексикографически истинно,
 * и после десятого минорного релиза окно «Что нового» перестало бы показываться совсем.
 */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)

  for (let i = 0; i < 3; i += 1) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    if (Number.isNaN(l) || Number.isNaN(r)) return 0
    if (l !== r) return l > r ? 1 : -1
  }
  return 0
}

/** `a` строго новее `b`. */
export function isNewerVersion(a: string, b: string): boolean {
  return compareVersions(a, b) > 0
}
