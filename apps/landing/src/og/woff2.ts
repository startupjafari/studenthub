import { brotliDecompressSync } from 'node:zlib'

/**
 * Распаковка WOFF2 в обычный TrueType — ровно настолько, насколько нужно картинке превью.
 *
 * Зачем это вообще. Картинку превью рисует `ImageResponse` из `next/og`, внутри него
 * satori, а satori читает только ttf/otf/woff. Шрифты лендинга лежат в
 * `@fontsource-variable/*`, и там есть ТОЛЬКО woff2. Без своего шрифта satori берёт
 * встроенный Noto Sans с одной латиницей, и вместо кириллицы на превью — пустые квадраты.
 *
 * Другие пути хуже:
 *   - пакет со статическими ttf/woff — новая зависимость ради одной картинки;
 *   - тянуть шрифт с Google Fonts на сборке — сборка начинает зависеть от чужой сети, а
 *     образ собирается и там, где её нет;
 *   - положить ttf в репозиторий — вторая копия шрифта, которая разъедется с пакетом.
 * WOFF2 же — это тот же sfnt, сжатый Brotli, а Brotli есть в самом Node (`node:zlib`).
 * Остаётся обратить единственное преобразование, которое делает упаковщик, — таблицу
 * glyf (формат: https://www.w3.org/TR/WOFF2/#glyf_table_format).
 *
 * Чего здесь нет — и сознательно:
 *   - коллекций шрифтов (ttcf) и преобразованной hmtx: в файлах fontsource их нет, и при
 *     встрече с ними функция падает с понятной ошибкой, а не рисует мусор;
 *   - проверки контрольных сумм: файл приходит из lock-файла, а не из сети.
 *
 * Код выполняется только на сборке: картинка без динамических данных, Next
 * пререндерит её один раз, и на проде отдаётся готовый PNG.
 */

/**
 * Теги таблиц, которые WOFF2 кодирует индексом вместо четырёх байт (§5.1 спецификации).
 * Порядок значим — индекс и есть позиция, — поэтому запись плотная, как таблица в стандарте.
 */
// prettier-ignore
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf',
  'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT',
  'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT',
  'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar',
  'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd',
  'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
]

/** Курсор по буферу: все потоки WOFF2 читаются последовательно, без возвратов. */
class Reader {
  offset = 0

  constructor(private readonly buf: Buffer) {}

  u8(): number {
    return this.buf.readUInt8(this.offset++)
  }

  u16(): number {
    const v = this.buf.readUInt16BE(this.offset)
    this.offset += 2
    return v
  }

  i16(): number {
    const v = this.buf.readInt16BE(this.offset)
    this.offset += 2
    return v
  }

  u32(): number {
    const v = this.buf.readUInt32BE(this.offset)
    this.offset += 4
    return v
  }

  bytes(length: number): Buffer {
    const v = this.buf.subarray(this.offset, this.offset + length)
    if (v.length !== length) throw new Error('WOFF2: поток короче заявленного')
    this.offset += length
    return v
  }

  /** Уже прочитанные байты — от `start` до текущей позиции. */
  bytesFrom(start: number): Buffer {
    return this.buf.subarray(start, this.offset)
  }

  /** UIntBase128 — длины таблиц в каталоге. */
  base128(): number {
    let value = 0
    for (let i = 0; i < 5; i++) {
      const byte = this.u8()
      value = value * 128 + (byte & 0x7f)
      if (!(byte & 0x80)) return value
    }
    throw new Error('WOFF2: битое число UIntBase128')
  }

  /** 255UInt16 — число точек контура и длины инструкций в потоках glyf. */
  u255(): number {
    const code = this.u8()
    if (code === 253) return this.u16()
    if (code === 255) return this.u8() + 253
    if (code === 254) return this.u8() + 253 * 2
    return code
  }
}

/**
 * Таблицы вариативного шрифта, которые выбрасываются при распаковке.
 *
 * Satori рисует своей сборкой opentype.js, а она падает на fvar («Cannot read properties
 * of undefined») — из неё вырезан разбор таблицы name, на которую fvar ссылается. Оси
 * вариаций satori всё равно не применяет, поэтому без этих таблиц шрифт ведёт себя как
 * статический в начертании по умолчанию — и только.
 */
const VARIATION_TABLES = new Set(['fvar', 'gvar', 'avar', 'cvar', 'HVAR', 'VVAR', 'MVAR', 'STAT'])

