import { inflateRawSync } from 'node:zlib'
import { DOCUMENT_TEMPLATE_LIMITS } from '@studenthub/shared-config'
import type { DocumentTemplateFileProblem } from '@studenthub/shared-schemas'

/**
 * Проверка DOCX до того, как его увидит шаблонизатор (docs/PROJECT.md §3.8 «Шаблоны»).
 *
 * DOCX — zip-архив, и проверять его надо как архив из чужих рук:
 *   1. **Zip-бомба.** pizzip распаковывает часть целиком и только потом сверяет размер с
 *      заявленным — 5 МБ архива успели бы развернуться в гигабайты в памяти процесса.
 *      Поэтому центральный каталог читается здесь, а каждая часть распаковывается
 *      `inflateRawSync` с `maxOutputLength` = заявленный размер: соврать о размере и
 *      протащить больше не выйдет, распаковка оборвётся на пределе.
 *   2. **Не Word.** Тип по сигнатуре (file-type) отличает DOCX от zip, но не от .docm/.dotx:
 *      у них та же оболочка. Решает тип главной части в `[Content_Types].xml`.
 *   3. **Активное содержимое.** Макросы, ActiveX, OLE-объекты и ссылки на внешние шаблоны
 *      или вложенные документы в официальной бумаге не нужны, а уходить она будет студентам.
 *      Такой файл не принимается вовсе — исправлять его сотрудник будет в Word.
 *
 * Своя мини-реализация чтения каталога, а не ещё одна zip-библиотека: нужно ровно три поля
 * заголовка, а зависимость ради них — лишняя поверхность (BACKEND_RULES §1).
 */

/** Отказ в приёме файла; `problem` уходит клиенту в `details`. */
export class DocxFileRejected extends Error {
  constructor(
    readonly problem: DocumentTemplateFileProblem,
    /** Технические подробности — только в серверный лог, клиенту не уходят. */
    readonly reason: string,
  ) {
    super(`${problem}: ${reason}`)
    this.name = 'DocxFileRejected'
  }
}

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const EOCD_MIN = 22
const MAX_COMMENT = 0xffff
/** Части, которые распаковываются целиком ради проверки структуры. */
const STRUCTURE_PART = /^\[Content_Types\]\.xml$|(^|\/)_rels\/[^/]*\.rels$/

const DOCX_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
/** Связи, которые тянут содержимое извне: внешний шаблон, вложенный документ, фрейм. */
const EXTERNAL_RISKY = ['attachedTemplate', 'subDocument', 'frame', 'oleObject']
/** Связи на активное содержимое — недопустимы даже внутри архива. */
const ACTIVE_RELS = ['oleObject', 'control', 'activeXControlBinary', 'vbaProject']

interface ZipEntry {
  name: string
  method: number
  flags: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

export interface InspectedDocx {
  /** Имена частей архива. */
  parts: string[]
}

/**
 * Проверяет архив и структуру DOCX. Бросает `DocxFileRejected` с причиной; иначе — список
 * частей (по нему шаблонизатор знает, что разбирать).
 */
export function inspectDocxArchive(buffer: Buffer): InspectedDocx {
  const entries = readCentralDirectory(buffer)
  const structure = new Map<string, string>()
  let total = 0
  for (const entry of entries) {
    const data = inflateEntry(buffer, entry)
    total += data.length
    if (total > DOCUMENT_TEMPLATE_LIMITS.MAX_UNCOMPRESSED_BYTES) {
      throw new DocxFileRejected('TOO_COMPLEX', `распакованный объём больше ${total} байт`)
    }
    if (STRUCTURE_PART.test(entry.name)) structure.set(entry.name, data.toString('utf8'))
  }
  const names = entries.map((e) => e.name)
  checkStructure(names, structure)
  return { parts: names }
}

function readCentralDirectory(buffer: Buffer): ZipEntry[] {
  const eocd = findEocd(buffer)
  const count = buffer.readUInt16LE(eocd + 10)
  const cdSize = buffer.readUInt32LE(eocd + 12)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  // ZIP64 (больше 65 535 частей или 4 ГБ) документу Word в пределах наших 10 МБ не нужен.
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new DocxFileRejected('TOO_COMPLEX', 'ZIP64')
  }
  if (count === 0) throw new DocxFileRejected('CORRUPTED', 'пустой архив')
  if (count > DOCUMENT_TEMPLATE_LIMITS.MAX_ZIP_ENTRIES) {
    throw new DocxFileRejected('TOO_COMPLEX', `частей в архиве: ${count}`)
  }
  if (cdOffset + cdSize > eocd) throw new DocxFileRejected('CORRUPTED', 'каталог за пределами')

