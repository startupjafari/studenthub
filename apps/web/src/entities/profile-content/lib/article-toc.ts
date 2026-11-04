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

/** Текст из markdown-children — для id заголовков и сверки с оглавлением. */
export function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ''
}

/** Оглавление из markdown (# … ###), без строк внутри блоков кода. */
export function extractToc(md: string): TocItem[] {
  const out: TocItem[] = []
  let inFence = false
  for (const line of md.split('\n')) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line)
    if (m && m[1] && m[2]) out.push({ level: m[1].length, text: m[2], slug: slugify(m[2]) })
  }
  return out
}
