// Генератор образцов КАЖДОГО формата, который принимает платформа (FILE_UPLOAD.ALLOWED_MIME в
// packages/shared-config): картинки, видео, документы Office и PDF, аудио, архивы.
//
// Зачем: медиа-пул сида — это фото и видео с внешних сайтов. Документов, голосовых, музыки и
// архивов там нет, и экраны, которые их показывают (вложения чата «Файлы/Голосовые/Музыка»,
// материалы курса, сдача заданий, сканы документов), на демо-данных проверить было нечем.
// Образцы настоящие: PDF открывается, DOCX/XLSX/PPTX читает Office, архивы распаковываются,
// аудио и видео играют. Каждый — несколько килобайт.
//
// Запуск (после правки содержимого): `node prisma/seed/formats/generate.mjs`.
// Файлы и манифест `formats.json` перезаписываются и коммитятся: на машине, где сид только
// заливает образцы (CI, Railway), не нужны ни ffmpeg, ни tar/bzip2/xz, ни шрифты.
//
// Нужны: ffmpeg/ffprobe (libx264, libvpx-vp9, libopus, libmp3lame, aac), tar, bzip2, xz.
// RAR и 7z собираются здесь же вручную (без сжатия, «store»/«copy»): свободных
// упаковщиков RAR не существует, а 7z на машине может не быть.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'

const requireFromApi = createRequire(new URL('../../../apps/api/package.json', import.meta.url))
const sharp = requireFromApi('sharp')
const PizZip = requireFromApi('pizzip')
const XLSX = requireFromApi('xlsx')

const OUT_DIR = fileURLToPath(new URL('./files/', import.meta.url))
const MANIFEST = fileURLToPath(new URL('./formats.json', import.meta.url))
// Фиксированная дата внутри архивов и Office-файлов: байты не меняются от запуска к запуску.
const FIXED_DATE = new Date('2026-09-01T09:00:00Z')
const FIXED_EPOCH = Math.floor(FIXED_DATE.getTime() / 1000)

const escapeXml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], ...opts })
}

// ── Картинки ────────────────────────────────────────────────────────────────

