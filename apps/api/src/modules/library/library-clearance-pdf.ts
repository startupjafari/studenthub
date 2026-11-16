import { createElement as h } from 'react'
import type { ExportLocale, PdfBranding } from '../../common/export/export-branding.types'
import { PDF_FONT_FAMILY, registerPdfFont } from '../../common/export/pdf-font'

/**
 * Справка «задолженностей в библиотеке нет» с кодом проверки (Фаза 21.C4). Устроена как
 * справка об обучении (application-services/study-certificate-pdf.ts): тот же ESM-шим вокруг
 * @react-pdf, тот же шрифт, код и QR на страницу `/verify/<код>`. Бланк короче: кому выдана,
 * группа и факультет, на какую дату проверены долги.
 *
 * ВНИМАНИЕ: формулировки — рабочие, не утверждённая форма обходного листа вуза. Перед
 * выпуском их вычитывает библиотека/канцелярия.
 */

const importEsm = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>

type ReactPdf = typeof import('@react-pdf/renderer')

export interface LibraryClearanceLabels {
  title: string
  issuedTo: string
  body: string
  faculty: string
  group: string
  studentCard: string
  checkedAt: string
  purpose: string
  number: string
  issuedAt: string
  verification: string
}

export interface LibraryClearanceData {
  number: string
  verificationCode: string
  verificationUrl: string
  verificationQr: string | null
  universityName: string
  reader: {
    name: string
    faculty: string | null
    group: string | null
    studentCardNumber: string | null
  }
  /** Дата и время проверки долгов по часам вуза, уже отформатированные. */
  issuedAt: string
  labels: LibraryClearanceLabels
  branding: PdfBranding
}

// ФИО — отдельной строкой «Выдана: …», а не внутри фразы: склонение на три языка (см.
// study-certificate-labels.ts).
export const LIBRARY_CLEARANCE_LABELS: Record<ExportLocale, LibraryClearanceLabels> = {
  ru: {
    title: 'СПРАВКА ОБ ОТСУТСТВИИ ЗАДОЛЖЕННОСТИ В БИБЛИОТЕКЕ',
    issuedTo: 'Выдана',
    body: 'Настоящая справка подтверждает, что за указанным лицом на дату проверки не числится книг библиотеки университета — ни на руках, ни утерянных с непогашенным долгом.',
    faculty: 'Факультет',
    group: 'Группа',
    studentCard: 'Студенческий билет',
    checkedAt: 'Задолженность проверена',
    purpose: 'Справка выдана для предъявления по месту требования.',
    number: '№',
    issuedAt: 'от',
    verification: 'Проверка подлинности документа',
  },
  kk: {
    title: 'КІТАПХАНАДАН БЕРЕШЕГІ ЖОҚ ЕКЕНІ ТУРАЛЫ АНЫҚТАМА',
    issuedTo: 'Берілді',
    body: 'Осы анықтама көрсетілген тұлғада тексеру күні университет кітапханасының кітаптары — қолында да, өтелмеген берешегі бар жоғалған да — жоқ екенін растайды.',
    faculty: 'Факультет',
    group: 'Топ',
    studentCard: 'Студенттік билет',
    checkedAt: 'Берешек тексерілді',
    purpose: 'Анықтама талап етілетін жерге ұсыну үшін берілді.',
    number: '№',
    issuedAt: 'күні',
    verification: 'Құжаттың түпнұсқалығын тексеру',
  },
  en: {
    title: 'LIBRARY CLEARANCE CERTIFICATE',
    issuedTo: 'Issued to',
    body: 'This certificate confirms that, as of the check date, no university library books are registered to the person named above — neither on loan nor lost with an unsettled debt.',
    faculty: 'Faculty',
    group: 'Group',
    studentCard: 'Student ID',
    checkedAt: 'Checked on',
    purpose: 'Issued for presentation upon request.',
    number: 'No.',
    issuedAt: 'dated',
    verification: 'Verify this document',
  },
}

let kitPromise: Promise<{ pdf: ReactPdf; styles: ReturnType<typeof createStyles> }> | undefined

