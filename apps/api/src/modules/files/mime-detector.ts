import { FILE_UPLOAD, type FileCategory } from '@studenthub/shared-config'

// file-type v22 — ESM-only. api собирается в CommonJS, где TypeScript даунлевелит
// dynamic import() в require() и падает на ESM-only пакете (ERR_REQUIRE_ESM).
// Function-обёртка сохраняет нативный import() в рантайме, минуя эту трансформацию.
const importEsm = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>

interface FileTypeModule {
  fileTypeFromBuffer: (buffer: Uint8Array) => Promise<{ mime: string; ext: string } | undefined>
}

export interface DetectedFileType {
  mime: string
  ext: string
  category: FileCategory
}

// Обратный индекс mime → категория; строится один раз из белых списков shared-config.
const MIME_TO_CATEGORY = new Map<string, FileCategory>()
for (const category of Object.keys(FILE_UPLOAD.ALLOWED_MIME) as FileCategory[]) {
  for (const mime of FILE_UPLOAD.ALLOWED_MIME[category]) {
    MIME_TO_CATEGORY.set(mime, category)
  }
}

/**
 * Определяет реальный тип файла по содержимому (magic bytes) и относит к разрешённой
 * категории (docs/BACKEND_RULES.md §8). Content-Type от клиента и расширение игнорируются.
 * Возвращает undefined, если тип не распознан или отсутствует в белом списке.
 */
export async function detectAllowedFileType(buffer: Buffer): Promise<DetectedFileType | undefined> {
  const { fileTypeFromBuffer } = await importEsm<FileTypeModule>('file-type')
  const detected = await fileTypeFromBuffer(buffer)
  if (!detected) {
    return undefined
  }
  const category = MIME_TO_CATEGORY.get(detected.mime)
  if (!category) {
    return undefined
  }
  return { mime: detected.mime, ext: detected.ext, category }
}