interface TableEntry {
  tag: string
  transformed: boolean
  length: number
}

export function woff2ToTtf(input: Buffer): Buffer {
  const r = new Reader(input)
  if (r.bytes(4).toString('latin1') !== 'wOF2') throw new Error('WOFF2: не тот формат файла')
  const flavor = r.u32()
  if (flavor === 0x74746366) throw new Error('WOFF2: коллекции шрифтов не поддерживаются')
  r.u32() // length
  const numTables = r.u16()
  r.u16() // reserved
  r.u32() // totalSfntSize
  const compressedSize = r.u32()
  r.offset = 48 // остаток заголовка — версия и метаданные, для отрисовки не нужны

  const entries: TableEntry[] = []
  for (let i = 0; i < numTables; i++) {
    const flags = r.u8()
    const index = flags & 0x3f
    const tag = index === 63 ? r.bytes(4).toString('latin1') : KNOWN_TAGS[index]
    if (!tag) throw new Error(`WOFF2: неизвестный индекс таблицы ${index}`)
    const version = flags >> 6
    // У glyf и loca «без преобразования» — версия 3, у остальных — 0.
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0
    const origLength = r.base128()
    const length = transformed ? r.base128() : origLength
    if (transformed && tag !== 'glyf' && tag !== 'loca') {
      throw new Error(`WOFF2: преобразование таблицы ${tag} не поддерживается`)
    }
    entries.push({ tag, transformed, length })
  }

  const data = brotliDecompressSync(input.subarray(r.offset, r.offset + compressedSize))

  const tables = new Map<string, Buffer>()
  let cursor = 0
  for (const entry of entries) {
    if (!VARIATION_TABLES.has(entry.tag)) {
      tables.set(entry.tag, data.subarray(cursor, cursor + entry.length))
    }
    cursor += entry.length
  }

  if (entries.find((e) => e.tag === 'glyf')?.transformed) {
    const { glyf, loca } = reconstructGlyf(tables.get('glyf')!)
    tables.set('glyf', glyf)
    tables.set('loca', loca)
    // loca собирается в длинном формате (смещения uint32): так не нужно следить, влезет
    // ли пересобранная glyf в 128 КБ короткого формата. head обязан сказать то же самое.
    const head = Buffer.from(tables.get('head')!)
    head.writeInt16BE(1, 50) // indexToLocFormat
    tables.set('head', head)
  }

  return buildSfnt(flavor, tables)
}

/** Флаги компонента составного глифа, влияющие на длину записи. */
const ARG_1_AND_2_ARE_WORDS = 0x0001
const WE_HAVE_A_SCALE = 0x0008
const MORE_COMPONENTS = 0x0020
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
const WE_HAVE_A_TWO_BY_TWO = 0x0080
const WE_HAVE_INSTRUCTIONS = 0x0100

