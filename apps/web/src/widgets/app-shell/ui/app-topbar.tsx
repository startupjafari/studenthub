'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Search } from 'lucide-react'
import {
  Flag,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type FlagCode,
} from '../../../shared/ui'
import { NotificationsBell } from '../../notifications-bell'

// Флаги — инлайн-SVG (emoji-флаги не рендерятся на Windows).
const LOCALES: { value: FlagCode; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'kk', label: 'Қазақша' },
  { value: 'en', label: 'English' },
]

export function AppTopbar({ locale }: { locale: string }) {
  const t = useTranslations('Dashboard')
  const router = useRouter()

  function changeLocale(value: string) {
    document.cookie = `NEXT_LOCALE=${value}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6 lg:hidden">
      {/* Левый спейсер — держит поиск по центру */}
      <div className="hidden flex-1 sm:block" />

      {/* Поиск по центру */}
      <div className="relative hidden w-full max-w-md sm:block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="h-10 pl-9"
        />
      </div>

      {/* Справа: язык + уведомления */}
      <div className="flex flex-1 items-center justify-end gap-2">
        <Select value={locale} onValueChange={changeLocale}>
          <SelectTrigger aria-label={t('language')} className="h-10 w-auto gap-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCALES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                <span className="flex items-center gap-2">
                  <Flag code={l.value} />
                  {l.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <NotificationsBell />
      </div>
    </header>
  )
}
