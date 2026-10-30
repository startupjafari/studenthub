import { redirect } from 'next/navigation'
import { Role } from '@studenthub/shared-types'
import { ROLE_HOME } from '../../shared/config/routes'

// Своего дашборда у старосты нет: его дом — лента, как у студента (ROLE_HOME), а разделы
// группы живут вкладками /starosta/*. Catch-all [...section] пустой путь не ловит, поэтому
// без этой страницы прямой заход на /starosta отдавал 404.
export default function Page() {
  redirect(ROLE_HOME[Role.STAROSTA])
}