async function loadKit() {
  kitPromise ??= (async () => {
    const pdf = await importEsm<ReactPdf>('@react-pdf/renderer')
    registerPdfFont(pdf.Font)
    return { pdf, styles: createStyles(pdf.StyleSheet) }
  })()
  return kitPromise.catch((error: unknown) => {
    kitPromise = undefined
    throw error
  })
}

function createStyles(StyleSheet: ReactPdf['StyleSheet']) {
  return StyleSheet.create({
    page: { fontFamily: PDF_FONT_FAMILY, fontSize: 11, padding: 48, color: '#111827' },
    brandBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
    },
    logo: { width: 18, height: 18 },
    university: { fontSize: 11, fontWeight: 'bold' },
    title: { fontSize: 15, marginTop: 28, marginBottom: 4, textAlign: 'center' },
    number: { fontSize: 9.5, color: '#6b7280', textAlign: 'center', marginBottom: 24 },
    body: { fontSize: 11, lineHeight: 1.6, marginBottom: 18 },
    row: { flexDirection: 'row', marginBottom: 5 },
    label: { width: 170, fontSize: 10, color: '#6b7280' },
    value: { flex: 1, fontSize: 10.5 },
    purpose: { fontSize: 10.5, color: '#374151', marginTop: 16 },
    verifyBox: {
      marginTop: 28,
      padding: 10,
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    verifyText: { flex: 1 },
    verifyQr: { width: 64, height: 64 },
    verifyLabel: { fontSize: 8.5, color: '#6b7280', marginBottom: 3 },
    verifyCode: { fontSize: 13, letterSpacing: 2 },
    verifyUrl: { fontSize: 8.5, color: '#2563eb', marginTop: 3 },
    footer: {
      position: 'absolute',
      bottom: 28,
      left: 48,
      right: 48,
      fontSize: 8,
      color: '#9ca3af',
    },
  })
}

function row(
  kit: { pdf: ReactPdf; styles: ReturnType<typeof createStyles> },
  label: string,
  value: string | null,
) {
  if (!value) return null
  const { pdf, styles } = kit
  return h(
    pdf.View,
    { style: styles.row },
    h(pdf.Text, { style: styles.label }, label),
    h(pdf.Text, { style: styles.value }, value),
  )
}

export async function renderLibraryClearancePdf(data: LibraryClearanceData): Promise<Buffer> {
  const kit = await loadKit()
  const { pdf, styles } = kit
  const { labels, branding, reader } = data
  const doc = h(
    pdf.Document,
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
        branding.logo ? h(pdf.Image, { src: branding.logo, style: styles.logo }) : null,
        h(pdf.Text, { style: styles.university }, data.universityName),
      ),
      h(pdf.Text, { style: styles.title }, labels.title),
      h(
        pdf.Text,
        { style: styles.number },
        `${labels.number} ${data.number} · ${labels.issuedAt} ${data.issuedAt}`,
      ),
      h(pdf.Text, { style: styles.body }, labels.body),
      row(kit, labels.issuedTo, reader.name),
      row(kit, labels.faculty, reader.faculty),
      row(kit, labels.group, reader.group),
      row(kit, labels.studentCard, reader.studentCardNumber),
      row(kit, labels.checkedAt, data.issuedAt),
      h(pdf.Text, { style: styles.purpose }, labels.purpose),
      // Код и QR — то, что отличает справку от её подделки: вёрстку повторить легко,
      // попасть в журнал выданных документов — нет.
      h(
        pdf.View,
        { style: styles.verifyBox },
        h(
          pdf.View,
          { style: styles.verifyText },
          h(pdf.Text, { style: styles.verifyLabel }, labels.verification),
          h(pdf.Text, { style: styles.verifyCode }, data.verificationCode),
          h(pdf.Text, { style: styles.verifyUrl }, data.verificationUrl),
        ),
        data.verificationQr
          ? h(pdf.Image, { src: data.verificationQr, style: styles.verifyQr })
          : null,
      ),
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
