import type { FastifyRequest } from 'fastify'
import { AppException } from '../exceptions/app.exception'

/**
 * Читает единственный файл из multipart-запроса в буфер (docs/BACKEND_RULES.md §8).
 * Отсутствие файла → BAD_REQUEST; превышение limits.fileSize (@fastify/multipart прерывает
 * поток) → FILE_DIRECT_UPLOAD_REQUIRED (нужна прямая presigned-загрузка).
 */
export async function readSingleUpload(req: FastifyRequest): Promise<Buffer> {
  const part = await req.file()
  if (!part) {
    throw new AppException('BAD_REQUEST', 'Файл не передан (ожидается multipart-поле "file")')
  }
  try {
    return await part.toBuffer()
  } catch {
    throw new AppException(
      'FILE_DIRECT_UPLOAD_REQUIRED',
      'Файл больше порога буферной загрузки — используйте presigned-загрузку напрямую в MinIO',
    )
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
  } catch {
    throw new AppException(
      'FILE_DIRECT_UPLOAD_REQUIRED',
      'Файл больше порога буферной загрузки — используйте presigned-загрузку напрямую в MinIO',
    )
  }
  return { fields, files }
}
