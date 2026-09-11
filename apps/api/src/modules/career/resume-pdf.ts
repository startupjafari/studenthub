import { createElement as h } from 'react'
import type { PdfBranding } from '../../common/export/export-branding.types'
import { PDF_FONT_FAMILY, registerPdfFont } from '../../common/export/pdf-font'

/**
 * Сборка PDF-резюме.
 *
 * Без JSX, через `createElement`: иначе в `apps/api` пришлось бы включать JSX в tsconfig
 * ради одного файла, а это меняет сборку всего бэкенда.
 *
 * Шрифт встраивается обязательно: четырнадцать стандартных шрифтов PDF кириллицы не
 * содержат, и резюме на русском без него вышло бы пустым. Файл лежит в репозитории —
 * см. assets/fonts/README.md.
 */

// @react-pdf/renderer v4 — ESM-only. api собирается в CommonJS, где TypeScript даунлевелит
// dynamic import() в require() и падает на ESM-only пакете (ERR_REQUIRE_ESM) — тем же
// способом падал и jest, поднимая AppModule в e2e. Function-обёртка сохраняет нативный
// import() в рантайме, минуя эту трансформацию (тот же приём, что в files/mime-detector.ts).
const importEsm = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>

type ReactPdf = typeof import('@react-pdf/renderer')

function createStyles(StyleSheet: ReactPdf['StyleSheet']) {
  return StyleSheet.create({
    page: { fontFamily: PDF_FONT_FAMILY, fontSize: 10, padding: 40, color: '#111827' },
    name: { fontSize: 22, marginBottom: 2 },
    headline: { fontSize: 11, color: '#4b5563', marginBottom: 10 },
    contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    contact: { fontSize: 9, color: '#4b5563' },
    sectionTitle: {
      fontSize: 9,
      letterSpacing: 1,
      color: '#6b7280',
      marginTop: 14,
      marginBottom: 6,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
      paddingBottom: 3,
    },
    body: { fontSize: 10, lineHeight: 1.5, color: '#1f2937' },
    itemTitle: { fontSize: 10.5, marginBottom: 1 },
    itemMeta: { fontSize: 9, color: '#6b7280', marginBottom: 2 },
    item: { marginBottom: 8 },
    skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    skill: {
      fontSize: 9,
      color: '#1f2937',
      backgroundColor: '#f3f4f6',
      paddingVertical: 2,
      paddingHorizontal: 5,
      borderRadius: 3,
    },
    verified: { fontSize: 8, color: '#047857' },
    // Полоса происхождения над резюме: знак и строка «сформировано» мелко и серым.
    // Документ принадлежит студенту, а не платформе, — марка обязана быть заметной
    // ровно настолько, чтобы её нашли, когда усомнятся в подлинности.
    brandBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginBottom: 16,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
    },
    brandLogo: { width: 12, height: 12 },
    brandLine: { fontSize: 7.5, color: '#9ca3af' },
    footer: {
      position: 'absolute',
      bottom: 24,
      left: 40,
      right: 40,
      fontSize: 8,
      color: '#9ca3af',
    },
  })
}

interface PdfKit {
  pdf: ReactPdf
  styles: ReturnType<typeof createStyles>
}

let kitPromise: Promise<PdfKit> | undefined

/**
 * Ленивая загрузка рендерера: модуль тяжёлый и нужен только на выдаче PDF, а его
 * регистрация шрифта и стили — глобальные, поэтому делаются один раз на процесс
 * (`Font.register` держит глобальный реестр).
 */
function loadKit(): Promise<PdfKit> {
  kitPromise ??= importEsm<ReactPdf>('@react-pdf/renderer').then((pdf) => {
    registerPdfFont(pdf.Font)
    return { pdf, styles: createStyles(pdf.StyleSheet) }
  })
  // Неудачную загрузку не кэшируем: иначе одна ошибка (например, отсутствующий шрифт)
  // навсегда ломает выдачу PDF до перезапуска процесса.
  return kitPromise.catch((error: unknown) => {
    kitPromise = undefined
    throw error
  })
}

export interface ResumeItem {
  title: string
  organization: string | null
  period: string | null
  description: string | null
  verified: boolean
}

/** Подписи разделов резюме: PDF собирается на языке, который выбрал пользователь. */
export interface ResumeLabels {
  about: string
  education: string
  skills: string
  languages: string
  experience: string
  projects: string
  certificates: string
  verified: string
  generated: string
}

