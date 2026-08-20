import { NextResponse, type NextRequest } from 'next/server'
import { Role } from '@studenthub/shared-types'
import { ROLE_HOME } from './shared/config/routes'

// Ролевой редирект ДО рендера (docs/FRONTEND_RULES.md §3), по нечувствительной role-cookie
// sh_role (решение §16.2). Реальная авторизация — на сервере (guard'ы), это только UX.
const PUBLIC_PATHS = ['/login', '/register', '/offline']

interface RoleCookie {
  role: Role
  universityId: string | null
  facultyId: string | null
  groupId: string | null
}

function decodeRoleCookie(value: string | undefined): RoleCookie | null {
  if (!value) return null
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const parsed = JSON.parse(atob(padded)) as RoleCookie
    if (parsed && typeof parsed.role === 'string' && parsed.role in ROLE_HOME) {
      return parsed
    }
  } catch {
    /* игнорируем битую cookie */
  }
  return null
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl
  const session = decodeRoleCookie(request.cookies.get('sh_role')?.value)
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (!session) {
    if (isPublic) return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  const home = ROLE_HOME[session.role]

  // Авторизованного не пускаем на /login|/register — сразу на его home.
  if (isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = home
    return NextResponse.redirect(url)
  }

  // С корня отправляем не-студентов на их home.
  if (pathname === '/' && home !== '/') {
    const url = request.nextUrl.clone()
    url.pathname = home
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  // /api/* исключены: это прокси на бэкенд (next.config rewrites), а не страницы —
  // без исключения middleware редиректил бы API-запросы на /login.
  // /monitoring — туннель Sentry (next.config tunnelRoute, Ф13.8): браузер POST'ит туда
  // события. Без исключения ошибки с экрана логина (сессии ещё нет) улетали бы
  // редиректом на /login и терялись.
  matcher: ['/((?!api|monitoring|_next/static|_next/image|favicon.ico|.*\\.).*)'],
}
