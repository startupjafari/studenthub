import { Injectable, Logger } from '@nestjs/common'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export interface LinkPreview {
  url: string
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
}

const FETCH_TIMEOUT_MS = 5000
// Читаем до `</head>` — OG-теги живут там, остальное тело качать незачем. Потолок нужен на
// случай страницы без закрывающего тега; 512 КБ не хватало: у YouTube один только <head>
// весит ~700 КБ, обрезка приходилась до og:title, и превью молча не появлялось.
const MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
// Нахлёст между чанками при поиске `</head>`: тег может разорваться на границе.
const HEAD_TAG_OVERLAP = 8

// Приватные/служебные диапазоны — блок SSRF (запросы во внутреннюю сеть).
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    return (
      v === '::1' ||
      v.startsWith('fc') ||
      v.startsWith('fd') || // unique-local
      v.startsWith('fe80') || // link-local
      v.startsWith('::ffff:') // IPv4-mapped — проверим как v4 ниже
    )
  }
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true
  const [a, b] = p as [number, number, number, number]
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT
  )
}

/**
 * Достаёт OG-превью по ссылке для инлайн-карточки в чате (Ф9+). Безопасность (SSRF):
 * только http(s), хост резолвится и приватные/loopback IP отклоняются, жёсткий таймаут,
 * лимит размера тела, ручной разбор редиректов с повторной проверкой хоста, только text/html.
 */
@Injectable()
export class LinkPreviewService {
  private readonly logger = new Logger(LinkPreviewService.name)

  async fetch(rawUrl: string): Promise<LinkPreview | null> {
    let current = rawUrl
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = this.safeUrl(current)
      if (!url) return null
      if (!(await this.hostAllowed(url.hostname))) return null

      let res: Response
      try {
        res = await this.doFetch(url)
      } catch {
        return null
      }

      // Ручная обработка редиректа: следующий хоп заново проходит SSRF-проверку.
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return null
        current = new URL(loc, url).toString()
        continue
      }
      if (!res.ok) return null
      const ctype = res.headers.get('content-type') ?? ''
      if (!ctype.includes('text/html')) return null

      const html = await this.readCapped(res)
      return this.parse(html, url.toString())
    }
    this.logger.debug(`link-preview: превышен лимит редиректов для ${rawUrl}`)
    return null
  }

  private safeUrl(raw: string): URL | null {
    try {
      const u = new URL(raw)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      return u
    } catch {
      return null
    }
  }

  // Резолвим все адреса хоста и отклоняем, если хоть один приватный (защита от DNS-обхода).
  private async hostAllowed(hostname: string): Promise<boolean> {
    if (isIP(hostname)) return !isPrivateIp(hostname)
    try {
      const addrs = await lookup(hostname, { all: true })
      if (addrs.length === 0) return false
      return addrs.every((a) => !isPrivateIp(a.address))
    } catch {
      return false
    }
  }

  private doFetch(url: URL): Promise<Response> {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
    return fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: ac.signal,
      headers: { accept: 'text/html', 'user-agent': 'StudentHubBot/1.0 (+link-preview)' },
    }).finally(() => clearTimeout(timer))
  }

  /**
   * Тело до конца `<head>` или до потолка MAX_BYTES. Ищем закрывающий тег по каждому чанку
   * с нахлёстом, а не по склеенному буферу: склейка на каждый чанк дала бы O(n²).
   */
  private async readCapped(res: Response): Promise<string> {
    const reader = res.body?.getReader()
    if (!reader) return ''
    const chunks: Uint8Array[] = []
    let total = 0
    let tail = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      total += value.length

      const text = tail + Buffer.from(value).toString('utf8')
      if (/<\/head\s*>/i.test(text) || total >= MAX_BYTES) {
        await reader.cancel()
        break
      }
      tail = text.slice(-HEAD_TAG_OVERLAP)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  private parse(html: string, finalUrl: string): LinkPreview {
    const meta = (prop: string): string | null => {
      // <meta property="og:title" content="..."> или name="..."; порядок атрибутов любой.
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i')
      const tag = re.exec(html)?.[0]
      if (!tag) return null
      const content = /content=["']([^"']*)["']/i.exec(tag)?.[1]
      return content ? this.decode(content).trim() || null : null
    }
    const title =
      meta('og:title') ??
      (() => {
        const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html)
        return m?.[1] ? this.decode(m[1]).trim() || null : null
      })()
    const description = meta('og:description') ?? meta('description')
    const rawImage = meta('og:image') ?? meta('twitter:image')
    const image = rawImage ? this.absolutize(rawImage, finalUrl) : null
    const siteName = meta('og:site_name')
    return { url: finalUrl, title, description, image, siteName }
  }

  private absolutize(src: string, base: string): string | null {
    try {
      const u = new URL(src, base)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
    } catch {
      return null
    }
  }

  // Минимальный html-entity decode для типовых сущностей в OG-тегах.
  private decode(s: string): string {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
  }
}
