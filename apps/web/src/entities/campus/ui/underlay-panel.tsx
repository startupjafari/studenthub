'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Eye, EyeOff, ImageUp, Move, Ruler, Trash2 } from 'lucide-react'
import { Button, Input, Label } from '../../../shared/ui'
import { cn } from '../../../shared/lib'
import { useUnderlay, type PlanRect, type UnderlayStore } from '../lib/underlay'

/**
 * Подложка в панели редактора: загрузить снимок или план, задать масштаб по двум точкам,
 * сдвинуть, приглушить, спрятать. Пока включён масштаб или сдвиг, клики по холсту идут
 * подложке, а не инструменту.
 */
export function UnderlayPanel({
  store,
  visibleRect,
}: {
  store: UnderlayStore
  /** Видимая часть плана в мм: новая картинка вписывается в неё. */
  visibleRect: () => PlanRect
}) {
  const t = useTranslations('Campus')
  const fileRef = useRef<HTMLInputElement>(null)
  const distanceId = useId()
  const opacityId = useId()
  const placement = useUnderlay(store, (s) => s.placement)
  const mode = useUnderlay(store, (s) => s.mode)
  const points = useUnderlay(store, (s) => s.calib.length)
  const [distance, setDistance] = useState('')
  const metres = Number(distance.replace(',', '.'))

  const pick = (
    <input
      ref={fileRef}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        store.setFile(file, visibleRect()).catch(() => toast.error(t('underlayBroken')))
      }}
    />
  )

  if (!placement) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('underlay')}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('underlayHint')}</p>
        {pick}
        <Button type="button" variant="outline" size="md" onClick={() => fileRef.current?.click()}>
          <ImageUp aria-hidden />
          {t('underlayUpload')}
        </Button>
      </section>
    )
  }

  const toggle = (next: 'calibrate' | 'move'): void => {
    store.setMode(mode === next ? 'idle' : next)
    setDistance('')
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">{t('underlay')}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon
          aria-label={placement.visible ? t('underlayHide') : t('underlayShow')}
          title={placement.visible ? t('underlayHide') : t('underlayShow')}
          onClick={() => store.update({ visible: !placement.visible })}
        >
          {placement.visible ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon
          aria-label={t('underlayRemove')}
          title={t('underlayRemove')}
          className="text-muted-foreground hover:text-destructive"
          onClick={() => void store.remove()}
        >
          <Trash2 aria-hidden />
        </Button>
      </header>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={opacityId} className="text-xs text-muted-foreground">
          {t('underlayOpacity')}
        </Label>
        <input
          id={opacityId}
          type="range"
          min={10}
          max={100}
          step={5}
          value={Math.round(placement.opacity * 100)}
          onChange={(e) => store.update({ opacity: Number(e.target.value) / 100 })}
          className="w-full accent-primary"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="md"
          variant={mode === 'calibrate' ? 'default' : 'outline'}
          aria-pressed={mode === 'calibrate'}
          onClick={() => toggle('calibrate')}
        >
          <Ruler aria-hidden />
          {t('underlayScale')}
        </Button>
        <Button
          type="button"
          size="md"
          variant={mode === 'move' ? 'default' : 'outline'}
          aria-pressed={mode === 'move'}
          onClick={() => toggle('move')}
        >
          <Move aria-hidden />
          {t('underlayMove')}
        </Button>
      </div>
      {mode === 'move' && <p className="text-xs text-muted-foreground">{t('underlayMoveHint')}</p>}
      {mode === 'calibrate' &&
        (points < 2 ? (
          <p className="text-xs text-muted-foreground">
            {t('underlayScaleHint', { done: points })}
          </p>
        ) : (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (metres > 0) store.calibrate(Math.round(metres * 1000))
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor={distanceId} className="text-xs text-muted-foreground">
                {t('underlayDistance')}
              </Label>
              <Input
                id={distanceId}
                size="md"
                inputMode="decimal"
                autoFocus
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                placeholder="50"
              />
            </div>
            <Button type="submit" size="md" disabled={!(metres > 0)}>
              {t('underlayApply')}
            </Button>
          </form>
        ))}
      {pick}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className={cn(
          'self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline',
          'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
        )}
      >
        {t('underlayReplace')}
      </button>
    </section>
  )
}
