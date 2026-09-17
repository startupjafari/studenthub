import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RELEASE_NOTES } from './notes'

// Страж релизного регламента (docs/RELEASE.md). release-please бампит версию в
// package.json автоматически, а текст «Что нового» пишет человек — и именно он забывается
// последним, уже после мёржа. Тогда релиз уезжает на прод, а окно показывает прошлый
// выпуск, и никто этого не замечает: ошибки нет, просто тишина.
//
// Поэтому: версия из package.json обязана иметь запись здесь. Релизный PR остаётся
// красным, пока её не добавили.

const ROOT = path.join(__dirname, '..', '..', '..', '..', '..', '..')
const rootVersion = (
  JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }
).version

describe('релизные ноты', () => {
  it('у текущей версии из package.json есть запись', () => {
    const versions = RELEASE_NOTES.map((n) => n.version)
    expect(versions, `нет ноты для версии ${rootVersion} — добавьте её в notes.ts`).toContain(
      rootVersion,
    )
  })

  it('версии уникальны и в формате SemVer', () => {
    const versions = RELEASE_NOTES.map((n) => n.version)
    expect(new Set(versions).size).toBe(versions.length)
    for (const v of versions) expect(v).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('у каждой ноты есть дата и русский текст с непустым списком', () => {
    for (const n of RELEASE_NOTES) {
      expect(n.date, `${n.version}: дата в формате YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(n.date)), `${n.version}: дата не разбирается`).toBe(false)
      expect(n.content.ru.title.length, `${n.version}: пустой заголовок`).toBeGreaterThan(0)
      const items = n.content.ru.sections.flatMap((s) => s.items)
      expect(items.length, `${n.version}: нота без единого пункта`).toBeGreaterThan(0)
    }
  })

  it('переводы повторяют структуру русской ноты — иначе часть списка молча пропадёт', () => {
    for (const n of RELEASE_NOTES) {
      const ru = n.content.ru
      for (const [locale, content] of Object.entries(n.content)) {
        if (locale === 'ru') continue
        expect(content.sections.length, `${n.version}/${locale}: другое число блоков`).toBe(
          ru.sections.length,
        )
        content.sections.forEach((section, i) => {
          expect(section.items.length, `${n.version}/${locale}: блок ${i + 1}`).toBe(
            ru.sections[i]?.items.length,
          )
        })
      }
    }
  })
})
