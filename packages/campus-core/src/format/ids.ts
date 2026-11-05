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

export const randomIds: IdGen = (kind) => {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  let out = kind + '_'
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
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
