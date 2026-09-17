import { describe, expect, it } from 'vitest'
import { RELEASE_NOTES } from './notes'

// Ноту читают трое: приложение (окно «Что нового»), страж CI на PR в main и workflow,
// который собирает описание GitHub Release. Здесь проверяется, что файл пригоден для всех
// троих. Сам факт «для следующего релиза текст написан» проверяет не тест, а
// `scripts/release.mjs check-unreleased`: ему нужны теги репозитория, которых у vitest нет.

describe('релизные ноты', () => {
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
