import { isValidElement, type ReactNode } from 'react'

/** Пункт оглавления статьи: уровень заголовка (1–3), текст и якорь. */
export interface TocItem {
  level: number
  text: string
  slug: string
}

/** slug для якорей заголовков (оглавление). Юникод-буквы и цифры — как есть, прочее — дефисы. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Генератор уникальных якорей: два заголовка «Итоги» получают `итоги` и `итоги-2`. Без
 * этого у второго заголовка был тот же id, и оглавление вело к первому. Генератор один
 * на документ: оглавление и сам текст проходят заголовки в одном порядке и получают одни
 * и те же якоря.
 */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>()
  return (text) => {
    const base = slugify(text) || 'section'
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  }
}

/**
 * Текст заголовка без строчной разметки — тот, что читатель видит: `**Итоги**` → «Итоги»,
 * `[ссылка](url)` → «ссылка». По нему же считается якорь, и он совпадает с текстом,
 * который рендер достаёт из React-узлов (`nodeText`).
 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .trim()
}

/** Текст из markdown-children — для id заголовков и сверки с оглавлением. */
export function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ''
}

interface ScannedHeading extends TocItem {
  /** Номер строки в markdown (с 1) — по нему рендер находит якорь заголовка. */
  line: number
}

function scanHeadings(md: string): ScannedHeading[] {
  const out: ScannedHeading[] = []
  const slug = createSlugger()
  let inFence = false
  md.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const m = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line)
    if (!m || !m[1] || !m[2]) return
    const text = stripInlineMarkdown(m[2])
    if (text) out.push({ level: m[1].length, text, slug: slug(text), line: i + 1 })
  })
  return out
}

/** Оглавление из markdown (# … ###), без строк внутри блоков кода. Якоря — уникальные. */
export function extractToc(md: string): TocItem[] {
  return scanHeadings(md).map(({ level, text, slug }) => ({ level, text, slug }))
}

/**
 * Якоря заголовков по номеру строки. Рендер берёт якорь по позиции узла, а не считает
 * заголовки сам: счётчик внутри отрисовки сбился бы при повторном рендере (StrictMode
 * рисует компонент дважды), и id разошлись бы с оглавлением.
 */
export function headingSlugsByLine(md: string): Map<number, string> {
  return new Map(scanHeadings(md).map((h) => [h.line, h.slug]))
}
