import type { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { MeshBrandPanel } from '../../../shared/ui/mesh-brand-panel'
import { MessagesScope } from '../../../i18n/messages-scope'

/**
 * Публичные страницы работодателя (регистрация, подтверждение почты) — тот же
 * split-лейаут, что у входа и заявки вуза: слева брендовая панель, справа форма.
 *
 * Сессии здесь нет, поэтому ни RoleGuard, ни AppShell не подключаются. Текст панели свой:
 * у входа он обращается к студентам и преподавателям, а сюда приходит компания.
 */
export default function Layout({ children }: { children: ReactNode }) {
  const t = useTranslations('Employer')
  const tAuth = useTranslations('Auth')

  return (
    <div className="flex min-h-dvh">
      <MeshBrandPanel
        title={t('brandSlogan')}
        subtitle={t('brandSubtitle')}
        copyright={tAuth('copyright')}
      />

      {/* Мобильный: логотип у верха, форма ниже, на фоне — сетка точек, как на входе.
          Десктоп: форма в правой половине (точки и логотип есть на панели слева). */}
      <main className="relative flex flex-1 flex-col overflow-hidden p-6">
        <div className="auth-dots lg:hidden" aria-hidden />
        <div className="relative z-10 mt-[calc(1rem+env(safe-area-inset-top))] flex items-center justify-center gap-3 lg:hidden">
          <GraduationCap className="size-9 text-primary" aria-hidden />
          <span className="text-2xl font-bold">StudentHub</span>
        </div>
        {/* `py-10`, как у заявки вуза: форма регистрации длиннее формы входа и на ноутбуке
            без отступов упиралась бы в края экрана. */}
        <div className="relative z-10 flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <MessagesScope scope="employer/(public)">{children}</MessagesScope>
          </div>
        </div>
      </main>
    </div>
  )
}
