import PizZip from 'pizzip'

/**
 * Синтетические DOCX для тестов шаблонов. Минимальный, но настоящий документ Word:
 * главная часть, колонтитулы, стили, связи. Данные в тестах — выдуманные.
 */

export const DOCX_MAIN_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = `${R}/`

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Фрагмент текста с оформлением: так Word хранит шрифт и жирность. */
export function run(text: string, opts: { bold?: boolean; font?: string } = {}): string {
  const props = [
    opts.font
      ? `<w:rFonts w:ascii="${opts.font}" w:hAnsi="${opts.font}" w:cs="${opts.font}"/>`
      : '',
    opts.bold ? '<w:b/>' : '',
  ].join('')
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>`
}

/** Абзац из одного или нескольких фрагментов (несколько — как Word рвёт тег на части). */
export function paragraph(...runs: string[]): string {
  return `<w:p>${runs.map((r) => (r.startsWith('<w:r>') ? r : run(r))).join('')}</w:p>`
}

export function table(rows: string[][]): string {
  const cells = (row: string[]) =>
    row.map((c) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph(c)}</w:tc>`)
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${rows
    .map((row) => `<w:tr>${cells(row).join('')}</w:tr>`)
    .join('')}</w:tbl>`
}

export interface DocxOptions {
  /** Содержимое `<w:body>` (абзацы, таблицы). */
  body?: string
  header?: string
  footer?: string
  /** Тип главной части — чтобы собрать .docm или .dotx. */
  mainContentType?: string
  /** Дополнительные части архива. */
  extraFiles?: Record<string, string | Buffer>
  /** Дополнительные связи главной части (сырые `<Relationship …/>`). */
  extraRels?: string
  /** Без [Content_Types].xml — просто zip. */
  noContentTypes?: boolean
}

export function buildDocx(opts: DocxOptions = {}): Buffer {
  const zip = new PizZip()
  if (!opts.noContentTypes) {
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="${opts.mainContentType ?? DOCX_MAIN_TYPE}"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`,
    )
  }
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}officeDocument" Target="word/document.xml"/></Relationships>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL}header" Target="header1.xml"/><Relationship Id="rId3" Type="${REL}footer" Target="footer1.xml"/>${opts.extraRels ?? ''}</Relationships>`,
  )
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>`,
  )
  zip.file(
    'word/header1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W}">${paragraph(opts.header ?? 'Шапка')}</w:hdr>`,
  )
  zip.file(
    'word/footer1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W}">${paragraph(opts.footer ?? 'Подвал')}</w:ftr>`,
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${opts.body ?? paragraph('Текст')}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/></w:sectPr></w:body></w:document>`,
  )
  for (const [name, content] of Object.entries(opts.extraFiles ?? {})) zip.file(name, content)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

/** Текст части сгенерированного документа. */
export function partText(docx: Buffer, part = 'word/document.xml'): string {
  const file = new PizZip(docx).file(part)
  if (!file) throw new Error(`нет части ${part}`)
  return file.asText()
}

const SIG_CENTRAL = 0x02014b50

/** Смещение записи центрального каталога для части `name`. */
function centralRecord(buffer: Buffer, name: string): number {
  for (let i = 0; i + 46 < buffer.length; i++) {
    if (buffer.readUInt32LE(i) !== SIG_CENTRAL) continue
    const len = buffer.readUInt16LE(i + 28)
    if (buffer.toString('utf8', i + 46, i + 46 + len) === name) return i
  }
  throw new Error(`нет записи каталога ${name}`)
}

/** Подменить заявленный распакованный размер части — как в собранной вручную zip-бомбе. */
export function patchDeclaredSize(buffer: Buffer, name: string, size: number): Buffer {
  const out = Buffer.from(buffer)
  out.writeUInt32LE(size, centralRecord(out, name) + 24)
  return out
}

/** Пометить часть зашифрованной (бит 0 флагов). */
export function patchEncrypted(buffer: Buffer, name: string): Buffer {
  const out = Buffer.from(buffer)
  const at = centralRecord(out, name) + 8
  out.writeUInt16LE(out.readUInt16LE(at) | 0x1, at)
  return out
}
