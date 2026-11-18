import {
  planAnimation,
  planHlsLadder,
  planImageWidths,
  planPosterWidths,
  posterTimestamp,
} from './media-plan'
import { imageVariantKey, variantOwnerId, variantPrefix } from './media-keys'

describe('planImageWidths', () => {
  it('берёт только ступени заметно уже оригинала', () => {
    expect(planImageWidths(4032, false)).toEqual([320, 640, 1280, 2048])
    expect(planImageWidths(1400, false)).toEqual([320, 640])
  })

  it('мелкий не-WebP получает одну копию своей ширины, мелкий WebP — ничего', () => {
    expect(planImageWidths(300, false)).toEqual([300])
    expect(planImageWidths(300, true)).toEqual([])
  })
})

describe('planPosterWidths', () => {
  it('не апскейлит кадр', () => {
    expect(planPosterWidths(1920)).toEqual([640, 1280])
    expect(planPosterWidths(480)).toEqual([480])
    expect(planPosterWidths(1000)).toEqual([640, 1000])
  })
})

describe('planHlsLadder', () => {
  it('горизонтальное 1080p — все четыре ступени по высоте', () => {
    const ladder = planHlsLadder(1920, 1080)
    expect(ladder.map((r) => r.short)).toEqual([360, 480, 720, 1080])
    expect(ladder.at(-1)).toMatchObject({ width: 1920, height: 1080 })
    expect(ladder[0]).toMatchObject({ width: 640, height: 360 })
  })

  it('вертикальное 720×1280 — ступень по ширине, без 1080', () => {
    const ladder = planHlsLadder(720, 1280)
    expect(ladder.map((r) => r.short)).toEqual([360, 480, 720])
    expect(ladder.at(-1)).toMatchObject({ width: 720, height: 1280 })
  })

  it('ролик меньше нижней ступени — один рендишн своего размера, стороны чётные', () => {
    const ladder = planHlsLadder(321, 241)
    expect(ladder).toHaveLength(1)
    expect(ladder[0]!.width % 2).toBe(0)
    expect(ladder[0]!.height % 2).toBe(0)
    expect(ladder[0]!.height).toBeLessThanOrEqual(242)
  })

  it('нулевые размеры — пустая лесенка', () => {
    expect(planHlsLadder(0, 0)).toEqual([])
  })
})

describe('posterTimestamp', () => {
  it('секунда от начала, у коротких роликов — середина', () => {
    expect(posterTimestamp(60_000)).toBe(1)
    expect(posterTimestamp(1_000)).toBe(0.5)
    expect(posterTimestamp(null)).toBe(0)
  })
})

describe('media-keys', () => {
  const id = '11111111-1111-4111-8111-111111111111'

  it('владелец варианта читается из префикса', () => {
    expect(variantOwnerId(imageVariantKey(id, 640))).toBe(id)
    expect(variantOwnerId(`${variantPrefix(id)}hls/720/seg-0001.ts`)).toBe(id)
  })

  it('чужие ключи и мусор в префиксе — не варианты', () => {
    expect(variantOwnerId(`${id}/photo.jpg`)).toBeNull()
    expect(variantOwnerId('variants/../etc/passwd')).toBeNull()
  })
})

describe('planAnimation', () => {
  const delays = (n: number, ms: number) => Array<number>(n).fill(ms)

  it('один кадр — не анимация', () => {
    expect(planAnimation(320, 240, 1, [100])).toBeNull()
    expect(planAnimation(0, 240, 10)).toBeNull()
  })

  it('стороны чётные, длинная — не больше 720', () => {
    expect(planAnimation(101, 77, 10, delays(10, 100))).toMatchObject({ width: 102, height: 78 })
    expect(planAnimation(1440, 810, 10, delays(10, 100))).toMatchObject({
      width: 720,
      height: 406,
    })
    expect(planAnimation(400, 1000, 10, delays(10, 100))).toMatchObject({
      width: 288,
      height: 720,
    })
  })

  it('частота выше 30 к/с срезается, ниже — тайминг GIF как есть', () => {
    expect(planAnimation(100, 100, 50, delays(50, 20))?.fps).toBe(30)
    expect(planAnimation(100, 100, 10, delays(10, 100))?.fps).toBeNull()
  })

  it('задержка короче 20 мс считается за 100 мс, как в браузере', () => {
    expect(planAnimation(100, 100, 10, delays(10, 0))?.fps).toBeNull()
  })
})
