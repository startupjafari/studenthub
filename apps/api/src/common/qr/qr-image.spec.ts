import { renderQrDataUrl } from './qr-image'

// Разбираем результат обратно в текст: SVG кодируется в base64, а проверять удобнее разметку.
function svgOf(dataUrl: string): string {
  const [prefix, payload] = dataUrl.split(',')
  expect(prefix).toBe('data:image/svg+xml;base64')
  return Buffer.from(payload, 'base64').toString('utf8')
}

describe('renderQrDataUrl', () => {
  const url = 'https://app.studenthub.kz/r/ABCD2345'

  it('отдаёт SVG-датаурл, пригодный для <img src>', () => {
    const svg = svgOf(renderQrDataUrl(url))
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('модули и подложка скруглены', () => {
    const svg = svgOf(renderQrDataUrl(url))
    // Подложка — первый прямоугольник, скруглён по PLATE_RADIUS.
    expect(svg).toContain('rx="2" fill="#ffffff"')
    // Модули идут скруглёнными квадратами со стороной 1.
    expect(svg).toContain('width="1" height="1" rx="0.3"')
  })

  it('в центре стоит логотип, а модули под ним не рисуются', () => {
    const withLogo = svgOf(renderQrDataUrl(url))
    const withoutLogo = svgOf(renderQrDataUrl(url, { logo: false }))

    // Кисточка шапочки — часть только логотипа.
    expect(withLogo).toContain('<circle')
    expect(withoutLogo).not.toContain('<circle')
    // Вырезанная область: с логотипом модулей строго меньше.
    const count = (svg: string) => svg.split('height="1"').length - 1
    expect(count(withLogo)).toBeLessThan(count(withoutLogo))
  })

  it('ширина и тихая зона берутся из параметров', () => {
    const svg = svgOf(renderQrDataUrl(url, { width: 600, margin: 1 }))
    expect(svg).toContain('width="600" height="600"')

    // Тихая зона считается в модулях и входит в сторону холста с обеих сторон:
    // margin на 2 больше — viewBox на 4 шире. Проверяем разницу, а не абсолютные
    // числа: размер самой матрицы зависит от длины ссылки.
    const side = (s: string) => Number(/viewBox="0 0 (\d+)/.exec(s)?.[1])
    expect(side(svgOf(renderQrDataUrl(url, { margin: 3 })))).toBe(side(svg) + 4)
  })

  it('кодирует переданный текст (разный текст — разная картинка)', () => {
    expect(renderQrDataUrl(url)).not.toBe(renderQrDataUrl(`${url}X`))
  })
})
