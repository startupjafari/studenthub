import { describe, expect, it } from 'vitest'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import { fileCategoryOfMime, isOversizeOnPick, maxUploadBytes } from './file-limits'

const MB = 1024 * 1024

function fileOf(mime: string, size: number): File {
  const file = new File([], 'attachment', { type: mime })
  // Размер настоящего File задаётся содержимым; держать в памяти сотни мегабайт ради
  // проверки сравнения незачем, поэтому подменяем только само свойство.
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('fileCategoryOfMime', () => {
  it('раскладывает типы из белого списка по категориям', () => {
    expect(fileCategoryOfMime('image/png')).toBe('IMAGE')
    expect(fileCategoryOfMime('application/pdf')).toBe('DOCUMENT')
    expect(fileCategoryOfMime('audio/mpeg')).toBe('AUDIO')
  })

  it('не знает типов вне белого списка', () => {
    expect(fileCategoryOfMime('application/x-msdownload')).toBeUndefined()
    expect(fileCategoryOfMime('')).toBeUndefined()
  })
})

describe('maxUploadBytes', () => {
  it('берёт лимит категории', () => {
    expect(maxUploadBytes('image/png')).toBe(FILE_UPLOAD.MAX_BYTES.IMAGE)
    expect(maxUploadBytes('application/pdf')).toBe(FILE_UPLOAD.MAX_BYTES.DOCUMENT)
  })

  it('незнакомому типу даёт самый мягкий лимит — тип определит сервер', () => {
    expect(maxUploadBytes('')).toBe(Math.max(...Object.values(FILE_UPLOAD.MAX_BYTES)))
  })
})

describe('isOversizeOnPick', () => {
  it('отбивает документ больше лимита категории', () => {
    expect(isOversizeOnPick(fileOf('application/pdf', 140 * MB))).toBe(false)
    expect(isOversizeOnPick(fileOf('application/pdf', 600 * MB))).toBe(true)
  })

  it('пропускает снимок сверх лимита IMAGE — впереди сжатие', () => {
    expect(FILE_UPLOAD.MAX_BYTES.IMAGE).toBeLessThan(20 * MB)
    expect(isOversizeOnPick(fileOf('image/jpeg', 20 * MB))).toBe(false)
  })
})
