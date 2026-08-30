import { createElement as h } from 'react'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'

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

const FONT_FAMILY = 'Inter'
let fontRegistered = false

/**
 * Путь к файлу шрифта.
 *
 * Считаем от каталога модуля, а не от `process.cwd()`: рабочий каталог зависит от того,
 * откуда запустили процесс, и в монорепо это то корень репозитория, то пакет. От
 * `__dirname` три уровня вверх дают корень пакета api и в `src/`, и в собранном `dist/` —
 * структура каталогов одинаковая.
 */
function fontPath(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', 'assets', 'fonts', 'InterVariable.ttf'),
    join(process.cwd(), 'assets', 'fonts', 'InterVariable.ttf'),
    join(process.cwd(), 'apps', 'api', 'assets', 'fonts', 'InterVariable.ttf'),
  ]
  const found = candidates.find((path) => existsSync(path))
  if (!found) {
    // Падаем внятно: без шрифта PDF на русском выйдет пустым, и молчаливая деградация
    // здесь хуже ошибки.
    throw new Error(`Шрифт для PDF не найден. Искали: ${candidates.join(', ')}`)
  }
  return found
}

/** Регистрация один раз на процесс: Font.register держит глобальный реестр. */
function ensureFont(): void {
  if (fontRegistered) return
  Font.register({ family: FONT_FAMILY, src: fontPath() })
  // Переносы слов отключаем: встроенный словарь переносов рассчитан на английский и
  // рвёт русские слова в неожиданных местах.
  Font.registerHyphenationCallback((word) => [word])
  fontRegistered = true
}

const styles = StyleSheet.create({
  page: { fontFamily: FONT_FAMILY, fontSize: 10, padding: 40, color: '#111827' },
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
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 8, color: '#9ca3af' },
})

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
}

function section(title: string, children: React.ReactNode) {
  return h(
    View,
    { wrap: false },
    h(Text, { style: styles.sectionTitle }, title.toUpperCase()),
    children,
  )
}

function items(list: ResumeItem[], verifiedLabel: string) {
  return h(
    View,
    null,
    ...list.map((item, index) =>
      h(
        View,
        { key: String(index), style: styles.item },
        h(
          Text,
          { style: styles.itemTitle },
          item.title,
          item.verified ? h(Text, { style: styles.verified }, `  ✓ ${verifiedLabel}`) : null,
        ),
        item.organization || item.period
          ? h(
              Text,
              { style: styles.itemMeta },
              [item.organization, item.period].filter(Boolean).join(' · '),
            )
          : null,
        item.description ? h(Text, { style: styles.body }, item.description) : null,
      ),
    ),
  )
}

/** Резюме в PDF. Возвращает буфер — контроллер отдаёт его как файл. */
export async function renderResumePdf(data: ResumeData): Promise<Buffer> {
  ensureFont()

  const doc = h(
    Document,
    { title: data.fullName, author: data.fullName },
    h(
      Page,
      { size: 'A4', style: styles.page },
      h(Text, { style: styles.name }, data.fullName),
      data.headline ? h(Text, { style: styles.headline }, data.headline) : null,
      data.contacts.length > 0
        ? h(
            View,
            { style: styles.contactRow },
            ...data.contacts.map((contact, i) =>
              h(Text, { key: String(i), style: styles.contact }, contact),
            ),
          )
        : null,

      data.about ? section(data.labels.about, h(Text, { style: styles.body }, data.about)) : null,

      data.education.length > 0
        ? section(
            data.labels.education,
            h(
              View,
              null,
              ...data.education.map((line, i) =>
                h(Text, { key: String(i), style: styles.body }, line),
              ),
            ),
          )
        : null,

      data.skills.length > 0
        ? section(
            data.labels.skills,
            h(
              View,
              { style: styles.skills },
              ...data.skills.map((skill, i) =>
                h(Text, { key: String(i), style: styles.skill }, skill),
              ),
            ),
          )
        : null,

      data.experience.length > 0
        ? section(data.labels.experience, items(data.experience, data.labels.verified))
        : null,
      data.projects.length > 0
        ? section(data.labels.projects, items(data.projects, data.labels.verified))
        : null,
      data.certificates.length > 0
        ? section(data.labels.certificates, items(data.certificates, data.labels.verified))
        : null,

      data.languages.length > 0
        ? section(data.labels.languages, h(Text, { style: styles.body }, data.languages.join(', ')))
        : null,

      h(Text, { style: styles.footer, fixed: true }, data.labels.generated),
    ),
  )

  return renderToBuffer(doc)
}
