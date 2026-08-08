import type { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { MeshBrandPanel } from '../../shared/ui'

// Split-лейаут экранов входа/регистрации: слева интерактивная брендовая панель
// (меш-сетка за мышью, скрыта на мобильном), справа — форма по центру.
export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('Auth')

  return (
    <div className="flex min-h-screen">
      <MeshBrandPanel
        title={t('brandSlogan')}
        subtitle={t('brandSubtitle')}
        copyright={t('copyright')}
      />

      {/* Мобильный: логотип у самого верха, форма ниже (justify-start + верхний отступ с учётом
          safe-area). Десктоп: форма по центру правой части. */}
      <main className="flex flex-1 flex-col items-center justify-center p-6 max-lg:justify-start max-lg:pt-[calc(3rem+env(safe-area-inset-top))]">
        <div className="mb-10 flex items-center gap-3 lg:hidden">
          <GraduationCap className="size-9 text-primary" aria-hidden />
          <span className="text-2xl font-bold">StudentHub</span>
        </div>
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
