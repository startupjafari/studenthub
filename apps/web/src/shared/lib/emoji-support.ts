const SIZE = 24
const cache = new Map<string, boolean>()
let context: CanvasRenderingContext2D | null | undefined
let referenceWidth = 0

function canvasContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context
  if (typeof document === 'undefined') return (context = null)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    context = canvas.getContext('2d', { willReadFrequently: true })
  } catch {
    context = null
  }
  if (context) {
    context.font = `${SIZE - 4}px sans-serif`
    context.textBaseline = 'top'
    referenceWidth = context.measureText('😀').width
  }
  return context
}

function render(ctx: CanvasRenderingContext2D, emoji: string, color: string): Uint8ClampedArray {
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = color
  ctx.fillText(emoji, 0, 0)
  return ctx.getImageData(0, 0, SIZE, SIZE).data
}

/**
 * Нарисует ли система этот смайл цветным знаком, а не квадратом или парой знаков. Подсказка
 * не должна предлагать то, что у собеседника (и у самого человека) окажется «тофу»: словари
 * свежее шрифтов, а Windows и старые Android отстают от Unicode на год-два.
 *
 * Как проверяем: цветной глиф не слушается цвета заливки, а квадрат-заглушка — обычный
 * текст и красится. Рисуем дважды разными цветами — совпало и не пусто, значит смайл есть.
 * Несобравшаяся ZWJ-последовательность распадается на несколько знаков — её выдаёт ширина.
 *
 * Без canvas (SSR, тесты) — считаем, что есть: прятать нечем и незачем.
 */
export function isEmojiSupported(emoji: string): boolean {
  const known = cache.get(emoji)
  if (known !== undefined) return known
  const ctx = canvasContext()
  if (!ctx) return true
  let supported = true
  try {
    const red = render(ctx, emoji, '#f00')
    const blue = render(ctx, emoji, '#00f')
    let painted = false
    for (let i = 0; i < red.length; i += 4) {
      if (red[i + 3] !== 0) painted = true
      if (red[i] !== blue[i] || red[i + 1] !== blue[i + 1] || red[i + 2] !== blue[i + 2]) {
        supported = false
        break
      }
    }
    if (!painted) supported = false
    if (supported && referenceWidth > 0) {
      supported = ctx.measureText(emoji).width < referenceWidth * 1.5
    }
  } catch {
    supported = true
  }
  cache.set(emoji, supported)
  return supported
}