/** Карточка-«скриншот конспекта»: тот же рисунок во всех растровых форматах. */
function cardSvg(width, height, title, lines) {
  const rows = lines
    .map(
      (line, i) =>
        `<text x="48" y="${170 + i * 44}" font-family="sans-serif" font-size="26" fill="#1f2937">${escapeXml(line)}</text>`,
    )
    .join('')
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#f8fafc"/>
      <rect x="0" y="0" width="100%" height="96" fill="#2b72e5"/>
      <text x="48" y="62" font-family="sans-serif" font-size="34" font-weight="700" fill="#ffffff">${escapeXml(title)}</text>
      ${rows}
    </svg>`,
  )
}

const CARD_LINES = [
  'Тема: производная сложной функции',
  "(f(g(x)))' = f'(g(x)) · g'(x)",
  "Пример: (sin x²)' = 2x · cos x²",
  'К семинару: № 214–220 из задачника',
]

async function makeImages(dir) {
  const svg = cardSvg(800, 450, 'Конспект — Матанализ', CARD_LINES)
  await sharp(svg).jpeg({ quality: 78 }).toFile(join(dir, 'image.jpg'))
  await sharp(svg).png({ compressionLevel: 9, palette: true }).toFile(join(dir, 'image.png'))
  await sharp(svg).webp({ quality: 75 }).toFile(join(dir, 'image.webp'))
  // Анимированный GIF: ffmpeg из тестового источника, маленький и короткий.
  run('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=240x160:rate=10:duration=2',
    '-vf', 'split[a][b];[a]palettegen=max_colors=32[p];[b][p]paletteuse',
    '-loop', '0', join(dir, 'image.gif'),
  ]) // prettier-ignore
}

// ── Видео ───────────────────────────────────────────────────────────────────

function makeVideos(dir) {
  const input = [
    '-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=24:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-shortest', '-map_metadata', '-1',
  ] // prettier-ignore
  const h264 = ['-c:v', 'libx264', '-preset', 'veryslow', '-crf', '34', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '48k'] // prettier-ignore
  run('ffmpeg', ['-y', ...input, ...h264, '-movflags', '+faststart', join(dir, 'video.mp4')])
  run('ffmpeg', ['-y', ...input, ...h264, '-f', 'mov', join(dir, 'video.mov')])
  run('ffmpeg', ['-y', ...input, '-c:v', 'libvpx-vp9', '-b:v', '120k', '-c:a', 'libopus', '-b:a', '32k', join(dir, 'video.webm')]) // prettier-ignore
}

// ── Аудио ───────────────────────────────────────────────────────────────────

function makeAudio(dir) {
  // «Голос»: низкий тон с прерывистой огибающей — на волноформе похоже на речь, а не на гудок.
  const voice = ['-f', 'lavfi', '-i', 'sine=frequency=170:duration=6', '-af', 'tremolo=f=3.5:d=0.95,volume=0.8', '-ac', '1', '-map_metadata', '-1'] // prettier-ignore
  run('ffmpeg', ['-y', ...voice, '-c:a', 'libopus', '-b:a', '24k', join(dir, 'voice.ogg')])
  run('ffmpeg', ['-y', ...voice, '-c:a', 'libopus', '-b:a', '24k', '-f', 'webm', join(dir, 'voice.webm')]) // prettier-ignore
  run('ffmpeg', ['-y', ...voice, '-c:a', 'aac', '-b:a', '32k', '-f', 'ipod', join(dir, 'voice.m4a')]) // prettier-ignore
  // «Музыка»: аккорд из трёх тонов, стерео.
  const music = [
    '-f', 'lavfi', '-i', 'sine=frequency=261.63:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=329.63:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=392.00:duration=8',
    '-filter_complex', 'amix=inputs=3,volume=1.5,afade=t=out:st=6:d=2', '-map_metadata', '-1',
  ] // prettier-ignore
  run('ffmpeg', ['-y', ...music, '-c:a', 'libmp3lame', '-b:a', '64k', join(dir, 'music.mp3')])
  // Аудиокнига: бренд M4B — именно по нему file-type называет MP4-аудио audio/mp4.
  run('ffmpeg', ['-y', ...music, '-c:a', 'aac', '-b:a', '64k', '-f', 'mp4', '-brand', 'M4B ', join(dir, 'audiobook.m4b')]) // prettier-ignore
  run('ffmpeg', ['-y', ...music, '-ac', '1', '-ar', '8000', '-c:a', 'pcm_s16le', join(dir, 'music.wav')]) // prettier-ignore
}

// ── PDF ─────────────────────────────────────────────────────────────────────

/**
 * PDF из растровых страниц: каждая страница — JPEG (DCTDecode) на весь лист A4. Текст с
 * кириллицей рисует sharp из SVG, поэтому в PDF не нужно встраивать шрифт.
 */
function pdfFromJpegs(pages) {
  const objects = []
  const add = (body) => {
    objects.push(body)
    return objects.length
  }
  const catalog = add(null)
  const pagesId = add(null)
  const kids = []
  for (const [i, page] of pages.entries()) {
    const image = add(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
        ),
        page.jpeg,
        Buffer.from('\nendstream'),
      ]),
    )
    const draw = `q 595 0 0 842 0 0 cm /Im${i} Do Q`
    const content = add(Buffer.from(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`))
    kids.push(
      add(
        Buffer.from(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] ` +
            `/Resources << /XObject << /Im${i} ${image} 0 R >> >> /Contents ${content} 0 R >>`,
        ),
      ),
    )
  }
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  objects[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`,
  )
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')]
  const offsets = []
  let offset = chunks[0].length
  for (const [i, body] of objects.entries()) {
    offsets.push(offset)
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')])
    chunks.push(chunk)
    offset += chunk.length
  }
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  chunks.push(Buffer.from(xref))
  return Buffer.concat(chunks)
}

