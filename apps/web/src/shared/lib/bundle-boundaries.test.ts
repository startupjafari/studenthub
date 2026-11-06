import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP,
  SRC,
  importsOf,
  isClientModule,
  listFiles,
  rel,
} from '../../../scripts/import-graph.mjs'

// Страж бандла (задача 21.B4): серверный модуль не импортирует общий barrel `shared/ui`
// или `shared/lib`.
//
// Почему это важно. Next собирает клиентские входы маршрута, обходя граф СЕРВЕРНЫХ модулей
// (flight-client-entry-plugin), и каждый `'use client'`-модуль, до которого дотянулся
// обход, попадает в бандл страницы — использован он или нет. Barrel реэкспортирует ~60
// клиентских компонентов, среди них редактор на tiptap и выбор эмодзи. Одна строка
// `import { PageLoader } from 'shared/ui'` в loading.tsx отдавала их все на каждый
// маршрут, включая /login. Внутри клиентского кода barrel безвреден — там работает обычное
// вытряхивание неиспользованного (sideEffects в package.json), а на серверной стороне
// оно не действует.
//
// Что делать, если тест упал: в серверном модуле импортировать компонент из его файла —
// `shared/ui/page-loader`, а не `shared/ui`.

const LAYER_BARRELS = ['shared/ui/index.ts', 'shared/lib/index.ts'].map((p) => path.join(SRC, p))

/** Серверные модули, достижимые от файлов app/ без захода в клиентские. */
function serverModules(): string[] {
  const seen = new Set<string>()
  const stack = listFiles(APP).filter((file) => !isClientModule(file))
  while (stack.length > 0) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const target of importsOf(file)) if (!isClientModule(target)) stack.push(target)
  }
  return [...seen]
}

describe('границы бандла', () => {
  it('серверные модули не импортируют barrel shared/ui и shared/lib', () => {
    const offenders = serverModules()
      // Сам barrel — тоже серверный модуль обхода; его реэкспорты не нарушение.
      .filter((file) => !LAYER_BARRELS.includes(file))
      .flatMap((file) =>
        importsOf(file)
          .filter((target) => LAYER_BARRELS.includes(target))
          .map((target) => `${rel(file)} → ${rel(path.dirname(target))}`),
      )
    expect(offenders).toEqual([])
  })
})
