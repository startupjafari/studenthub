import { BRAND_BLUE, brandMarkBadge, brandMarkSvg } from './brand-mark'

// Фигуры знака: по ним проверяем, что в разметку попал именно он, а не пустая группа.
const DIAMOND = 'M12 3.4 22.6 8.6 12 13.8 1.4 8.6Z'
const TASSEL = '<circle cx="21.15" cy="15.4" r="1.35"/>'

describe('фирменный знак', () => {
  describe('бейдж для QR', () => {
    it('это белая плашка со знаком внутри', () => {
      const badge = brandMarkBadge(10, 6)
      expect(badge).toContain('fill="#ffffff"')
      expect(badge).toContain(DIAMOND)
      expect(badge).toContain(TASSEL)
    })

    it('центрируется и масштабируется по переданным координатам модулей', () => {
      // span 6 вокруг центра 10 → плашка от 7 до 13, знак вписан в 66% стороны.
      expect(brandMarkBadge(10, 6)).toContain('x="7" y="7" width="6" height="6"')
      expect(brandMarkBadge(10, 6)).toContain('scale(0.165)')
    })

    it('цвет знака задаётся группой, а не каждой фигурой', () => {
      // Ровно одно объявление цвета: иначе при смене палитры часть фигур осталась бы старой.
      const badge = brandMarkBadge(10, 6)
      expect(badge.split(`fill="${BRAND_BLUE}"`)).toHaveLength(2)
    })
  })

  describe('самостоятельный знак', () => {
    it('вариант plate — синяя подложка с белым знаком', () => {
      const svg = brandMarkSvg(96)
      expect(svg).toContain(`rx="6" fill="${BRAND_BLUE}"`)
      expect(svg).toContain('fill="#ffffff"')
      expect(svg).toContain(DIAMOND)
    })

    it('вариант glyph — знак без подложки', () => {
      const svg = brandMarkSvg(96, 'glyph')
      expect(svg).not.toContain('rx="6"')
      expect(svg).toContain(`<g fill="${BRAND_BLUE}">`)
      expect(svg).toContain(DIAMOND)
    })

    it('размер попадает в атрибуты, а viewBox остаётся 24×24', () => {
      const svg = brandMarkSvg(240)
      expect(svg).toContain('width="240" height="240"')
      expect(svg).toContain('viewBox="0 0 24 24"')
    })
  })
})
