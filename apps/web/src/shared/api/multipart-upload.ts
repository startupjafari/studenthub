import axios, { type AxiosProgressEvent } from 'axios'
import { FILE_UPLOAD } from '@studenthub/shared-config'

/**
 * Многочастная загрузка крупных файлов (Фаза 19): файл режется на части, каждая уходит по
 * своей подписанной ссылке, сборку делает сервер.
 *
 * Зачем поверх одиночного presigned-PUT: полутрагигабайтный ролик одним запросом по мобильной
 * сети доезжает редко, а обрыв на 80 % означает заливку заново. Части же перезаливаются
 * поштучно, идут параллельно и переживают обрыв — на этом же держится докачка.
 *
 * Шаги протокола: start (сервер открывает загрузку) → urls (подписи на части) → PUT каждой
 * части браузером → complete (сервер склеивает и проверяет объект).
 */

export interface MultipartTarget {
  key: string
  uploadId: string
  /** Размер части, который посчитал сервер. Клиент режет файл ровно по нему. */
  partSize: number
  partCount: number
}

/** Залитая часть: номер (с единицы, как в S3) и её ETag — без них сервер не соберёт объект. */
export interface UploadedPart {
  part: number
  etag: string
}

/** Сколько частей льём одновременно. Больше не ускоряет, а на мобильной сети только мешает. */
const CONCURRENCY = 3

/** Попыток на часть. Обрыв одной из пятидесяти не должен убивать всю загрузку. */
const PART_ATTEMPTS = 3

/** Пауза перед повтором, мс: удваивается с каждой попыткой. */
const RETRY_BASE_MS = 500

export function needsMultipartUpload(size: number): boolean {
  return size > FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES
}

/** Разложить номера частей на непрерывные отрезки: подписи запрашиваются диапазонами. */
function toRanges(parts: number[]): { from: number; to: number }[] {
  const sorted = [...parts].sort((a, b) => a - b)
  const ranges: { from: number; to: number }[] = []
  for (const part of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && part === last.to + 1) last.to = part
    else ranges.push({ from: part, to: part })
  }
  return ranges
}

/**
 * ETag из ответа MinIO. Его не видно кросс-доменно без `ExposeHeaders: ETag` в CORS-политике
 * бакета — и это самая частая причина, по которой части заливаются, а сборка не собирается.
 * Поэтому здесь не молчаливый `undefined`, а ошибка, называющая настройку по имени.
 */
