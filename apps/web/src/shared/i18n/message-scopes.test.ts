import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP, clientNamespaces, listFiles, rel } from '../../../scripts/import-graph.mjs'
import { computeScopes, ROOT_SCOPE, SCOPES_FILE } from '../../../scripts/i18n-scopes.mjs'

// Страж областей словаря (задача 21.B4). Клиент получает не весь словарь, а пространства
// имён своей области: корня (оболочка, провайдеры) и областей, через layout'ы которых
// проходит страница. Пространство имён, которое страница использует, но не получила,
// на экране превращается в ключ вместо текста — next-intl ловит это только в рантайме.
//
// Если тест упал: `pnpm --filter web i18n:scopes` и закоммитить src/i18n/message-scopes.json.

const scopes = JSON.parse(readFileSync(SCOPES_FILE, 'utf8')) as Record<string, string[]>
const ROUTE_FILE_RE = /^(page|layout|loading|error|not-found|template|default)\.tsx$/

/** Области, внутри которых рисуется файл маршрута: корень и каталоги-области выше него. */
function scopeChain(file: string): string[] {
  const chain = [ROOT_SCOPE]
  const dir = path.dirname(file)
  const parts = path.relative(APP, dir).split(path.sep).filter(Boolean)
  // layout области рисуется снаружи своего MessagesScope.
  const own = path.basename(file) === 'layout.tsx' ? parts.length - 1 : parts.length
  for (let i = 1; i <= own; i++) {
    const id = parts.slice(0, i).join('/')
    if (scopes[id]) chain.push(id)
  }
  return chain
}

describe('области словаря (message-scopes.json)', () => {
  it('JSON совпадает с тем, что считает генератор', () => {
    expect(scopes).toEqual(computeScopes())
  })

  it('каждый файл маршрута получает все пространства имён своего клиентского кода', () => {
    const missing: string[] = []
    for (const file of listFiles(APP, (f) => ROUTE_FILE_RE.test(path.basename(f)))) {
      const provided = new Set(scopeChain(file).flatMap((id) => scopes[id] ?? []))
      for (const ns of clientNamespaces([file])) {
        if (!provided.has(ns)) missing.push(`${rel(file)}: ${ns}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('у каждой области в JSON есть layout с MessagesScope', () => {
    const declared = listFiles(APP, (f) => path.basename(f) === 'layout.tsx')
      .map((file) => readFileSync(file, 'utf8').match(/<MessagesScope\s+scope="([^"]+)"/)?.[1])
      .filter((id): id is string => Boolean(id))
    expect([ROOT_SCOPE, ...declared].sort()).toEqual(Object.keys(scopes).sort())
  })

  it('корневая область — малая часть словаря', () => {
    // Не точная цифра, а ограда от регресса: один barrel, протащенный в оболочку,
    // возвращает в каждую страницу десятки пространств имён.
    const dict = JSON.parse(
      readFileSync(path.join(APP, '..', '..', 'messages', 'ru.json'), 'utf8'),
    ) as Record<string, unknown>
    const size = (list: string[]) =>
      Buffer.byteLength(JSON.stringify(Object.fromEntries(list.map((ns) => [ns, dict[ns]]))))
    expect(size(scopes[ROOT_SCOPE] ?? [])).toBeLessThan(size(Object.keys(dict)) * 0.2)
  })
})