async function makePdf(dir) {
  const width = 827
  const height = 1169
  const page = async (title, lines) => {
    const svg = cardSvg(width, height, title, lines)
    return { width, height, jpeg: await sharp(svg).jpeg({ quality: 60 }).toBuffer() }
  }
  const pages = [
    await page('Лекция 3. Производная', [
      '1. Определение производной',
      '2. Геометрический смысл',
      '3. Правила дифференцирования',
      ...CARD_LINES,
    ]),
    await page('Задания к семинару', [
      '№ 214. Найти производную y = x³ · ln x',
      '№ 215. Найти производную y = e^(2x) · cos x',
      '№ 216. Касательная к y = √x в точке x = 4',
      'Срок сдачи — до следующего занятия',
    ]),
  ]
  writeFileSync(join(dir, 'document.pdf'), pdfFromJpegs(pages))
}

// ── Office: DOCX, XLSX, PPTX ────────────────────────────────────────────────

function zipOffice(files) {
  const zip = new PizZip()
  for (const [path, content] of Object.entries(files)) zip.file(path, content, { date: FIXED_DATE })
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function makeDocx(dir) {
  const para = (text, style) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  const cell = (text) =>
    `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${para(text)}</w:tc>`
  const row = (cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`
  const table =
    '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/>' +
    '<w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    [
      ['Этап', 'Срок', 'Отметка'],
      ['Выбор темы', '15.09', 'выполнено'],
      ['Обзор литературы', '15.10', 'выполнено'],
      ['Черновик', '01.12', 'в работе'],
    ]
      .map(row)
      .join('') +
    '</w:tbl>'
  const body = [
    para('Курсовая работа: план и требования', 'Heading1'),
    para('Тема: «Применение производной к исследованию функций».'),
    para(
      'Объём — 25–30 страниц, шрифт 14 pt, интервал 1,5. Список литературы — не менее 15 источников.',
    ),
    table,
    para('Научный руководитель: доцент кафедры высшей математики.'),
  ].join('')
  const files = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="28"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  }
  writeFileSync(join(dir, 'document.docx'), zipOffice(files))
}

function makeXlsx(dir) {
  const rows = [
    ['№', 'ФИО', 'Группа', 'Рубежный контроль 1', 'Рубежный контроль 2', 'Экзамен', 'Итог'],
    [1, 'Абдрахманов Ерлан', 'МАТ-21', 88, 91, 85],
    [2, 'Ким Алина', 'МАТ-21', 95, 93, 97],
    [3, 'Сейтказиева Дана', 'МАТ-21', 72, 80, 76],
    [4, 'Петров Никита', 'МАТ-21', 64, 70, 68],
    [5, 'Нурланова Айгерим', 'МАТ-21', 90, 86, 92],
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  // Итог — формулой: файл открывается «живой» ведомостью, а не снимком чисел.
  for (let r = 2; r <= rows.length; r += 1) {
    sheet[`G${r}`] = { t: 'n', f: `ROUND(D${r}*0.3+E${r}*0.3+F${r}*0.4,0)` }
  }
  sheet['!ref'] = `A1:G${rows.length}`
  sheet['!cols'] = [
    { wch: 4 },
    { wch: 24 },
    { wch: 10 },
    { wch: 20 },
    { wch: 20 },
    { wch: 10 },
    { wch: 8 },
  ]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Ведомость')
  book.Props = { Title: 'Ведомость', CreatedDate: FIXED_DATE }
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true })
  writeFileSync(join(dir, 'spreadsheet.xlsx'), buffer)
}

function makePptx(dir) {
  const ns =
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
  const rel = (id, type, target) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`
  const rels = (items) =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    items.join('') +
    '</Relationships>'
  const emptyTree =
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
  const textBox = (id, y, cy, size, bold, paragraphs) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="685800" y="${y}"/><a:ext cx="10820400" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    '<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>' +
    paragraphs
      .map(
        (t) =>
          `<a:p><a:r><a:rPr lang="ru-RU" sz="${size}"${bold ? ' b="1"' : ''}/><a:t>${escapeXml(t)}</a:t></a:r></a:p>`,
      )
      .join('') +
    '</p:txBody></p:sp>'
  const slide = (title, points) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${ns}><p:cSld><p:spTree>${emptyTree}` +
    textBox(2, 457200, 1143000, 4000, true, [title]) +
    textBox(3, 1828800, 4114800, 2400, false, points) +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
  const color = (name, hex) => `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  const line = `<a:ln w="9525">${solid}</a:ln>`
  const theme =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="StudentHub"><a:themeElements>' +
    '<a:clrScheme name="StudentHub">' +
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    color('dk2', '1F2937') + color('lt2', 'F8FAFC') + color('accent1', '2B72E5') + color('accent2', '22C55E') +
    color('accent3', 'FACC15') + color('accent4', 'EF4444') + color('accent5', '8B5CF6') + color('accent6', '06B6D4') +
    color('hlink', '2B72E5') + color('folHlink', '8B5CF6') +
    '</a:clrScheme>' +
    '<a:fontScheme name="StudentHub"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="StudentHub">' +
    `<a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst>` +
    `<a:lnStyleLst>${line}${line}${line}</a:lnStyleLst>` +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst>` +
    '</a:fmtScheme></a:themeElements></a:theme>' // prettier-ignore
  const clrMap =
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ' +
    'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
  const slides = [
    slide('Производная и её применение', [
      'Лекция 3 · Математический анализ',
      'Кафедра высшей математики',
    ]),
    slide('План лекции', [
      '1. Определение производной',
      '2. Геометрический и физический смысл',
      '3. Правила дифференцирования',
      '4. Задачи к семинару',
    ]),
  ]
  const files = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      slides
        .map(
          (_, i) =>
            `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
        )
        .join('') +
      '</Types>',
    '_rels/.rels': rels([rel('rId1', 'officeDocument', 'ppt/presentation.xml')]),
    'ppt/presentation.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${ns}>` +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst>` +
      '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels([
      rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'),
      rel('rId2', 'theme', 'theme/theme1.xml'),
      ...slides.map((_, i) => rel(`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`)),
    ]),
    'ppt/slideMasters/slideMaster1.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${ns}>` +
      `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${emptyTree}</p:spTree></p:cSld>` +
      `${clrMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([
      rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'),
      rel('rId2', 'theme', '../theme/theme1.xml'),
    ]),
    'ppt/slideLayouts/slideLayout1.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${ns} type="blank" preserve="1">` +
      `<p:cSld name="Пустой"><p:spTree>${emptyTree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([
      rel('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml'),
    ]),
    'ppt/theme/theme1.xml': theme,
  }
  slides.forEach((xml, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = xml
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([
      rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'),
    ])
  })
  writeFileSync(join(dir, 'presentation.pptx'), zipOffice(files))
}

// ── Архивы ──────────────────────────────────────────────────────────────────

/** Содержимое всех архивов: два текстовых файла (имена с кириллицей — проверка кодировки). */
const ARCHIVE_ENTRIES = [
  {
    name: 'README.txt',
    data: Buffer.from(
      'Материалы к семинару по математическому анализу.\n' +
        'В архиве: условия задач и краткий конспект.\n',
    ),
  },
  {
    name: 'Задачи.txt',
    data: Buffer.from(
      '№ 214. y = x³ · ln x\n№ 215. y = e^(2x) · cos x\n№ 216. Касательная к y = √x в точке x = 4\n',
    ),
  },
]

function makeZip(dir) {
  const zip = new PizZip()
  for (const entry of ARCHIVE_ENTRIES) zip.file(entry.name, entry.data, { date: FIXED_DATE })
  writeFileSync(
    join(dir, 'archive.zip'),
    zip.generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      encodeFileName: (n) => Buffer.from(n),
    }),
  )
}

function makeTarFamily(dir) {
  const work = mkdtempSync(join(tmpdir(), 'seed-formats-'))
  try {
    for (const entry of ARCHIVE_ENTRIES) writeFileSync(join(work, entry.name), entry.data)
    const names = ARCHIVE_ENTRIES.map((e) => e.name)
    const common = ['--format=ustar', '--sort=name', `--mtime=@${FIXED_EPOCH}`, '--owner=0', '--group=0', '--numeric-owner', '-C', work] // prettier-ignore
    run('tar', ['-cf', join(dir, 'archive.tar'), ...common, ...names])
    // gzip -n: без имени и времени исходника в заголовке — байты стабильны.
    run('tar', ['-cf', join(dir, 'archive.tar.gz'), '--use-compress-program=gzip -n -9', ...common, ...names]) // prettier-ignore
    run('tar', ['-cjf', join(dir, 'archive.tar.bz2'), ...common, ...names])
    run('tar', ['-cJf', join(dir, 'archive.tar.xz'), ...common, ...names])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// RAR5 без сжатия (метод store). Формат: https://www.rarlab.com/technote.htm
function rarVint(value) {
  const bytes = []
  let v = value
  do {
    let byte = v & 0x7f
    v = Math.floor(v / 128)
    if (v > 0) byte |= 0x80
    bytes.push(byte)
  } while (v > 0)
  return Buffer.from(bytes)
}

function rarBlock(fields) {
  // Размер заголовка считается от поля «тип» до конца; CRC32 — от поля «размер».
  const body = Buffer.concat(fields)
  const withSize = Buffer.concat([rarVint(body.length), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32LE(crc32(withSize))
  return Buffer.concat([crc, withSize])
}

function makeRar(dir) {
  const u32 = (n) => {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(n >>> 0)
    return b
  }
  const parts = [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])]
  // Главный заголовок: тип 1, флагов нет, флаги архива 0.
  parts.push(rarBlock([rarVint(1), rarVint(0), rarVint(0)]))
  for (const entry of ARCHIVE_ENTRIES) {
    const name = Buffer.from(entry.name)
    parts.push(
      rarBlock([
        rarVint(2), // тип: файл
        rarVint(0x02), // флаги заголовка: есть область данных
        rarVint(entry.data.length), // размер данных (упакованный = исходный)
        rarVint(0x02 | 0x04), // флаги файла: есть время (unix, uint32) и CRC32 данных
        rarVint(entry.data.length), // исходный размер
        rarVint(0x20), // атрибуты: archive
        u32(FIXED_EPOCH),
        u32(crc32(entry.data)),
        rarVint(0), // сжатие: версия 0, метод 0 (store)
        rarVint(1), // ОС: Unix
        rarVint(name.length),
        name,
      ]),
      entry.data,
    )
  }
  // Конец архива: тип 5, флагов нет.
  parts.push(rarBlock([rarVint(5), rarVint(0), rarVint(0)]))
  writeFileSync(join(dir, 'archive.rar'), Buffer.concat(parts))
}

// 7z без сжатия (кодер Copy). Формат: DOC/7zFormat.txt из исходников 7-Zip.
function szNumber(value) {
  if (value < 0x80) return Buffer.from([value])
  if (value < 0x4000) return Buffer.from([0x80 | (value >> 8), value & 0xff])
  if (value < 0x200000) {
    return Buffer.from([0xc0 | (value >> 16), value & 0xff, (value >> 8) & 0xff])
  }
  throw new Error('7z: слишком большое число для образца')
}

function make7z(dir) {
  const packed = Buffer.concat(ARCHIVE_ENTRIES.map((e) => e.data))
  const u32 = (n) => {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(n >>> 0)
    return b
  }
  const names = Buffer.concat(
    ARCHIVE_ENTRIES.map((e) =>
      Buffer.concat([Buffer.from(e.name, 'utf16le'), Buffer.from([0, 0])]),
    ),
  )
  const header = Buffer.concat([
    Buffer.from([0x01]), // kHeader
    Buffer.from([0x04]), // kMainStreamsInfo
    Buffer.from([0x06]), szNumber(0), szNumber(1), // kPackInfo: PackPos, NumPackStreams
    Buffer.from([0x09]), szNumber(packed.length), Buffer.from([0x00]), // kSize, kEnd
    Buffer.from([0x07, 0x0b]), szNumber(1), Buffer.from([0x00]), // kUnPackInfo, kFolder, 1, не внешний
    szNumber(1), Buffer.from([0x01, 0x00]), // 1 кодер: размер id = 1, id 0x00 (Copy)
    Buffer.from([0x0c]), szNumber(packed.length), Buffer.from([0x00]), // kCodersUnPackSize, kEnd
    Buffer.from([0x08]), // kSubStreamsInfo
    Buffer.from([0x0d]), szNumber(ARCHIVE_ENTRIES.length), // kNumUnPackStream
    Buffer.from([0x09]), ...ARCHIVE_ENTRIES.slice(0, -1).map((e) => szNumber(e.data.length)), // kSize
    Buffer.from([0x0a, 0x01]), ...ARCHIVE_ENTRIES.map((e) => u32(crc32(e.data))), // kCRC, все заданы
    Buffer.from([0x00]), // kEnd (SubStreamsInfo)
    Buffer.from([0x00]), // kEnd (MainStreamsInfo)
    Buffer.from([0x05]), szNumber(ARCHIVE_ENTRIES.length), // kFilesInfo, NumFiles
    Buffer.from([0x11]), szNumber(names.length + 1), Buffer.from([0x00]), names, // kName
    Buffer.from([0x00]), // kEnd (FilesInfo)
    Buffer.from([0x00]), // kEnd (Header)
  ]) // prettier-ignore
  const startHeader = Buffer.alloc(20)
  startHeader.writeBigUInt64LE(BigInt(packed.length), 0) // NextHeaderOffset — сразу за данными
  startHeader.writeBigUInt64LE(BigInt(header.length), 8)
  startHeader.writeUInt32LE(crc32(header), 16)
  const signature = Buffer.concat([
    Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04]),
    u32(crc32(startHeader)),
    startHeader,
  ])
  writeFileSync(join(dir, 'archive.7z'), Buffer.concat([signature, packed, header]))
}

// ── Манифест ────────────────────────────────────────────────────────────────

/**
 * Каталог образцов. `names` — правдоподобные имена, под которыми файл показывается в
 * интерфейсе (сид раздаёт их по кругу); `role` уточняет смысл внутри категории:
 * голосовое (имя `voice-…` — по нему клиенты отличают голосовое от музыки) или музыка.
 */
const CATALOG = [
  { file: 'image.jpg', mime: 'image/jpeg', category: 'IMAGE', names: ['Конспект.jpg', 'Доска после пары.jpg', 'Расписание.jpg'] },
  { file: 'image.png', mime: 'image/png', category: 'IMAGE', names: ['Скриншот.png', 'Схема.png', 'График.png'] },
  { file: 'image.webp', mime: 'image/webp', category: 'IMAGE', names: ['Фото доски.webp', 'Слайд.webp'] },
  { file: 'image.gif', mime: 'image/gif', category: 'IMAGE', role: 'gif', names: ['Анимация.gif', 'reaction.gif'] },
  { file: 'video.mp4', mime: 'video/mp4', category: 'VIDEO', names: ['Запись лекции.mp4', 'Видео с практики.mp4'] },
  { file: 'video.webm', mime: 'video/webm', category: 'VIDEO', names: ['Запись экрана.webm', 'Демо проекта.webm'] },
  { file: 'video.mov', mime: 'video/quicktime', category: 'VIDEO', names: ['IMG_2048.mov', 'Видео с телефона.mov'] },
  { file: 'document.pdf', mime: 'application/pdf', category: 'DOCUMENT', names: ['Лекция 3. Производная.pdf', 'Методичка.pdf', 'Справка.pdf', 'Скан паспорта.pdf', 'Приказ.pdf'] },
  { file: 'document.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'DOCUMENT', names: ['План курсовой.docx', 'Реферат.docx', 'Заявление.docx', 'Отчёт по практике.docx'] },
  { file: 'spreadsheet.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'DOCUMENT', names: ['Ведомость.xlsx', 'Расчёты.xlsx', 'Список группы.xlsx'] },
  { file: 'presentation.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', category: 'DOCUMENT', names: ['Презентация к защите.pptx', 'Слайды лекции.pptx'] },
  { file: 'voice.ogg', mime: 'audio/ogg', category: 'AUDIO', role: 'voice', names: ['voice-message.ogg'] },
  { file: 'voice.webm', mime: 'audio/webm', category: 'AUDIO', role: 'voice', names: ['voice-message.webm'] },
  { file: 'voice.m4a', mime: 'audio/x-m4a', category: 'AUDIO', role: 'voice', names: ['voice-message.m4a'] },
  { file: 'music.mp3', mime: 'audio/mpeg', category: 'AUDIO', role: 'music', names: ['Гимн университета.mp3', 'Подкаст выпуск 4.mp3'] },
  { file: 'audiobook.m4b', mime: 'audio/mp4', category: 'AUDIO', role: 'music', names: ['Аудиокнига, глава 1.m4b', 'Лекция (аудио).m4b'] },
  { file: 'music.wav', mime: 'audio/wav', category: 'AUDIO', role: 'music', names: ['Запись диктофона.wav', 'Аудирование.wav'] },
  { file: 'archive.zip', mime: 'application/zip', category: 'ARCHIVE', names: ['Материалы к семинару.zip', 'Исходники проекта.zip'] },
  { file: 'archive.rar', mime: 'application/x-rar-compressed', category: 'ARCHIVE', names: ['Курсовая.rar', 'Фото с практики.rar'] },
  { file: 'archive.7z', mime: 'application/x-7z-compressed', category: 'ARCHIVE', names: ['Лабораторные.7z'] },
  { file: 'archive.tar.gz', mime: 'application/gzip', category: 'ARCHIVE', names: ['project.tar.gz'] },
  { file: 'archive.tar', mime: 'application/x-tar', category: 'ARCHIVE', names: ['backup.tar'] },
  { file: 'archive.tar.bz2', mime: 'application/x-bzip2', category: 'ARCHIVE', names: ['dataset.tar.bz2'] },
  { file: 'archive.tar.xz', mime: 'application/x-xz', category: 'ARCHIVE', names: ['logs.tar.xz'] },
] // prettier-ignore

function probe(path) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', path],
    { encoding: 'utf8' },
  )
  const json = JSON.parse(out)
  const video = (json.streams ?? []).find((s) => s.width)
  const duration = Number(json.format?.duration)
  return {
    ...(video ? { width: video.width, height: video.height } : {}),
    ...(Number.isFinite(duration) && duration > 0.2
      ? { durationMs: Math.round(duration * 1000) }
      : {}),
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  await makeImages(OUT_DIR)
  makeVideos(OUT_DIR)
  makeAudio(OUT_DIR)
  await makePdf(OUT_DIR)
  makeDocx(OUT_DIR)
  makeXlsx(OUT_DIR)
  makePptx(OUT_DIR)
  makeZip(OUT_DIR)
  makeTarFamily(OUT_DIR)
  makeRar(OUT_DIR)
  make7z(OUT_DIR)

  const manifest = []
  for (const item of CATALOG) {
    const path = join(OUT_DIR, item.file)
    const size = statSync(path).size
    const media = ['IMAGE', 'VIDEO', 'AUDIO'].includes(item.category) ? probe(path) : {}
    // GIF: ffprobe отдаёт длительность анимации, но для картинки она не нужна.
    if (item.category === 'IMAGE') delete media.durationMs
    manifest.push({ ...item, size, ...media })
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  const total = manifest.reduce((sum, m) => sum + m.size, 0)
  console.log(
    `Образцы форматов: ${manifest.length} файлов, ${Math.round(total / 1024)} КБ → ${OUT_DIR}`,
  )
  // Проверка самих себя: первые байты должны совпасть с тем, что увидит file-type.
  const head = (file) => readFileSync(join(OUT_DIR, file)).subarray(0, 8).toString('hex')
  console.log(`  rar ${head('archive.rar')} · 7z ${head('archive.7z')}`)
}

await main()