function readEtag(headers: unknown, part: number): string {
  const raw = (headers as Record<string, unknown> | undefined)?.etag
  const etag = typeof raw === 'string' ? raw.replace(/"/g, '') : ''
  if (!etag) {
    throw new Error(
      `Часть ${part} загружена, но хранилище не вернуло ETag. ` +
        'Проверьте CORS-политику бакета: в ExposeHeaders должен быть ETag.',
    )
  }
  return etag
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Залить одну часть с повторами.
 *
 * Отдельный axios без интерцепторов приложения — по той же причине, что и у одиночной прямой
 * загрузки: подписанная ссылка самодостаточна, а наш `Authorization` в запросе к хранилищу
 * лишний и может не совпасть с подписью.
 */
async function putPart(params: {
  url: string
  body: Blob
  part: number
  signal?: AbortSignal
  onBytes: (loaded: number) => void
}): Promise<UploadedPart> {
  let lastError: unknown
  for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt += 1) {
    try {
      const res = await axios.put(params.url, params.body, {
        headers: { 'Content-Type': 'application/octet-stream' },
        signal: params.signal,
        onUploadProgress: (e: AxiosProgressEvent) => params.onBytes(e.loaded),
      })
      return { part: params.part, etag: readEtag(res.headers, params.part) }
    } catch (e) {
      // Отмену не повторяем: пользователь нажал крестик, а не сеть моргнула.
      if (params.signal?.aborted) throw e
      lastError = e
      // Счётчик отправленного по этой части сбрасываем — иначе повтор досчитал бы её дважды
      // и общий прогресс перевалил бы за сто процентов.
      params.onBytes(0)
      if (attempt < PART_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
    }
  }
  throw lastError
}

/**
 * Полный многочастный путь. Шаги протокола передаются вызывающим: у каждого домена свои
 * эндпоинты, как и у одиночной прямой загрузки.
 *
 * `done` и `onPartDone` — точки для докачки (19.4): уже залитые части пропускаются, а каждая
 * успешная сообщается наружу, чтобы вызывающий мог её запомнить.
 */
export async function uploadMultipart<T>(params: {
  file: File
  start: (mime: string, size: number) => Promise<MultipartTarget>
  urls: (range: {
    key: string
    uploadId: string
    from: number
    to: number
  }) => Promise<{ part: number; url: string }[]>
  complete: (input: {
    key: string
    uploadId: string
    parts: UploadedPart[]
    name: string
  }) => Promise<T>
  abort?: (input: { key: string; uploadId: string }) => Promise<void>
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  /** Уже залитые части — их не перезаливаем. */
  done?: UploadedPart[]
  onStart?: (target: MultipartTarget) => void
  onPartDone?: (part: UploadedPart) => void
  /** Готовая загрузка вместо открытия новой (докачка). */
  resume?: MultipartTarget
}): Promise<T> {
  const mime = params.file.type || 'application/octet-stream'
  const target = params.resume ?? (await params.start(mime, params.file.size))
  if (!params.resume) params.onStart?.(target)

  const partLength = (part: number): number => {
    const offset = (part - 1) * target.partSize
    return Math.min(target.partSize, params.file.size - offset)
  }

  const uploaded = new Map(params.done?.map((p) => [p.part, p]) ?? [])
  const pending: number[] = []
  for (let part = 1; part <= target.partCount; part += 1) {
    if (!uploaded.has(part)) pending.push(part)
  }

  // Байты уже принятых частей считаем сразу: при докачке прогресс обязан продолжиться
  // с того места, где оборвался, а не поехать от нуля.
  const sentByPart = new Map<number, number>()
  for (const part of uploaded.keys()) sentByPart.set(part, partLength(part))
  const report = (): void => {
    if (!params.onProgress) return
    let sent = 0
    for (const value of sentByPart.values()) sent += value
    params.onProgress(Math.min(1, sent / params.file.size))
  }
  report()

  try {
    // Подписи берём диапазонами: полсотни частей по запросу на каждую упрутся в троттлер
    // выдачи подписей. При докачке диапазонов несколько — недостающие части не подряд.
    const signed = new Map<number, string>()
    for (const range of toRanges(pending)) {
      const batch = await params.urls({
        key: target.key,
        uploadId: target.uploadId,
        from: range.from,
        to: range.to,
      })
      for (const item of batch) signed.set(item.part, item.url)
    }

    // Пул воркеров: очередь одна, каждый берёт следующую часть, как освободится.
    const queue = [...pending]
    const worker = async (): Promise<void> => {
      for (;;) {
        const part = queue.shift()
        if (part === undefined) return
        const url = signed.get(part)
        if (!url) throw new Error(`Нет подписанной ссылки для части ${part}`)
        const offset = (part - 1) * target.partSize
        const body = params.file.slice(offset, offset + partLength(part))
        const result = await putPart({
          url,
          body,
          part,
          signal: params.signal,
          onBytes: (loaded) => {
            sentByPart.set(part, loaded)
            report()
          },
        })
        uploaded.set(part, result)
        // Считаем часть целиком: последний onUploadProgress может не дойти до конца.
        sentByPart.set(part, partLength(part))
        report()
        params.onPartDone?.(result)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

    return await params.complete({
      key: target.key,
      uploadId: target.uploadId,
      parts: [...uploaded.values()],
      name: params.file.name,
    })
  } catch (e) {
    // Отмену убираем за собой сразу: части лежат в хранилище и места не освобождают.
    // При сетевой ошибке загрузку НЕ отменяем — на ней держится докачка.
    if (params.signal?.aborted) {
      await params.abort?.({ key: target.key, uploadId: target.uploadId }).catch(() => undefined)
    }
    throw e
  }
}
