/**
 * Идентификаторы объектов внутри документа этажа. Короткие (префикс + 10 знаков base36):
 * документ — сотни килобайт, и uuid на каждый узел заметно раздувал бы его.
 *
 * Генератор передаётся в операции явно: в тестах — последовательный, детерминированный, в
 * приложении — случайный.
 */
export type IdKind = 'n' | 'w' | 'o' | 's' | 'v' | 't'
export type IdGen = (kind: IdKind) => string

// Ни lib.dom, ни @types/node пакету не нужны — только криптостойкий генератор, который
// есть и в браузере, и в Node 24 как глобальный `crypto`.
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T }

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const ID_LENGTH = 10

export const randomIds: IdGen = (kind) => {
  // Равномерно: от байта берём младшие 6 бит (0…63), значения за пределами алфавита
  // отбрасываем. `byte % 36` давал бы первые четыре знака чаще остальных (256 = 7·36 + 4).
  let body = ''
  while (body.length < ID_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      const index = b & 63
      if (index < ALPHABET.length && body.length < ID_LENGTH) body += ALPHABET[index]
    }
  }
  return `${kind}_${body}`
}

/** Детерминированный генератор для тестов и фикстур: n1, n2…, w1, w2… */
export function sequentialIds(): IdGen {
  const counters: Partial<Record<IdKind, number>> = {}
  return (kind) => {
    const next = (counters[kind] ?? 0) + 1
    counters[kind] = next
    return `${kind}${next}`
  }
}
