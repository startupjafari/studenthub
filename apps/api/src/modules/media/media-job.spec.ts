import { trimOf } from './media-job'

describe("trimOf — отрезок из данных job'а", () => {
  it('полный и корректный отрезок разбирается в числа', () => {
    expect(
      trimOf({ fileId: 'f', trimStartMs: '1500', trimEndMs: '61500', trimSourceKey: 'a.mp4' }),
    ).toEqual({ startMs: 1500, endMs: 61500, sourceKey: 'a.mp4' })
  })

  it('без отрезка — undefined', () => {
    expect(trimOf({ fileId: 'f' })).toBeUndefined()
  })

  it('битый или перевёрнутый отрезок не режет ролик', () => {
    expect(
      trimOf({ fileId: 'f', trimStartMs: 'x', trimEndMs: '10', trimSourceKey: 'a.mp4' }),
    ).toBeUndefined()
    expect(
      trimOf({ fileId: 'f', trimStartMs: '5000', trimEndMs: '1000', trimSourceKey: 'a.mp4' }),
    ).toBeUndefined()
    expect(trimOf({ fileId: 'f', trimStartMs: '0', trimEndMs: '1000' })).toBeUndefined()
  })
})