/** Обратное преобразование таблицы glyf (§5.1 спецификации WOFF2) с пересборкой loca. */
function reconstructGlyf(table: Buffer): { glyf: Buffer; loca: Buffer } {
  const head = new Reader(table)
  head.u16() // reserved
  const optionFlags = head.u16()
  const numGlyphs = head.u16()
  head.u16() // indexFormat — заменяется длинным форматом, см. выше
  const sizes = Array.from({ length: 7 }, () => head.u32())

  let offset = head.offset
  const stream = (size: number) => {
    const s = new Reader(table.subarray(offset, offset + size))
    offset += size
    return s
  }
  const nContourStream = stream(sizes[0]!)
  const nPointsStream = stream(sizes[1]!)
  const flagStream = stream(sizes[2]!)
  const glyphStream = stream(sizes[3]!)
  const compositeStream = stream(sizes[4]!)
  const bboxStream = stream(sizes[5]!)
  const instructionStream = stream(sizes[6]!)
  const overlapBitmap =
    optionFlags & 1 ? table.subarray(offset, offset + ((numGlyphs + 7) >> 3)) : null

  // Битовая карта «у глифа явная рамка» идёт в начале потока рамок, выровненная по 4 байта.
  const bboxBitmap = bboxStream.bytes(4 * ((numGlyphs + 31) >> 5))
  const bit = (bitmap: Buffer, i: number) => (bitmap[i >> 3]! & (0x80 >> (i & 7))) !== 0

  const glyphs: Buffer[] = []
  for (let i = 0; i < numGlyphs; i++) {
    const nContours = nContourStream.i16()
    const explicitBbox = bit(bboxBitmap, i)

    if (nContours === 0) {
      glyphs.push(Buffer.alloc(0))
      continue
    }

    if (nContours > 0) {
      const endPts: number[] = []
      let nPoints = 0
      for (let c = 0; c < nContours; c++) {
        nPoints += nPointsStream.u255()
        endPts.push(nPoints - 1)
      }
      const points = decodeTriplets(flagStream, glyphStream, nPoints)
      const instructions = instructionStream.bytes(glyphStream.u255())
      const bbox = explicitBbox ? readBbox(bboxStream) : computeBbox(points)
      const overlap = overlapBitmap !== null && bit(overlapBitmap, i)
      glyphs.push(encodeSimpleGlyph(nContours, bbox, endPts, instructions, points, overlap))
      continue
    }

    // Составной глиф: записи компонентов копируются как есть, рамка всегда явная.
    const start = compositeStream.offset
    let hasInstructions = false
    let flags: number
    do {
      flags = compositeStream.u16()
      compositeStream.u16() // glyphIndex
      compositeStream.bytes(flags & ARG_1_AND_2_ARE_WORDS ? 4 : 2)
      if (flags & WE_HAVE_A_SCALE) compositeStream.bytes(2)
      else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) compositeStream.bytes(4)
      else if (flags & WE_HAVE_A_TWO_BY_TWO) compositeStream.bytes(8)
      if (flags & WE_HAVE_INSTRUCTIONS) hasInstructions = true
    } while (flags & MORE_COMPONENTS)
    const components = compositeStream.bytesFrom(start)
    const bbox = readBbox(bboxStream)

    const parts = [glyphHeader(-1, bbox), components]
    if (hasInstructions) {
      const length = glyphStream.u255()
      const size = Buffer.alloc(2)
      size.writeUInt16BE(length)
      parts.push(size, instructionStream.bytes(length))
    }
    glyphs.push(Buffer.concat(parts))
  }

  // Каждый глиф выравнивается по 4 байта — смещения в loca считаются уже с выравниванием.
  const loca = Buffer.alloc(4 * (numGlyphs + 1))
  const padded: Buffer[] = []
  let position = 0
  glyphs.forEach((glyph, i) => {
    loca.writeUInt32BE(position, 4 * i)
    const pad = (4 - (glyph.length % 4)) % 4
    padded.push(glyph, Buffer.alloc(pad))
    position += glyph.length + pad
  })
  loca.writeUInt32BE(position, 4 * numGlyphs)

  return { glyf: Buffer.concat(padded), loca }
}

interface Point {
  dx: number
  dy: number
  x: number
  y: number
  onCurve: boolean
}

/**
 * Координаты точек: флаг из потока флагов задаёт, сколько байт координат прочесть из
 * потока глифов и как их разложить по dx/dy. Таблица — §5.2 спецификации WOFF2.
 */
function decodeTriplets(flagStream: Reader, glyphStream: Reader, nPoints: number): Point[] {
  const withSign = (flag: number, value: number) => (flag & 1 ? value : -value)
  const points: Point[] = []
  let x = 0
  let y = 0
  for (let i = 0; i < nPoints; i++) {
    const raw = flagStream.u8()
    const onCurve = !(raw >> 7)
    const flag = raw & 0x7f
    let dx: number
    let dy: number
    if (flag < 10) {
      dx = 0
      dy = withSign(flag, ((flag & 14) << 7) + glyphStream.u8())
    } else if (flag < 20) {
      dx = withSign(flag, (((flag - 10) & 14) << 7) + glyphStream.u8())
      dy = 0
    } else if (flag < 84) {
      const b0 = flag - 20
      const b1 = glyphStream.u8()
      dx = withSign(flag, 1 + (b0 & 0x30) + (b1 >> 4))
      dy = withSign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f))
    } else if (flag < 120) {
      const b0 = flag - 84
      const b1 = glyphStream.u8()
      const b2 = glyphStream.u8()
      dx = withSign(flag, 1 + (Math.floor(b0 / 12) << 8) + b1)
      dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + b2)
    } else if (flag < 124) {
      const b1 = glyphStream.u8()
      const b2 = glyphStream.u8()
      const b3 = glyphStream.u8()
      dx = withSign(flag, (b1 << 4) + (b2 >> 4))
      dy = withSign(flag >> 1, ((b2 & 0x0f) << 8) + b3)
    } else {
      const b1 = glyphStream.u8()
      const b2 = glyphStream.u8()
      const b3 = glyphStream.u8()
      const b4 = glyphStream.u8()
      dx = withSign(flag, (b1 << 8) + b2)
      dy = withSign(flag >> 1, (b3 << 8) + b4)
    }
    x += dx
    y += dy
    points.push({ dx, dy, x, y, onCurve })
  }
  return points
}

