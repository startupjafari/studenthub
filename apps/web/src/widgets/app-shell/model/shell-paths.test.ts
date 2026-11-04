import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isShellPath } from './shell-paths'

const APP_DIR = join(__dirname, '../../../app')

// Страницы, которые рисовались без оболочки, пока её держали ролевые layout'ы (на 03.11.2026),
// и полноэкранный редактор кампуса (Ф22, 04.11.2026).
// Переезд оболочки в корневой layout не должен был изменить ни одну из них — и ни одну
// страницу с оболочкой не оставить без неё.
const SHELL_FREE_PAGES = [
  '/_dev/design-system',
  '/c/[code]',
  '/campus-editor/[floorId]',
  '/demo',
  '/demo/verify',
  '/employer/signup',
  '/employer/verify',
  '/forgot-password',
  '/join-chat/[id]',
  '/legal/privacy',
  '/legal/terms',
  '/login',
  '/offline',
  '/qr',
  '/r',
  '/r/resume/[slug]',
  '/register',
  '/reset-password',
  '/setup-2fa',
  '/verify',
  '/verify/[code]',
]

/** Адреса всех страниц приложения: группы `(…)` из адреса выпадают, `%5F` — это `_`. */
function pageUrls(dir: string): string[] {
  const urls: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) urls.push(...pageUrls(path))
    else if (name === 'page.tsx') {
      const segments = relative(APP_DIR, dir)
        .split(sep)
        .filter((s) => s && !(s.startsWith('(') && s.endsWith(')')))
        .map((s) => s.replace('%5F', '_'))
      urls.push(`/${segments.join('/')}`)
    }
  }
  return urls
}

describe('isShellPath', () => {
  const urls = pageUrls(APP_DIR)

  it('без оболочки — ровно прежний набор публичных страниц', () => {
    expect(urls.filter((u) => !isShellPath(u)).sort()).toEqual([...SHELL_FREE_PAGES].sort())
  })

  it('все остальные страницы — в оболочке', () => {
    const shell = urls.filter((u) => !SHELL_FREE_PAGES.includes(u))
    expect(shell.length).toBeGreaterThan(100)
    for (const url of shell) expect(isShellPath(url), url).toBe(true)
  })

  it('похожее начало пути не путается с публичным разделом', () => {
    for (const url of ['/verify-id', '/calendar', '/courses', '/reports', '/registry', '/qr-scan'])
      expect(isShellPath(url), url).toBe(true)
    expect(isShellPath('/verify/abc')).toBe(false)
    expect(isShellPath('/r/resume/slug')).toBe(false)
    expect(isShellPath('/r')).toBe(false)
    expect(isShellPath('/r/AB12CD')).toBe(true)
  })
})