export interface ResumeData {
  fullName: string
  headline: string | null
  contacts: string[]
  about: string | null
  education: string[]
  skills: string[]
  languages: string[]
  experience: ResumeItem[]
  projects: ResumeItem[]
  certificates: ResumeItem[]
  labels: ResumeLabels
  /**
   * Происхождение документа: свойства файла, знак, шапка и колонтитул. Собирает
   * ExportBrandingService — здесь только рисуем, чтобы рендер не знал ни про конфигурацию,
   * ни про язык.
   */
  branding: PdfBranding
}

function section({ pdf, styles }: PdfKit, title: string, children: React.ReactNode) {
  return h(
    pdf.View,
    { wrap: false },
    h(pdf.Text, { style: styles.sectionTitle }, title.toUpperCase()),
    children,
  )
}

function items({ pdf, styles }: PdfKit, list: ResumeItem[], verifiedLabel: string) {
  return h(
    pdf.View,
    null,
    ...list.map((item, index) =>
      h(
        pdf.View,
        { key: String(index), style: styles.item },
        h(
          pdf.Text,
          { style: styles.itemTitle },
          item.title,
          item.verified ? h(pdf.Text, { style: styles.verified }, `  ✓ ${verifiedLabel}`) : null,
        ),
        item.organization || item.period
          ? h(
              pdf.Text,
              { style: styles.itemMeta },
              [item.organization, item.period].filter(Boolean).join(' · '),
            )
          : null,
        item.description ? h(pdf.Text, { style: styles.body }, item.description) : null,
      ),
    ),
  )
}

/** Резюме в PDF. Возвращает буфер — контроллер отдаёт его как файл. */
export async function renderResumePdf(data: ResumeData): Promise<Buffer> {
  const kit = await loadKit()
  const { pdf, styles } = kit

  const { branding } = data

  const doc = h(
    pdf.Document,
    // Свойства файла: автор — платформа, а не студент. Документ выпустила она, и в
    // «Свойствах документа» это должно быть видно без открытия самого резюме.
    // Персональных данных здесь нет намеренно (см. ExportBrandingService.pdfMetadata).
    {
      title: branding.metadata.title,
      author: branding.metadata.author,
      subject: branding.metadata.subject,
      keywords: branding.metadata.keywords,
      creator: branding.metadata.creator,
      producer: branding.metadata.producer,
      creationDate: branding.metadata.creationDate,
    },
    h(
      pdf.Page,
      { size: 'A4', style: styles.page },
      h(
        pdf.View,
        { style: styles.brandBar },
        branding.logo ? h(pdf.Image, { src: branding.logo, style: styles.brandLogo }) : null,
        h(pdf.Text, { style: styles.brandLine }, branding.generatedLine),
      ),
      h(pdf.Text, { style: styles.name }, data.fullName),
      data.headline ? h(pdf.Text, { style: styles.headline }, data.headline) : null,
      data.contacts.length > 0
        ? h(
            pdf.View,
            { style: styles.contactRow },
            ...data.contacts.map((contact, i) =>
              h(pdf.Text, { key: String(i), style: styles.contact }, contact),
            ),
          )
        : null,

      data.about
        ? section(kit, data.labels.about, h(pdf.Text, { style: styles.body }, data.about))
        : null,

      data.education.length > 0
        ? section(
            kit,
            data.labels.education,
            h(
              pdf.View,
              null,
              ...data.education.map((line, i) =>
                h(pdf.Text, { key: String(i), style: styles.body }, line),
              ),
            ),
          )
        : null,

      data.skills.length > 0
        ? section(
            kit,
            data.labels.skills,
            h(
              pdf.View,
              { style: styles.skills },
              ...data.skills.map((skill, i) =>
                h(pdf.Text, { key: String(i), style: styles.skill }, skill),
              ),
            ),
          )
        : null,

      data.experience.length > 0
        ? section(kit, data.labels.experience, items(kit, data.experience, data.labels.verified))
        : null,
      data.projects.length > 0
        ? section(kit, data.labels.projects, items(kit, data.projects, data.labels.verified))
        : null,
      data.certificates.length > 0
        ? section(
            kit,
            data.labels.certificates,
            items(kit, data.certificates, data.labels.verified),
          )
        : null,

      data.languages.length > 0
        ? section(
            kit,
            data.labels.languages,
            h(pdf.Text, { style: styles.body }, data.languages.join(', ')),
          )
        : null,

      // Колонтитул на каждой странице: платформа, домен и «стр. N из M». `render` зовётся
      // на каждой странице уже после разбивки — только так известно общее число страниц.
      h(pdf.Text, {
        style: styles.footer,
        fixed: true,
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          branding.footerLine(pageNumber, totalPages),
      }),
    ),
  )

  return pdf.renderToBuffer(doc)
}
