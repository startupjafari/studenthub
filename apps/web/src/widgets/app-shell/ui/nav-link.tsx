import type { ComponentProps } from 'react'
import Link from 'next/link'

// Типы `next/link` в Next 15 описывают «страничный» Link, и пропа `unstable_dynamicOnHover`
// в них нет. Но в app router бандлер подставляет на место `next/link` app-dir Link
// (next/dist/build/create-compiler-aliases.js), а у него проп есть (Next 15.3+). Передаём
// его спредом — без приведения всего набора пропов к `any`; остальные пропы типизированы.
const DYNAMIC_ON_HOVER: object = { unstable_dynamicOnHover: true }

/**
 * Ссылка меню оболочки. По наведению и касанию подгружает страницу целиком, а не до её
 * loading.tsx: к клику экран уже в кэше маршрутизатора, и вместо мелькнувшего на треть
 * секунды лоадера сразу открывается он.
 *
 * Не `prefetch` целиком для всех пунктов: в сайдбаре их полтора десятка, и каждая загрузка
 * страницы отправляла бы на сервер столько же запросов ради экранов, которые не откроют.
 */
export function NavLink(props: ComponentProps<typeof Link>) {
  return <Link {...DYNAMIC_ON_HOVER} {...props} />
}
