import { equalsConstantTime } from './constant-time'

describe('equalsConstantTime', () => {
  it('совпадающие строки — true', () => {
    expect(equalsConstantTime('s3cret-token', 's3cret-token')).toBe(true)
  })

  it('разные строки одной длины — false', () => {
    expect(equalsConstantTime('s3cret-token', 's3cret-tokeN')).toBe(false)
  })

  it('разная длина — false, без исключения от timingSafeEqual', () => {
    expect(equalsConstantTime('short', 'much-longer-secret')).toBe(false)
  })

  it('пустые строки равны', () => {
    expect(equalsConstantTime('', '')).toBe(true)
  })

  it('многобайтовые символы сравниваются по байтам', () => {
    expect(equalsConstantTime('секрет', 'секрет')).toBe(true)
    expect(equalsConstantTime('секрет', 'секреm')).toBe(false)
  })
})
