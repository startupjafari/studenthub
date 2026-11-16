import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { VALIDATION_MESSAGE_KEYS, VALIDATION_MESSAGE_VALUES } from '@studenthub/shared-schemas'
import { translateValidationMessage } from '../lib/validation-message'

// Страж сообщений валидации (21.B2): схемы shared-schemas отдают ключ `validation.…`, а
// текст берётся из словаря `Validation`. Ключ без перевода не роняет форму — она покажет
// сам ключ, — поэтому пропажу ловим здесь, а не глазами на казахском интерфейсе.

const LOCALES = ['ru', 'en', 'kk'] as const
const MESSAGES = path.join(__dirname, '..', '..', '..', 'messages')
const SCHEMAS = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'shared-schemas',
  'src',
)
const PREFIX = 'validation.'

type Dict = Record<string, unknown>

function validationDict(locale: string): Map<string, string> {
  const all = JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), 'utf8')) as Dict
  const out = new Map<string, string>()
  const walk = (node: unknown, prefix: string): void => {
    for (const [key, value] of Object.entries(node as Dict)) {
      const next = `${prefix}.${key}`
      if (value && typeof value === 'object') walk(value, next)
      else out.set(next, String(value))
    }
  }
  walk(all.Validation ?? {}, 'validation')
  return out
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort()

describe('сообщения валидации shared-schemas', () => {
  const dicts = Object.fromEntries(LOCALES.map((l) => [l, validationDict(l)])) as Record<
    (typeof LOCALES)[number],
    Map<string, string>
  >

  it('каждый ключ реестра переведён на все языки', () => {
    const missing: string[] = []
    for (const key of VALIDATION_MESSAGE_KEYS) {
      const absent = LOCALES.filter((locale) => !dicts[locale].get(key))
      if (absent.length > 0) missing.push(`${key} — нет в ${absent.join(', ')}`)
    }
    expect(missing).toEqual([])
  })

  it('в словаре нет переводов для ключей, которых нет в реестре', () => {
    const known = new Set<string>(VALIDATION_MESSAGE_KEYS)
    const orphans = LOCALES.flatMap((locale) =>
      [...dicts[locale].keys()].filter((key) => !known.has(key)).map((k) => `${locale}: ${k}`),
    )
    expect(orphans).toEqual([])
  })

  it('подстановки совпадают во всех языках и у каждой есть значение', () => {
    const problems: string[] = []
    for (const key of VALIDATION_MESSAGE_KEYS) {
      const ru = placeholders(dicts.ru.get(key) ?? '')
      for (const locale of ['en', 'kk'] as const) {
        const other = placeholders(dicts[locale].get(key) ?? '')
        if (other.join() !== ru.join()) problems.push(`${key}: ${locale} {${other}} ≠ ru {${ru}}`)
      }
      const values = Object.keys(VALIDATION_MESSAGE_VALUES[key] ?? {}).sort()
      if (values.join() !== ru.join()) problems.push(`${key}: значения {${values}} ≠ текст {${ru}}`)
    }
    expect(problems).toEqual([])
  })

  /**
   * Русский текст прямо в схеме — ровно то, от чего ушли: он доезжает до казахского и
   * английского интерфейса как есть. Комментарии не в счёт; регулярные выражения с
   * кириллицей (`/[А-Яа-я]/` в политике пароля) — не строки и тоже не в счёт.
   */
  it('в схемах нет строк с кириллицей', () => {
    const found: string[] = []
    for (const file of readdirSync(SCHEMAS).filter((f) => f.endsWith('.ts'))) {
      const code = readFileSync(path.join(SCHEMAS, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1')
      for (const match of code.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*?)\1/g)) {
        if (/[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/.test(match[2] ?? '')) found.push(`${file}: ${match[0]}`)
      }
    }
    expect(found).toEqual([])
  })

  it('ключи реестра начинаются с общего префикса и не повторяются', () => {
    expect(VALIDATION_MESSAGE_KEYS.filter((key) => !key.startsWith(PREFIX))).toEqual([])
    expect(new Set(VALIDATION_MESSAGE_KEYS).size).toBe(VALIDATION_MESSAGE_KEYS.length)
  })
})

describe('translateValidationMessage', () => {
  const dict: Record<string, string> = { 'password.tooShort': 'At least 8 characters' }
  const t = Object.assign(
    (key: string, values?: Record<string, number>) =>
      `${dict[key] ?? key}${values ? JSON.stringify(values) : ''}`,
    { has: (key: string) => key in dict },
  ) as unknown as Parameters<typeof translateValidationMessage>[0]

  it('переводит известный ключ', () => {
    expect(translateValidationMessage(t, 'validation.password.tooShort')).toBe(
      'At least 8 characters',
    )
  })

  it('готовый текст и стандартное сообщение zod оставляет как есть', () => {
    expect(translateValidationMessage(t, 'Введите название')).toBe('Введите название')
    expect(translateValidationMessage(t, 'Required')).toBe('Required')
  })

  it('незнакомый ключ показывает как есть, а не роняет форму', () => {
    expect(translateValidationMessage(t, 'validation.fromTheFuture')).toBe(
      'validation.fromTheFuture',
    )
    // Ключ есть в реестре, но перевода нет — тоже как есть.
    expect(translateValidationMessage(t, 'validation.date.format')).toBe('validation.date.format')
  })
})
