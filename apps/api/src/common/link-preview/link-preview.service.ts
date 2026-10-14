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

// Разбор (см. parse): сколько HTML смотрим и какой длины бывает тег. Повторения ограничены,
// чтобы ни одна регулярка не могла откатываться по всему документу.
const PARSE_LIMIT = 1024 * 1024
const META_TAG = /<meta\b[^>]{0,2048}>/gi
const META_KEY = /\b(?:property|name)\s*=\s*["']([^"']{1,100})["']/i
const META_CONTENT = /\bcontent\s*=\s*["']([^"']{0,2000})["']/i
const TITLE_TAG = /<title\b[^>]{0,256}>([^<]{0,1024})<\/title>/i
const MAX_META_TAGS = 300

// Приватные/служебные диапазоны — блок SSRF (запросы во внутреннюю сеть). Разрешён только
// обычный глобальный unicast: всё служебное (loopback, link-local, multicast, документационные
// и зарезервированные сети, NAT64, «неуказанный» адрес) отклоняется.
function isPrivateIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '')
  const family = isIP(ip)
  if (family === 4) return isPrivateV4(ip)
  if (family === 6) return isPrivateV6(ip)
  // Не адрес вовсе — пропускать нечего.
  return true
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b, c] = p as [number, number, number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 || // multicast 224/4 и зарезервированные 240/4, включая broadcast
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF и TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // бенчмарки
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) // TEST-NET-3
  )
}

/** Восемь 16-битных групп IPv6; хвост в виде IPv4 раскладывается в две группы. */
function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0] ?? ''
  const v4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (v4Tail) {
    const q = (v4Tail[1] ?? '').split('.').map(Number)
    if (q.length !== 4 || q.some((n) => !Number.isInteger(n) || n > 255)) return null
    const [q0, q1, q2, q3] = q as [number, number, number, number]
    text = `${text.slice(0, v4Tail.index)}${((q0 << 8) | q1).toString(16)}:${((q2 << 8) | q3).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  const nums = groups.map((g) => parseInt(g, 16))
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? nums
    : null
}

function isPrivateV6(ip: string): boolean {
  const g = expandV6(ip)
  if (!g) return true
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0
  // :: и ::1 — «неуказанный» и loopback (на Linux подключение к :: попадает в loopback).
  if (zeroPrefix && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true
  // IPv4-mapped (::ffff:a.b.c.d) и устаревший IPv4-compatible (::a.b.c.d) — проверяем как v4.
  if (zeroPrefix && (g5 === 0xffff || g5 === 0)) {
    return isPrivateV4(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`)
  }
  return (
    (g0 & 0xfe00) === 0xfc00 || // unique-local fc00::/7
    (g0 & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g0 & 0xff00) === 0xff00 || // multicast ff00::/8
    (g0 === 0x64 && g1 === 0xff9b) || // NAT64 64:ff9b::/96 — ведёт в IPv4, в т.ч. внутренний
    (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) || // discard 100::/64
    (g0 === 0x2001 && g1 === 0xdb8) || // документационная 2001:db8::/32
    g0 === 0 // прочее из ::/16 — зарезервировано
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
  private async hostAllowed(rawHostname: string): Promise<boolean> {
    // URL отдаёт IPv6-литерал в скобках ([::1]) — без них isIP его не узнаёт.
    const hostname = rawHostname.replace(/^\[|\]$/g, '')
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

  /**
   * Разбор OG-тегов без регулярок с откатом по всему документу. Прежнее
   * `<meta[^>]+…` на странице из тысяч «<meta » без «>» перебирало строку квадратично:
   * 2 МБ такой страницы держали цикл событий минутами, и вставка одной ссылки в чат
   * останавливала весь API. Теперь длина тега и разбираемый объём ограничены, а каждый тег
   * разбирается отдельно — время линейно от размера страницы.
   */
  private parse(rawHtml: string, finalUrl: string): LinkPreview {
    const html = rawHtml.slice(0, PARSE_LIMIT)
    const metas = new Map<string, string>()
    for (const match of html.matchAll(META_TAG)) {
      const tag = match[0]
      const key = META_KEY.exec(tag)?.[1]?.toLowerCase()
      if (!key || metas.has(key)) continue
      const content = META_CONTENT.exec(tag)?.[1]
      if (content !== undefined) metas.set(key, content)
      if (metas.size >= MAX_META_TAGS) break
    }
    const meta = (prop: string): string | null => {
      const content = metas.get(prop)
      return content ? this.decode(content).trim() || null : null
    }
    const title =
      meta('og:title') ??
      (() => {
        const m = TITLE_TAG.exec(html)
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
  //
  // Одной заменой, а не цепочкой из шести. Цепочка декодирует дважды: `&amp;lt;` на первом
  // шаге становится `&lt;`, а второй шаг принимает результат за исходный текст и выдаёт `<`.
  // Страница, где в заголовке написано `&lt;`, получала бы от нас `<` — символ, которого
  // в ней не было. Один проход слева направо продолжается после совпадения, а не по нему.
  private decode(s: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&#x27;': "'",
    }
    return s.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (e) => entities[e] ?? e)
  }
}
