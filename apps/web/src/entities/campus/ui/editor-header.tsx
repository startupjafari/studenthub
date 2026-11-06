'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CircleAlert, Cloud, CloudOff, Loader2, Lock, Maximize, Redo2, Undo2 } from 'lucide-react'
import { Button, PageHeader, SegmentedTabs } from '../../../shared/ui'
import { cn } from '../../../shared/lib'

export type EditorSaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'readonly'

/**
 * Шапка полноэкранных редакторов кампуса (этаж, территория). Та же системная `PageHeader`,
 * что на остальных страницах: «назад», полоса-акцент, заголовок с пояснением; справа —
 * переключатель 2D/3D и действия в одном порядке у обоих редакторов: [своё] статус,
 * отменить, повторить, весь план, [ещё своё].
 */
export function CampusEditorHeader({
  backHref,
  title,
  subtitle,
  saveState,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFit,
  mode,
  onModeChange,
  leading,
  trailing,
}: {
  backHref: string
  title: string
  subtitle: string
  saveState: EditorSaveState
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onFit: () => void
  mode: '2d' | '3d'
  onModeChange: (mode: '2d' | '3d') => void
  /** Перед статусом — например, выбор этажа. */
  leading?: ReactNode
  /** После кнопок вида — например, шаблоны. */
  trailing?: ReactNode
}) {
  const t = useTranslations('CampusEditor')
  const router = useRouter()
  return (
    <PageHeader
      bleed={false}
      onBack={() => router.push(backHref)}
      backLabel={t('back')}
      title={title}
      subtitle={subtitle}
      tabs={
        <SegmentedTabs
          aria-label={t('viewMode')}
          collapsible={false}
          value={mode}
          onChange={onModeChange}
          items={[
            { value: '2d', label: '2D' },
            { value: '3d', label: '3D' },
          ]}
        />
      }
      actions={
        <>
          {leading}
          {/* Статус и правка — одной группой: на узком экране переносятся целиком, а не
              рвутся между строками («отменить» в одной, «повторить» в другой). */}
          <div className="flex items-center gap-2">
            <SaveChip state={saveState} />
            <Button
              type="button"
              variant="ghost"
              size="md"
              icon
              aria-label={t('undo')}
              title={`${t('undo')} (Ctrl+Z)`}
              disabled={!canUndo}
              onClick={onUndo}
            >
              <Undo2 aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              icon
              aria-label={t('redo')}
              title={`${t('redo')} (Ctrl+Shift+Z)`}
              disabled={!canRedo}
              onClick={onRedo}
            >
              <Redo2 aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              icon
              aria-label={t('fit')}
              title={`${t('fit')} (F)`}
              onClick={onFit}
            >
              <Maximize aria-hidden />
            </Button>
            {trailing}
          </div>
        </>
      }
    />
  )
}

function SaveChip({ state }: { state: EditorSaveState }) {
  const t = useTranslations('CampusEditor')
  const Icon =
    state === 'saving'
      ? Loader2
      : state === 'offline'
        ? CloudOff
        : state === 'readonly'
          ? Lock
          : state === 'conflict'
            ? CircleAlert
            : Cloud
  return (
    <span
      role="status"
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium',
        state === 'conflict' || state === 'offline'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-muted text-muted-foreground',
      )}
    >
      <Icon className={cn('size-3.5', state === 'saving' && 'animate-spin')} aria-hidden />
      {/* На телефоне — только значок: шапка редактора и так в две строки. */}
      <span className="sr-only sm:not-sr-only">{t(`save_${state}`)}</span>
    </span>
  )
}
