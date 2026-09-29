import type { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { MeshBrandPanel } from '../../shared/ui'

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
    <div className="flex min-h-dvh">
      <MeshBrandPanel
        title={t('brandSlogan')}
        subtitle={t('brandSubtitle')}
        copyright={tAuth('copyright')}
      />

      {/* Мобильный: логотип у верха, форма ниже, на фоне — та же мягкая сетка точек, что
          на входе. Десктоп: форма в правой половине (точки и логотип скрыты, они есть на
          панели слева). */}
      <main className="relative flex flex-1 flex-col overflow-hidden p-6">
        <div className="auth-dots lg:hidden" aria-hidden />
        <div className="relative z-10 mt-[calc(1rem+env(safe-area-inset-top))] flex items-center justify-center gap-3 lg:hidden">
          <GraduationCap className="size-9 text-primary" aria-hidden />
          <span className="text-2xl font-bold">StudentHub</span>
        </div>
        {/* `py-10` вместо чистого центрирования: форма заявки длиннее формы входа и на
            ноутбуке не помещается в экран целиком. Отцентрированная по вертикали, она
            упиралась бы в края без отступов, а первое поле уезжало бы под верхний край. */}
        <div className="relative z-10 flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
