// Подготовка фото для сторис в браузере: кадр 9:16 без обрезки. Само фото — целиком по
// центру, вокруг него — оно же, растянутое на весь кадр, размытое и затемнённое (а не
// чёрные поля). Обрезку под 9:16 делает общее окно кадрирования (ImageCropModal).

const STORY_WIDTH = 1080
const STORY_HEIGHT = 1920

function draw(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  iw: number,
  ih: number,
  mode: 'cover' | 'contain',
): void {
  const scale =
    mode === 'cover'
      ? Math.max(STORY_WIDTH / iw, STORY_HEIGHT / ih)
      : Math.min(STORY_WIDTH / iw, STORY_HEIGHT / ih)
  const w = iw * scale
  const h = ih * scale
  ctx.drawImage(image, (STORY_WIDTH - w) / 2, (STORY_HEIGHT - h) / 2, w, h)
}

/** Фото целиком в кадре 9:16 с размытым фоном. Ориентацию снимка учитывает декодер. */
export async function fitImageToStory(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = STORY_WIDTH
    canvas.height = STORY_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d недоступен')
    // Размытие есть не во всех движках (`filter` у контекста) — без него фон просто темнее.
    if ('filter' in ctx) ctx.filter = 'blur(48px)'
    draw(ctx, bitmap, bitmap.width, bitmap.height, 'cover')
    if ('filter' in ctx) ctx.filter = 'none'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)
    draw(ctx, bitmap, bitmap.width, bitmap.height, 'contain')
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    )
    if (!blob) throw new Error('не удалось собрать кадр')
    const name = file.name.replace(/\.[^.]+$/, '') || 'story'
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}
