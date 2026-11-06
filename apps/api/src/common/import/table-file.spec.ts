import { deflateRawSync } from 'node:zlib'
import { readTableFile } from './table-file'

const LIMITS = { maxRows: 100, maxColumns: 10 }

/** Минимальный zip: записи deflate, локальные заголовки, центральный каталог и его конец. */
function zipOf(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const packed = deflateRawSync(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, packed)
    centrals.push(central, name)
    offset += local.length + name.length + packed.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

describe('readTableFile — XLSX-бомба (BUG-390)', () => {
  it('архив, распаковывающийся больше потолка, отклоняется до разбора', () => {
    // 60 МБ нулей сжимаются в десятки килобайт — классическая бомба.
    const bomb = zipOf([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(60 * 1024 * 1024) }])
    expect(bomb.length).toBeLessThan(1024 * 1024)

    expect(() => readTableFile(bomb, 'list.xlsx', LIMITS)).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    )
  })

  it('потолок общий на все записи, а не на каждую', () => {
    const parts = Array.from({ length: 4 }, (_, i) => ({
      name: `xl/part${i}.xml`,
      data: Buffer.alloc(15 * 1024 * 1024),
    }))

    expect(() => readTableFile(zipOf(parts), 'list.xlsx', LIMITS)).toThrow(
      expect.objectContaining({ message: expect.stringContaining('слишком большой объём') }),
    )
  })

  it('битый zip — BAD_REQUEST, а не падение процесса', () => {
    const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)])

    expect(() => readTableFile(broken, 'list.xlsx', LIMITS)).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    )
  })

  it('CSV проверка архива не касается', () => {
    expect(readTableFile(Buffer.from('a,b\n1,2\n'), 'list.csv', LIMITS)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})
