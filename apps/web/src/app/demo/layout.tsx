import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AuthSplitLayout } from '../../shared/ui/auth-split-layout'
import { MessagesScope } from '../../i18n/messages-scope'

/**
 * Заявка вуза на тестирование — тот же split-лейаут, что у входа.
 *
 * Сессии здесь нет, поэтому ни RoleGuard, ни AppShell не подключаются. Но это первая
 * страница продукта, которую человек из вуза видит вообще: он приходит с лендинга и
 * должен попасть в то же место, а не на форму без опознавательных знаков. Брендовая
 * панель слева — та же, что на входе, и это единственный способ показать, что лендинг и
 * платформа — один продукт.
 *
 * Текст панели свой, не как у входа: там зовут войти тех, у кого аккаунт есть, а здесь
 * объясняют, что будет дальше. Формулировка описательная, а не побуждающая («мы заведём
 * ваш вуз», не «оставьте заявку»): этот же лейаут накрывает экран подтверждения адреса,
 * а там звать оставить заявку поздно — она уже отправлена.
 *
 * Обещаний по срокам нет намеренно: заявку читает человек, и «ответим за час» страница
 * взять на себя не может.
 *
 * Карточка шире, чем у входа (`max-w-xl` против `max-w-md`): в форме есть парные поля,
 * и на 28rem они складываются в столбец даже на большом экране.
 */
export default function Layout({ children }: { children: ReactNode }) {
  const t = useTranslations('Demo')
  const tAuth = useTranslations('Auth')

  return (
    <AuthSplitLayout
      title={t('brandSlogan')}
      subtitle={t('brandSubtitle')}
      copyright={tAuth('copyright')}
      width="xl"
    >
      <MessagesScope scope="demo">{children}</MessagesScope>
    </AuthSplitLayout>
  )
}
