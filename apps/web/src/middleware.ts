import { NextResponse, type NextRequest } from 'next/server'
import { SUPPORTED_LOCALES, type Locale } from '@studenthub/shared-config'
import { Role } from '@studenthub/shared-types'
import { LEGAL_BASE, ROLE_HOME, isRestrictedRolePath } from './shared/config/routes'
import { safeNextPath } from './shared/lib/safe-next'
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_PARAM } from './shared/i18n/locale-cookie'

// Ролевой редирект ДО рендера (docs/FRONTEND_RULES.md §3), по нечувствительной role-cookie
// sh_role (решение §16.2). Реальная авторизация — на сервере (guard'ы), это только UX.
// Ф18: регистрация работодателя и подтверждение его почты — единственные публичные
// страницы вне входа. Сессии на них нет по определению: аккаунта ещё не существует.
const PUBLIC_PATHS = [
  '/login',
  '/register',
  // Сброс пароля (§7.2): его делает тот, кто войти как раз не может.
  '/forgot-password',
  '/reset-password',
  '/offline',
  '/employer/signup',
  '/employer/verify',
  // Заявка вуза на тестирование (§31): её открывает человек из вуза, у которого
  // аккаунта ещё нет и по определению быть не может — вуза на платформе пока нет.
  '/demo',
  // Публичное резюме по ссылке: её открывает работодатель, у которого аккаунта нет.
  '/r/resume',
  // Проверка выданного документа по коду из бланка: её открывает банк, работодатель,
  // посольство — у них аккаунта нет и не будет.
  '/verify',
  // Политика конфиденциальности и пользовательское соглашение: их обязаны показать
  // ДО регистрации, и ссылка на них стоит под формой входа.
  LEGAL_BASE,
]

/**
 * Публичные пути, с которых авторизованного НЕ уводим на его домашнюю страницу.
 *
 * Подтверждение почты приходит ссылкой в письме, и открыть её может человек, уже вошедший
 * в другом аккаунте или в этом же. Редирект на home в этот момент означал бы, что письмо
 * «не работает», а адрес так и остался неподтверждённым.
 */
const PUBLIC_PATHS_ALLOWED_WHEN_AUTHED = [
  // Офлайн-фолбэк PWA: service worker забирает его в precache с cookie вошедшего. Редирект
  // на home положил бы под ключ /offline HTML дашборда, и без сети вместо «Нет сети»
  // открывалась бы оболочка со стеной ошибок.
  '/offline',
  '/employer/verify',
  // Ссылка сброса из письма открывается и в браузере, где кто-то уже вошёл: редирект на
  // home сжёг бы человеку ссылку, ничего не сменив.
  '/reset-password',
  '/demo/verify',
  '/r/resume',
  '/verify',
  // Юридические документы читают и вошедшие — из настроек, из письма, по присланной
  // ссылке. Редирект на домашнюю означал бы, что ссылка на политику работает только у
  // тех, кто не в системе.
  LEGAL_BASE,
]

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

  // Язык с лендинга: ссылки сайта несут ?lang=, потому что cookie NEXT_LOCALE с чужого
  // домена не поставить. Переносим в cookie и убираем из адреса — повторным заходом, иначе
  // этот же запрос отрисовался бы ещё на старом языке. Вошедшему язык задаёт профиль
  // (shared/i18n/locale-cookie.ts), и параметр с сайта его не перебивает.
  const lang = request.nextUrl.searchParams.get(LOCALE_PARAM)
  if (lang !== null) {
    const url = request.nextUrl.clone()
    url.searchParams.delete(LOCALE_PARAM)
    const response = NextResponse.redirect(url)
    if (!session && SUPPORTED_LOCALES.includes(lang as Locale)) {
      response.cookies.set(LOCALE_COOKIE, lang, {
        path: '/',
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: 'lax',
      })
    }
    return response
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (!session) {
    if (isPublic) return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    // Куда вернуть после входа. Нужно из-за печатных QR помещений (Ф16): студент
    // сканирует наклейку в коридоре, и без этого он после логина попадал бы на свою
    // домашнюю страницу, а не на страницу помещения — то есть QR «не работал» бы.
    // Кладём путь целиком с query, но только относительный — открытый редирект недопустим.
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(url)
  }

  const home = ROLE_HOME[session.role]

  // Авторизованного не пускаем на /login|/register — сразу на его home. Но если в ссылке
  // остался ?next= (вернулся кнопкой «назад» после входа по QR помещения), ведём туда.
  if (isPublic) {
    if (
      PUBLIC_PATHS_ALLOWED_WHEN_AUTHED.some((p) => pathname === p || pathname.startsWith(`${p}/`))
    ) {
      return NextResponse.next()
    }
    const url = request.nextUrl.clone()
    const next = safeNextPath(request.nextUrl.searchParams.get('next'))
    url.search = ''
    if (next) {
      const target = new URL(next, request.nextUrl.origin)
      url.pathname = target.pathname
      url.search = target.search
    } else {
      url.pathname = home
    }
    return NextResponse.redirect(url)
  }

  // Охрана и библиотекарь — только свои экраны (isRestrictedRolePath): остальное им сервер
  // всё равно закроет, а пустой экран с ошибками хуже возврата на главную роли.
  if (!isRestrictedRolePath(session.role, pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = home
    url.search = ''
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
