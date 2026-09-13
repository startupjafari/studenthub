import { createElement as h } from 'react'
import type { PdfBranding } from '../../common/export/export-branding.types'
import type { AcademicSubject } from '../users/users.service'
import { PDF_FONT_FAMILY, registerPdfFont } from '../../common/export/pdf-font'

/**
 * Справка об обучении — первый документ, который платформа ВЫПУСКАЕТ, а не хранит
 * (план брендирования, этап B7).
 *
 * ВНИМАНИЕ: состав бланка — проект, а не утверждённая форма. Он собран из того, что
 * система знает о студенте, и должен быть согласован с канцелярией вуза. Чего в модели
 * данных нет и что почти наверняка потребует официальный бланк:
 *   · реквизиты вуза — БИН, юридический адрес, банковские данные (в `University` только
 *     название, город и таймзона);
 *   · приказ о зачислении — номер и дата;
 *   · должность и ФИО подписанта.
 * Пока этих полей нет, соответствующие строки в бланк не выводятся — пустая строка
 * «Приказ: —» в официальной бумаге хуже её отсутствия.
 *
 * Технически повторяет resume-pdf.ts: тот же ESM-шим вокруг @react-pdf, тот же встроенный
 * шрифт. Отдельный файл, а не общий шаблон: у справки другая структура и другой жизненный
 * цикл, а общее у них — только брендирование, и оно уже вынесено.
 */

const importEsm = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>

type ReactPdf = typeof import('@react-pdf/renderer')

export interface StudyCertificateData {
  /** Номер документа — берётся из номера заявки (`SH-2026-001842`). */
  number: string
  /** Короткий код из журнала выгрузок: по нему справку проверяют. */
  verificationCode: string
  /** Адрес страницы проверки — печатается текстом рядом с кодом. */
  verificationUrl: string
  /** QR на ту же страницу проверки, PNG-датаурл. `null` — печатаем без него. */
  verificationQr: string | null
  subject: AcademicSubject
  /** Дата выдачи в таймзоне вуза, уже отформатированная. */
  issuedAt: string
  labels: StudyCertificateLabels
  branding: PdfBranding
}

/** Подписи бланка. Приходят из словаря вызывающей стороны — язык выбирает сотрудник. */
export interface StudyCertificateLabels {
  title: string
  issuedTo: string
  body: string
  faculty: string
  specialty: string
  course: string
  studyForm: string
  educationLevel: string
  funding: string
  group: string
  period: string
  studentCard: string
  purpose: string
  number: string
  issuedAt: string
  verification: string
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
    universityMeta: { fontSize: 8.5, color: '#6b7280' },
    title: { fontSize: 16, marginTop: 28, marginBottom: 4, textAlign: 'center' },
    number: { fontSize: 9.5, color: '#6b7280', textAlign: 'center', marginBottom: 24 },
    body: { fontSize: 11, lineHeight: 1.6, marginBottom: 18 },
    row: { flexDirection: 'row', marginBottom: 5 },
    label: { width: 150, fontSize: 10, color: '#6b7280' },
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

/** Строка «подпись → значение». Пустые значения не выводятся вовсе (см. док выше). */
function row(
  kit: { pdf: ReactPdf; styles: ReturnType<typeof createStyles> },
  label: string,
  value: string | number | null | undefined,
) {
  if (value === null || value === undefined || value === '') return null
  const { pdf, styles } = kit
  return h(
    pdf.View,
    { style: styles.row },
    h(pdf.Text, { style: styles.label }, label),
    h(pdf.Text, { style: styles.value }, String(value)),
  )
}

export async function renderStudyCertificatePdf(data: StudyCertificateData): Promise<Buffer> {
  const kit = await loadKit()
  const { pdf, styles } = kit
  const { subject, labels, branding } = data

  const period = [subject.enrollmentYear, subject.graduationYear].filter(Boolean).join(' — ')

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
      // Шапка бланка: вуз — крупно, платформа — в колонтитуле. Документ выдаёт вуз,
      // StudentHub только формирует его и отвечает за проверяемость.
      h(
        pdf.View,
        { style: styles.brandBar },
        branding.logo ? h(pdf.Image, { src: branding.logo, style: styles.logo }) : null,
        h(
          pdf.View,
          null,
          h(pdf.Text, { style: styles.university }, subject.universityName ?? ''),
          subject.universityCity
            ? h(pdf.Text, { style: styles.universityMeta }, subject.universityCity)
            : null,
        ),
      ),

      h(pdf.Text, { style: styles.title }, labels.title),
      h(
        pdf.Text,
        { style: styles.number },
        `${labels.number} ${data.number} · ${labels.issuedAt} ${data.issuedAt}`,
      ),

      h(pdf.Text, { style: styles.body }, labels.body),

      row(kit, labels.issuedTo, subject.fullName),
      row(kit, labels.faculty, subject.facultyName),
      row(kit, labels.specialty, subject.specialty),
      row(kit, labels.course, subject.course),
      row(kit, labels.group, subject.groupName),
      row(kit, labels.educationLevel, subject.educationLevel),
      row(kit, labels.studyForm, subject.studyForm),
      row(kit, labels.funding, subject.fundingType),
      row(kit, labels.period, period),
      row(kit, labels.studentCard, subject.studentCardNumber),

      h(pdf.Text, { style: styles.purpose }, labels.purpose),

      // Код проверки — единственное, что отличает выданную справку от её фотокопии:
      // подделать вёрстку легко, попасть в журнал выгрузок — нет.
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
        // QR ведёт на ту же страницу, что и адрес рядом: телефоном — камерой, без
        // телефона — руками по коду. Ни один путь не должен быть единственным.
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
