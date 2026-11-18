import { describe, expect, it } from 'vitest'
import {
  cropFraction,
  fitSide,
  fullCrop,
  isLight,
  moveCrop,
  resizeCrop,
  squareCrop,
  textFontPx,
} from './sticker-canvas'

const nat = { w: 1000, h: 500 }

describe('геометрия стикера', () => {
  it('большая сторона — 512, как на сервере', () => {
    expect(fitSide(1000, 500)).toEqual({ w: 512, h: 256 })
    expect(fitSide(30, 60)).toEqual({ w: 256, h: 512 })
  })

  it('квадрат — наибольший по центру', () => {
    expect(squareCrop(nat)).toEqual({ x: 250, y: 0, w: 500, h: 500 })
    expect(fullCrop(nat)).toEqual({ x: 0, y: 0, w: 1000, h: 500 })
  })

  it('рамка не выезжает за кадр', () => {
    const c = squareCrop(nat)
    expect(moveCrop(c, 10_000, -50, nat)).toEqual({ x: 500, y: 0, w: 500, h: 500 })
    expect(moveCrop(c, -10_000, 0, nat).x).toBe(0)
  })

  it('угол тянется, противоположный стоит; квадрат остаётся квадратом', () => {
    const c = { x: 100, y: 100, w: 200, h: 200 }
    // Тянем правый нижний угол к (500, 350): свободная рамка — 400×250.
    expect(resizeCrop(c, 'se', { x: 500, y: 350 }, nat, false)).toEqual({
      x: 100,
      y: 100,
      w: 400,
      h: 250,
    })
    // Квадрат — по большей стороне, но не за край кадра (снизу место только 400).
    const sq = resizeCrop(c, 'se', { x: 900, y: 350 }, nat, true)
    expect(sq.w).toBe(sq.h)
    expect(sq.y + sq.h).toBeLessThanOrEqual(nat.h)
    // Левый верхний угол за край — упирается в 0, правый нижний угол не двигается.
    const nw = resizeCrop(c, 'nw', { x: -50, y: -50 }, nat, false)
    expect(nw).toEqual({ x: 0, y: 0, w: 300, h: 300 })
  })

  it('рамка не меньше 10 % короткой стороны', () => {
    const c = { x: 100, y: 100, w: 200, h: 200 }
    const tiny = resizeCrop(c, 'se', { x: 101, y: 101 }, nat, false)
    expect(tiny.w).toBe(50)
    expect(tiny.h).toBe(50)
  })

  it('доли кадра для сервера — в пределах 0…1', () => {
    expect(cropFraction({ x: 250, y: 0, w: 500, h: 500 }, nat)).toEqual({
      x: 0.25,
      y: 0,
      w: 0.5,
      h: 1,
    })
    const f = cropFraction({ x: 990, y: 0, w: 50, h: 500 }, nat)
    expect(f.x + f.w).toBeLessThanOrEqual(1)
  })
})

describe('надпись', () => {
  it('шрифт уменьшается, пока строка не влезет в ширину', () => {
    const out = { w: 512, h: 512 }
    // «Ширина» строки — 10 px на пункт шрифта: 66 px шрифта дают 660 px > 460.
    const px = textFontPx(
      out,
      'очень длинная надпись',
      (font) => parseInt(font.split(' ')[1]!) * 10,
    )
    expect(px * 10).toBeLessThanOrEqual(out.w * 0.9)
    expect(textFontPx(out, 'ок', () => 10)).toBe(67)
  })

  it('контрастная обводка: светлому цвету — тёмная', () => {
    expect(isLight('#ffffff')).toBe(true)
    expect(isLight('#111111')).toBe(false)
    expect(isLight('#ffd60a')).toBe(true)
  })
})
