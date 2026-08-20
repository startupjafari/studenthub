import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Контраст токенов темы по WCAG 2.1 (задача 13.7). Проверяем не «все пары подряд», а те, что
// реально встречаются в разметке: статусные цвета в проекте — это ЦВЕТ ТЕКСТА (text-destructive
// и т.п.) на белом фоне или на подложке того же цвета (bg-success/15 text-success), а не наоборот.
// Раньше жёлтый текст предупреждения давал 1.97 при норме 4.5 — то есть был нечитаем.
//
// AA: 4.5 для обычного текста, 3.0 для границ элементов управления (1.4.11).

const CSS = readFileSync(path.join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8')

type Oklch = { l: number; c: number; h: number }
type Rgb = [number, number, number]

function tokens(block: string): Record<string, Oklch> {
  const start = CSS.indexOf(`${block} {`)
  const body = CSS.slice(start, CSS.indexOf('\n}', start))
  const out: Record<string, Oklch> = {}
  for (const match of body.matchAll(/--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g)) {
    const [, name, l, c, h] = match
    if (!name) continue
    out[name] = { l: Number(l), c: Number(c), h: Number(h) }
  }
  return out
}

/** OKLCH → sRGB (значения вне охвата обрезаются, как это делает браузер). */
function toRgb({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const ls = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const ms = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const ss = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const raw: Rgb = [
    4.0767416621 * ls - 3.3077115913 * ms + 0.2309699292 * ss,
    -1.2684380046 * ls + 2.6097574011 * ms - 0.3413193965 * ss,
    -0.0041960863 * ls - 0.7034186147 * ms + 1.707614701 * ss,
  ]
  return raw.map((v) => Math.min(1, Math.max(0, v))) as Rgb
}

const luminance = (rgb: Rgb): number => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** Подложка вида `bg-success/15`: цвет с прозрачностью поверх фона. */
function tint(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [
    alpha * fg[0] + (1 - alpha) * bg[0],
    alpha * fg[1] + (1 - alpha) * bg[1],
    alpha * fg[2] + (1 - alpha) * bg[2],
  ]
}

describe('контраст токенов темы (WCAG AA)', () => {
  const light = tokens(':root')
  const dark = tokens('.dark')

  /** Токен по имени: его отсутствие — ошибка теста, а не молчаливый undefined. */
  const color = (theme: Record<string, Oklch>, name: string): Rgb => {
    const token = theme[name]
    if (!token) throw new Error(`в теме нет токена --${name}`)
    return toRgb(token)
  }

  it('светлая: основной и вторичный текст читаемы', () => {
    const bg = color(light, 'background')
    expect(contrast(color(light, 'foreground'), bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color(light, 'muted-foreground'), bg)).toBeGreaterThanOrEqual(4.5)
    // Вторичный текст живёт и на серых плашках, а не только на белом.
    expect(
      contrast(color(light, 'muted-foreground'), color(light, 'muted')),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('светлая: статусные цвета читаемы как текст — и на фоне, и на своей подложке', () => {
    const bg = color(light, 'background')
    for (const name of ['destructive', 'success', 'warning', 'info'] as const) {
      const fg = color(light, name)
      expect(contrast(fg, bg), `${name} на фоне`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(fg, tint(fg, bg, 0.15)), `${name} на подложке /15`).toBeGreaterThanOrEqual(
        4.5,
      )
    }
  })

  it('обе темы: белый текст на кнопке primary', () => {
    for (const [name, t] of [
      ['светлая', light],
      ['тёмная', dark],
    ] as const) {
      expect(
        contrast(color(t, 'primary-foreground'), color(t, 'primary')),
        `${name}: bg-primary text-primary-foreground`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('обе темы: граница поля ввода различима (1.4.11)', () => {
    for (const [name, t] of [
      ['светлая', light],
      ['тёмная', dark],
    ] as const) {
      // Поля залиты цветом фона, поэтому граница — единственный признак элемента управления.
      expect(
        contrast(color(t, 'input'), color(t, 'background')),
        `${name}: --input`,
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('тёмная: основной текст и ошибка на фоне', () => {
    const bg = color(dark, 'background')
    expect(contrast(color(dark, 'foreground'), bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color(dark, 'destructive'), bg)).toBeGreaterThanOrEqual(4.5)
  })
})
