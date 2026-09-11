import { api } from '../api'

export interface DownloadedFile {
  blob: Blob
  /** Имя файла из `Content-Disposition`. Его задаёт сервер — у него единый шаблон имён. */
  filename: string
}

/**
 * Скачивание файла с защищённого эндпоинта.
 *
 * Через axios, а не прямой ссылкой: токен живёт в памяти, и обычная ссылка ушла бы без
 * него. Имя файла берём из ответа — шаблон имён живёт на сервере (`ExportBrandingService`),
 * и вторая копия правил на клиенте разошлась бы с ним при первой же правке.
 */
export async function requestFile(
  url: string,
  params?: Record<string, unknown>,
): Promise<DownloadedFile> {
  const response = await api.get<Blob>(url, { params, responseType: 'blob' })
  return {
    blob: response.data,
    filename: filenameFromDisposition(response.headers['content-disposition']),
  }
}

/** Сохранить полученный файл на диск. */
export function saveFile({ blob, filename }: DownloadedFile): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Имя файла из заголовка ответа.
 *
 * Сначала `filename*` (RFC 5987) — в нём настоящее имя в UTF-8; ASCII-форма это запасной
 * вариант, в ней нелатинские символы заменены подчёркиваниями. Заголовка нет (например,
 * его срезал прокси) — остаётся общее имя: скачивание важнее красивого имени.
 */
export function filenameFromDisposition(header: unknown): string {
  if (typeof header !== 'string') return 'studenthub-export'
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (utf8?.[1]) return decodeURIComponent(utf8[1])
  const ascii = /filename="([^"]+)"/i.exec(header)
  return ascii?.[1] ?? 'studenthub-export'
}