type Bbox = [xMin: number, yMin: number, xMax: number, yMax: number]

function readBbox(stream: Reader): Bbox {
  return [stream.i16(), stream.i16(), stream.i16(), stream.i16()]
}

function computeBbox(points: Point[]): Bbox {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function glyphHeader(nContours: number, [xMin, yMin, xMax, yMax]: Bbox): Buffer {
  const header = Buffer.alloc(10)
  header.writeInt16BE(nContours, 0)
  header.writeInt16BE(xMin, 2)
  header.writeInt16BE(yMin, 4)
  header.writeInt16BE(xMax, 6)
  header.writeInt16BE(yMax, 8)
  return header
}

/** Флаги точки простого глифа в TrueType. */
const ON_CURVE = 0x01
const X_SHORT = 0x02
const Y_SHORT = 0x04
const X_SAME_OR_POSITIVE = 0x10
const Y_SAME_OR_POSITIVE = 0x20
const OVERLAP_SIMPLE = 0x40

/**
 * Простой глиф в формате TrueType. Флаги не сжимаются повтором (REPEAT) — файл живёт
 * в памяти сборки несколько миллисекунд, экономить на нём байты незачем.
 */
function encodeSimpleGlyph(
  nContours: number,
  bbox: Bbox,
  endPts: number[],
  instructions: Buffer,
  points: Point[],
  overlap: boolean,
): Buffer {
  const head = Buffer.alloc(2 * endPts.length + 2)
  endPts.forEach((end, i) => head.writeUInt16BE(end, 2 * i))
  head.writeUInt16BE(instructions.length, 2 * endPts.length)

  const flags: number[] = []
  const xs: number[] = []
  const ys: number[] = []
  // Координата: ноль не пишется вовсе, малая — одним байтом со знаком во флаге, остальное —
  // int16. Байты int16 кладём старшим вперёд прямо в массив.
  const coord = (delta: number, out: number[], short: number, same: number) => {
    if (delta === 0) return same
    if (delta > -256 && delta < 256) {
      out.push(Math.abs(delta))
      return short | (delta > 0 ? same : 0)
    }
    out.push((delta >> 8) & 0xff, delta & 0xff)
    return 0
  }
  points.forEach((p, i) => {
    let flag = p.onCurve ? ON_CURVE : 0
    if (overlap && i === 0) flag |= OVERLAP_SIMPLE
    flag |= coord(p.dx, xs, X_SHORT, X_SAME_OR_POSITIVE)
    flag |= coord(p.dy, ys, Y_SHORT, Y_SAME_OR_POSITIVE)
    flags.push(flag)
  })

  return Buffer.concat([
    glyphHeader(nContours, bbox),
    head,
    instructions,
    Buffer.from(flags),
    Buffer.from(xs),
    Buffer.from(ys),
  ])
}

/** Сборка sfnt: каталог таблиц по алфавиту тегов, данные выровнены по 4 байта. */
function buildSfnt(flavor: number, tables: Map<string, Buffer>): Buffer {
  const tags = [...tables.keys()].sort()
  const numTables = tags.length
  const log2 = Math.floor(Math.log2(numTables))
  const searchRange = 16 * 2 ** log2

  const header = Buffer.alloc(12 + 16 * numTables)
  header.writeUInt32BE(flavor, 0)
  header.writeUInt16BE(numTables, 4)
  header.writeUInt16BE(searchRange, 6)
  header.writeUInt16BE(log2, 8)
  header.writeUInt16BE(numTables * 16 - searchRange, 10)

  const body: Buffer[] = []
  let offset = header.length
  tags.forEach((tag, i) => {
    const data = tables.get(tag)!
    const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)])
    const record = 12 + 16 * i
    header.write(tag, record, 4, 'latin1')
    header.writeUInt32BE(checksum(padded), record + 4)
    header.writeUInt32BE(offset, record + 8)
    header.writeUInt32BE(data.length, record + 12)
    body.push(padded)
    offset += padded.length
  })

  return Buffer.concat([header, ...body])
}

function checksum(padded: Buffer): number {
  let sum = 0
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0
  return sum
}
