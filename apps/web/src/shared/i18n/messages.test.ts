import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Страж словарей: ключ, которого нет ни в одной локали, тесты и сборка раньше не ловили —
// next-intl падает уже в рантайме (MISSING_MESSAGE), и на экран уходит сам ключ. Так дважды
// приезжали в прод `Nav.starostas` (пункт меню декана) и четыре ключа экрана закрытого профиля.
//
// Сверка количества ключей между локалями от этого не спасает: если ключа нет НИГДЕ, счётчики
// сходятся. Поэтому проверяем два независимых свойства:
//   1. каждый ключ, вызванный в коде, существует во всех трёх локалях;
//   2. наборы ключей ru/en/kk совпадают (перевод не забыт).

const LOCALES = ['ru', 'en', 'kk'] as const
const SRC = path.join(__dirname, '..', '..')
const MESSAGES = path.join(__dirname, '..', '..', '..', 'messages')

type Dict = Record<string, unknown>

function loadLocale(locale: string): Dict {
  return JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), 'utf8')) as Dict
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) collectFiles(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** Плоские пути всех ключей словаря: `Nav.chats`, `Feed.emptyTitle` и т.п. */
function flatten(node: unknown, prefix = '', out: Set<string> = new Set()): Set<string> {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node as Dict)) {
      const next = prefix ? `${prefix}.${key}` : key
      if (value && typeof value === 'object') flatten(value, next, out)
      else out.add(next)
    }
  }
  return out
}

/**
 * Ключи, использованные в коде: сопоставляем переменную из `const t = useTranslations('Ns')`
 * с её вызовами `t('key')`. Динамические ключи (шаблонные строки, переменные) пропускаем —
 * статически их не проверить.
 *
 * Привязка ищется ПО ПОЗИЦИИ — ближайшая объявленная выше. В одном файле нередко живёт несколько
 * компонентов, и `t` в каждом своё: в public-user-profile.tsx это сначала `Profile`, ниже
 * `Friends`. Простое сопоставление «имя → пространство» дало бы и ложные пропажи, и, наоборот,
 * зелёный тест на ключе, добавленном не в тот словарь.
 */
function usedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>()
  for (const file of collectFiles(SRC)) {
    const src = readFileSync(file, 'utf8')
    const bindings = [
      ...src.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*useTranslations\('([\w.]+)'\)/g),
    ]
    if (bindings.length === 0) continue
    for (const call of src.matchAll(/\b([A-Za-z0-9_]+)\('([\w.]+)'/g)) {
      const [, variable, key] = call
      const binding = bindings
        .filter((b) => b[1] === variable && b.index !== undefined && b.index < (call.index ?? 0))
        .pop()
      if (!binding) continue
      const full = `${binding[2]}.${key}`
      used.set(full, [...(used.get(full) ?? []), path.relative(SRC, file)])
    }
  }
  return used
}

describe('словари i18n', () => {
  const dicts = Object.fromEntries(LOCALES.map((l) => [l, flatten(loadLocale(l))])) as Record<
    (typeof LOCALES)[number],
    Set<string>
  >

  it('каждый ключ из кода есть во всех локалях', () => {
    const missing: string[] = []
    for (const [key, files] of usedKeys()) {
      const absent = LOCALES.filter((locale) => !dicts[locale].has(key))
      if (absent.length > 0) missing.push(`${key} — нет в ${absent.join(', ')} (${files[0]})`)
    }
    expect(missing).toEqual([])
  })

  /**
   * Ключи, собираемые ИЗ ЗНАЧЕНИЙ, а не из литералов: `tRoles(user.role)`,
   * `tNav(item.key)`, `tNav(`group.${section.group}`)`. Проверка выше их не видит —
   * в коде на месте ключа стоит переменная, — и именно так уехал `Roles.EMPLOYER`:
   * роль добавили в enum, подпись в словари забыли, экран упал в рантайме.
   *
   * Источник истины берём из кода (enum ролей, список пунктов навигации), а не из
   * словарей: иначе тест проверял бы словарь сам по себе.
   */
  it('у каждой роли есть подпись в Roles', () => {
    const rolesSrc = readFileSync(
      path.join(SRC, '..', '..', '..', 'packages', 'shared-types', 'src', 'roles.ts'),
      'utf8',
    )
    const roles = [...rolesSrc.matchAll(/^\s{2}([A-Z_]+):\s*'[A-Z_]+',$/gm)].map((m) => m[1])
    expect(roles.length).toBeGreaterThan(0)

    const missing: string[] = []
    for (const role of roles) {
      const absent = LOCALES.filter((locale) => !dicts[locale].has(`Roles.${role}`))
      if (absent.length > 0) missing.push(`Roles.${role} — нет в ${absent.join(', ')}`)
    }
    expect(missing).toEqual([])
  })

  it('у каждого пункта навигации есть подпись в Nav', () => {
    const navSrc = readFileSync(path.join(SRC, 'widgets', 'app-shell', 'model', 'nav.ts'), 'utf8')
    const keys = new Set([...navSrc.matchAll(/\bkey:\s*'([\w.]+)'/g)].map((m) => m[1]))
    const groups = new Set([...navSrc.matchAll(/\bgroup:\s*'([\w.]+)'/g)].map((m) => m[1]))
    expect(keys.size).toBeGreaterThan(0)

    const missing: string[] = []
    for (const key of keys) {
      const absent = LOCALES.filter((locale) => !dicts[locale].has(`Nav.${key}`))
      if (absent.length > 0) missing.push(`Nav.${key} — нет в ${absent.join(', ')}`)
    }
    for (const group of groups) {
      const absent = LOCALES.filter((locale) => !dicts[locale].has(`Nav.group.${group}`))
      if (absent.length > 0) missing.push(`Nav.group.${group} — нет в ${absent.join(', ')}`)
    }
    expect(missing).toEqual([])
  })

  it('наборы ключей ru/en/kk совпадают', () => {
    const gaps: string[] = []
    for (const key of dicts.ru) {
      const absent = LOCALES.filter((locale) => !dicts[locale].has(key))
      if (absent.length > 0) gaps.push(`${key} — нет в ${absent.join(', ')}`)
    }
    for (const locale of ['en', 'kk'] as const) {
      for (const key of dicts[locale]) {
        if (!dicts.ru.has(key)) gaps.push(`${key} — есть в ${locale}, нет в ru`)
      }
    }
    expect(gaps).toEqual([])
  })
})
