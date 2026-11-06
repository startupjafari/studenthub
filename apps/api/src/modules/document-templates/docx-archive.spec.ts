import PizZip from 'pizzip'
import { DocxFileRejected, inspectDocxArchive } from './docx-archive'
import {
  buildDocx,
  paragraph,
  patchDeclaredSize,
  patchEncrypted,
} from './__testing__/docx-fixtures'

function problemOf(buffer: Buffer): string | null {
  try {
    inspectDocxArchive(buffer)
    return null
  } catch (error) {
    if (error instanceof DocxFileRejected) return error.problem
    throw error
  }
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'

describe('inspectDocxArchive — проверка DOCX до шаблонизатора', () => {
  it('принимает обычный документ Word', () => {
    const result = inspectDocxArchive(buildDocx({ body: paragraph('{student.fullName}') }))
    expect(result.parts).toEqual(
      expect.arrayContaining(['word/document.xml', '[Content_Types].xml']),
    )
  })

  it('повреждённый файл и обрезанный архив — CORRUPTED', () => {
    expect(problemOf(Buffer.from('это не архив, а просто текст достаточной длины'))).toBe(
      'CORRUPTED',
    )
    const docx = buildDocx()
    expect(problemOf(docx.subarray(0, Math.floor(docx.length / 2)))).toBe('CORRUPTED')
  })

  it('zip без [Content_Types].xml — не документ Word', () => {
    expect(problemOf(buildDocx({ noContentTypes: true }))).toBe('NOT_WORD_DOCUMENT')
  })

  it('произвольный zip-архив — не документ Word', () => {
    const zip = new PizZip()
    zip.file('readme.txt', 'привет')
    expect(problemOf(zip.generate({ type: 'nodebuffer' }) as Buffer)).toBe('NOT_WORD_DOCUMENT')
  })

  it('.dotx (шаблон Word) — не документ', () => {
    const dotx = buildDocx({
      mainContentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
    })
    expect(problemOf(dotx)).toBe('NOT_WORD_DOCUMENT')
  })

  it('.docm и проект VBA — MACROS', () => {
    const docm = buildDocx({
      mainContentType: 'application/vnd.ms-word.document.macroEnabled.main+xml',
    })
    expect(problemOf(docm)).toBe('MACROS')
    const vba = buildDocx({ extraFiles: { 'word/vbaProject.bin': Buffer.from([1, 2, 3]) } })
    expect(problemOf(vba)).toBe('MACROS')
  })

  it('ActiveX и OLE-объекты — ACTIVE_CONTENT', () => {
    expect(problemOf(buildDocx({ extraFiles: { 'word/activeX/activeX1.xml': '<ax/>' } }))).toBe(
      'ACTIVE_CONTENT',
    )
    expect(
      problemOf(buildDocx({ extraFiles: { 'word/embeddings/oleObject1.bin': Buffer.from([0]) } })),
    ).toBe('ACTIVE_CONTENT')
    expect(
      problemOf(
        buildDocx({
          extraRels: `<Relationship Id="rId9" Type="${REL}oleObject" Target="embeddings/x.xlsx"/>`,
        }),
      ),
    ).toBe('ACTIVE_CONTENT')
  })

  it('внешний шаблон — EXTERNAL_CONTENT, а обычная внешняя ссылка допустима', () => {
    const remote = buildDocx({
      extraRels: `<Relationship Id="rId9" Type="${REL}attachedTemplate" Target="https://evil.example/t.dotm" TargetMode="External"/>`,
    })
    expect(problemOf(remote)).toBe('EXTERNAL_CONTENT')
    const link = buildDocx({
      extraRels: `<Relationship Id="rId9" Type="${REL}hyperlink" Target="https://example.edu" TargetMode="External"/>`,
    })
    expect(problemOf(link)).toBeNull()
  })

  it('zip-бомба по степени сжатия — TOO_COMPLEX', () => {
    const bomb = buildDocx({
      extraFiles: { 'word/media/zeros.bin': Buffer.alloc(5 * 1024 * 1024) },
    })
    expect(problemOf(bomb)).toBe('TOO_COMPLEX')
  })

  it('часть, которая распаковывается больше заявленного, — TOO_COMPLEX', () => {
    const docx = buildDocx({ extraFiles: { 'word/media/pad.txt': 'А'.repeat(50_000) } })
    expect(problemOf(patchDeclaredSize(docx, 'word/media/pad.txt', 100))).toBe('TOO_COMPLEX')
  })

  it('слишком много частей — TOO_COMPLEX', () => {
    const extraFiles: Record<string, string> = {}
    for (let i = 0; i < 1001; i++) extraFiles[`word/media/p${i}.txt`] = 'x'
    expect(problemOf(buildDocx({ extraFiles }))).toBe('TOO_COMPLEX')
  })

  it('зашифрованная часть — ENCRYPTED', () => {
    expect(problemOf(patchEncrypted(buildDocx(), 'word/document.xml'))).toBe('ENCRYPTED')
  })

  it('имя части с выходом из каталога — CORRUPTED', () => {
    expect(problemOf(buildDocx({ extraFiles: { '../evil.xml': '<x/>' } }))).toBe('CORRUPTED')
  })
})
