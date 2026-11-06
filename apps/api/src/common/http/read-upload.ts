import type { FastifyRequest } from 'fastify'
import { AppException } from '../exceptions/app.exception'

/**
 * Файл длиннее `limits.fileSize`: @fastify/multipart обрывает поток с этим кодом. Только он
 * означает «файл больше порога» — прочие ошибки чтения (обрыв соединения, лимит числа
 * частей, не multipart) пробрасываются как есть, и фильтр отдаёт их собственный 4xx.
 */
export function isFileTooLarge(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'FST_REQ_FILE_TOO_LARGE'
}

function directUploadRequired(): AppException {
  return new AppException(
    'FILE_DIRECT_UPLOAD_REQUIRED',
    'Файл больше порога буферной загрузки — используйте presigned-загрузку напрямую в MinIO',
  )
}

/**
 * Читает единственный файл из multipart-запроса в буфер (docs/BACKEND_RULES.md §8).
 * Отсутствие файла → BAD_REQUEST; превышение limits.fileSize (@fastify/multipart прерывает
 * поток) → FILE_DIRECT_UPLOAD_REQUIRED (нужна прямая presigned-загрузка).
 */
export async function readSingleUpload(req: FastifyRequest): Promise<Buffer> {
  return (await readNamedUpload(req)).buffer
}

/** То же, что `readSingleUpload`, плюс исходное имя файла — для списков, где его показывают. */
export async function readNamedUpload(
  req: FastifyRequest,
): Promise<{ buffer: Buffer; filename: string }> {
  const part = await req.file()
  if (!part) {
    throw new AppException('BAD_REQUEST', 'Файл не передан (ожидается multipart-поле "file")')
  }
  try {
    return { buffer: await part.toBuffer(), filename: part.filename }
  } catch (error) {
    if (isFileTooLarge(error)) throw directUploadRequired()
    throw error
  }
}

/**
 * Читает multipart-запрос с текстовыми полями и несколькими файлами (напр. сообщение чата
 * с вложениями, Ф9+). Поля собираются в строковый словарь, файлы — в буферы (лимит числа/размера
 * обеспечивает @fastify/multipart). Превышение размера файла → FILE_DIRECT_UPLOAD_REQUIRED.
 */
export async function readUploadWithFields(req: FastifyRequest): Promise<{
  fields: Record<string, string>
  files: { buffer: Buffer; filename: string }[]
}> {
  const fields: Record<string, string> = {}
  const files: { buffer: Buffer; filename: string }[] = []
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        files.push({ buffer: await part.toBuffer(), filename: part.filename })
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value
      }
    }
  } catch (error) {
    if (isFileTooLarge(error)) throw directUploadRequired()
    throw error
  }
  return { fields, files }
}
