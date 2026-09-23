/**
 * Сжатие снимка перед отправкой в чат (§9, «отправить со сжатием»).
 *
 * Зачем вообще: снимок с телефона — это 4–12 МБ, которые уходят в чат ради картинки шириной
 * в пузырь. Получатель ждёт байты, отправитель ест трафик, бакет растёт. Telegram уменьшает
 * такие снимки нативно; в браузере тот же результат даёт `canvas`.
 *
 * Чего здесь сознательно нет — сжатия видео. Транскодирование ролика в браузере занимает
 * минуты и вешает вкладку, поэтому видео уходит как есть, а выбор «без сжатия» для него
 * меняет только вид: плеер или строка файла.
 */

/** Длинная сторона после сжатия. Столько же берёт Telegram: хватает на любой экран пузыря. */
const MAX_SIDE = 1280

/** Качество JPEG. Ниже 0.8 на скриншотах текста появляется заметный шум вокруг букв. */
const QUALITY = 0.82

/**
 * Порог выгоды: сжатие, экономящее меньше десятой части веса, не применяем. Иначе маленький
 * PNG-скриншот превращается в JPEG того же веса, но с потерей чёткости текста — обмен в минус.
 */
const MIN_GAIN = 0.9

/** Снимки, которые сжимать нельзя: анимация и вектор потеряют себя в растровом JPEG. */
function isCompressible(file: File): boolean {
  if (!file.type.startsWith('image/')) return false
  return file.type !== 'image/gif' && file.type !== 'image/svg+xml'
}

/** Имя сжатого файла: то же, но с расширением реального формата. */
function toJpegName(name: string): string {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`
}

/**
 * Уменьшить снимок до {@link MAX_SIDE} по длинной стороне и пережать в JPEG.
 *
 * Возвращает исходный файл без изменений, если сжимать нечего или незачем: не картинка,
 * анимация, вектор, уже маленький снимок, выигрыш меньше {@link MIN_GAIN} — и при любой
 * ошибке браузера. Отправка не должна падать из-за того, что не удалось сэкономить трафик.
 */
export async function compressImage(file: File): Promise<File> {
  if (!isCompressible(file)) return file
  if (typeof createImageBitmap !== 'function') return file

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    // Снимок и так меньше потолка: пережимать его в JPEG значит только потерять качество.
    if (scale === 1 && file.type === 'image/jpeg') return file

    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', QUALITY)
    })
    if (!blob || blob.size >= file.size * MIN_GAIN) return file

    return new File([blob], toJpegName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  } catch {
    // Битый файл, нехватка памяти, снимок в неподдерживаемом формате — отправляем оригинал.
    return file
  } finally {
    bitmap?.close()
  }
}

/** Сжать всё, что сжимается, параллельно. Несжимаемое проходит насквозь. */
export async function compressImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map((f) => compressImage(f)))
}