  const entries: ZipEntry[] = []
  const seen = new Set<string>()
  let declaredTotal = 0
  let pos = cdOffset
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw new DocxFileRejected('CORRUPTED', `запись каталога ${i}`)
    }
    const flags = buffer.readUInt16LE(pos + 8)
    const method = buffer.readUInt16LE(pos + 10)
    const compressedSize = buffer.readUInt32LE(pos + 20)
    const uncompressedSize = buffer.readUInt32LE(pos + 24)
    const nameLen = buffer.readUInt16LE(pos + 28)
    const extraLen = buffer.readUInt16LE(pos + 30)
    const commentLen = buffer.readUInt16LE(pos + 32)
    const localOffset = buffer.readUInt32LE(pos + 42)
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLen)
    pos += 46 + nameLen + extraLen + commentLen

    // Бит 0 — шифрование части. Пароль на документ Word ставит иначе (целиком в OLE-
    // контейнер, такой файл и до сюда не дойдёт), а зашифрованная часть внутри zip — признак
    // собранного вручную архива.
    if (flags & 0x1) throw new DocxFileRejected('ENCRYPTED', name)
    if (method !== 0 && method !== 8) {
      throw new DocxFileRejected('CORRUPTED', `метод сжатия ${method}: ${name}`)
    }
    if (!isSafeName(name)) throw new DocxFileRejected('CORRUPTED', `имя части: ${name}`)
    // Две части с одним именем разные читатели разрешают по-разному: проверили бы одну,
    // а Word открыл бы другую.
    if (seen.has(name)) throw new DocxFileRejected('CORRUPTED', `повтор части: ${name}`)
    seen.add(name)

    declaredTotal += uncompressedSize
    if (declaredTotal > DOCUMENT_TEMPLATE_LIMITS.MAX_UNCOMPRESSED_BYTES) {
      throw new DocxFileRejected('TOO_COMPLEX', `заявленный объём ${declaredTotal}`)
    }
    // Степень сжатия — только у заметных частей: килобайт пробелов честно жмётся в 1000 раз.
    if (
      uncompressedSize > 1024 * 1024 &&
      uncompressedSize / Math.max(compressedSize, 1) >
        DOCUMENT_TEMPLATE_LIMITS.MAX_COMPRESSION_RATIO
    ) {
      throw new DocxFileRejected('TOO_COMPLEX', `степень сжатия части ${name}`)
    }
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset })
  }
  return entries
}

function findEocd(buffer: Buffer): number {
  if (buffer.length < EOCD_MIN) throw new DocxFileRejected('CORRUPTED', 'слишком короткий')
  const stop = Math.max(0, buffer.length - EOCD_MIN - MAX_COMMENT)
  for (let i = buffer.length - EOCD_MIN; i >= stop; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) return i
  }
  throw new DocxFileRejected('CORRUPTED', 'нет конца центрального каталога')
}

function isSafeName(name: string): boolean {
  if (name.length === 0 || name.startsWith('/') || name.includes('\\')) return false
  return !name.split('/').some((segment) => segment === '..')
}

function inflateEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const at = entry.localOffset
  if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== SIG_LOCAL) {
    throw new DocxFileRejected('CORRUPTED', `локальный заголовок: ${entry.name}`)
  }
  const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28)
  const end = start + entry.compressedSize
  if (end > buffer.length) throw new DocxFileRejected('CORRUPTED', `обрезана часть ${entry.name}`)
  const raw = buffer.subarray(start, end)

  if (entry.method === 0) {
    if (raw.length !== entry.uncompressedSize) {
      throw new DocxFileRejected('CORRUPTED', `размер части ${entry.name}`)
    }
    return raw
  }
  let data: Buffer
  try {
    // Предел — ЗАЯВЛЕННЫЙ размер: часть, которая распаковывается больше, чем о себе говорит,
    // — либо повреждена, либо бомба. Ноль байт zlib как предел не принимает.
    data = inflateRawSync(raw, { maxOutputLength: Math.max(entry.uncompressedSize, 1) })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'ERR_BUFFER_TOO_LARGE') {
      throw new DocxFileRejected('TOO_COMPLEX', `часть ${entry.name} больше заявленного`)
    }
    throw new DocxFileRejected('CORRUPTED', `не распаковывается часть ${entry.name}`)
  }
  if (data.length !== entry.uncompressedSize) {
    throw new DocxFileRejected('CORRUPTED', `размер части ${entry.name}`)
  }
  return data
}

function checkStructure(names: string[], structure: Map<string, string>): void {
  const contentTypes = structure.get('[Content_Types].xml')
  if (!contentTypes) throw new DocxFileRejected('NOT_WORD_DOCUMENT', 'нет [Content_Types].xml')

  const types = [...contentTypes.matchAll(/<(?:\w+:)?(?:Override|Default)\b[^>]*>/g)].map((m) =>
    attributes(m[0]),
  )
  // Макросы видны и по типу главной части (.docm), и по самой части с проектом VBA.
  const hasMacros =
    types.some((t) => /macroEnabled|vbaProject|vbaData/i.test(t.ContentType ?? '')) ||
    names.some((n) => /(^|\/)vba(Project\.bin|Data\.xml)$/i.test(n))
  if (hasMacros) throw new DocxFileRejected('MACROS', 'проект VBA')

  const main = types.find((t) => t.ContentType === DOCX_MAIN && t.PartName)
  if (!main?.PartName) {
    // .dotx, .xlsx, .pptx и прочие OOXML — не документ Word.
    throw new DocxFileRejected('NOT_WORD_DOCUMENT', 'нет главной части документа')
  }
  if (!names.includes(main.PartName.replace(/^\//, ''))) {
    throw new DocxFileRejected('CORRUPTED', `нет части ${main.PartName}`)
  }

  const activeByName = names.some(
    (n) => /(^|\/)activeX\//i.test(n) || /(^|\/)embeddings\/[^/]*\.bin$/i.test(n),
  )
  if (activeByName) throw new DocxFileRejected('ACTIVE_CONTENT', 'ActiveX или OLE')

  for (const [part, xml] of structure) {
    if (!part.endsWith('.rels')) continue
    for (const match of xml.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
      const rel = attributes(match[0])
      const kind = (rel.Type ?? '').replace(RELS_NS, '').split('/').pop() ?? ''
      if (ACTIVE_RELS.includes(kind)) {
        throw new DocxFileRejected('ACTIVE_CONTENT', `${part}: ${kind}`)
      }
      if (rel.TargetMode === 'External' && EXTERNAL_RISKY.includes(kind)) {
        throw new DocxFileRejected('EXTERNAL_CONTENT', `${part}: ${kind}`)
      }
    }
  }
}

/** Атрибуты одного XML-тега. Значения из служебных частей OOXML, без вложенных кавычек. */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const key = m[1]
    if (key) out[key] = m[2] ?? m[3] ?? ''
  }
  return out
}
