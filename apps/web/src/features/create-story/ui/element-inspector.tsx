'use client'

import { useTranslations } from 'next-intl'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import {
  STORY_ELEMENT_TEXT_MAX,
  STORY_FONTS,
  STORY_TEXT_ALIGNS,
  STORY_TEXT_BACKGROUNDS,
  STORY_TEXT_COLORS,
} from '@studenthub/shared-schemas'
import { Label, Textarea } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import type { EditorElement } from '../model/editor-element'

const ALIGN_ICON = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const
const ALIGN_KEY = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight' } as const
const FONT_KEY = { sans: 'fontSans', serif: 'fontSerif', mono: 'fontMono' } as const
const FONT_CLASS = { sans: 'font-sans', serif: 'font-serif', mono: 'font-mono' } as const
const BG_KEY = { none: 'bgNone', solid: 'bgSolid', soft: 'bgSoft' } as const
// Готовые стили текста — сочетания тех же полей, что ниже: новых свойств на сервер не уходит.
const TEXT_STYLES = [
  ['stylePlain', { font: 'sans', background: 'none', scale: 1 }],
  ['styleHeading', { font: 'sans', background: 'none', scale: 1.8 }],
  ['styleAccent', { background: 'soft', scale: 1.1 }],
  ['styleBoxed', { background: 'solid', scale: 1 }],
] as const
const COLOR_KEY: Record<(typeof STORY_TEXT_COLORS)[number], string> = {
  '#ffffff': 'colorWhite',
  '#0f1115': 'colorBlack',
  '#2b72e5': 'colorBlue',
  '#facc15': 'colorYellow',
  '#ef4444': 'colorRed',
  '#22c55e': 'colorGreen',
}

/**
 * Свойства выбранного элемента. У текста — готовые стили, содержание, цвет, шрифт,
 * выравнивание и подложка; у всех — размер и поворот. Набор намеренно короткий: три
 * шрифта и шесть цветов, а не палитра на все случаи.
 */
export function ElementInspector({
  element,
  onChange,
}: {
  element: EditorElement
  onChange: (patch: Partial<EditorElement>) => void
}) {
  const t = useTranslations('Stories')
  const chip = (active: boolean) =>
    cn(
      'h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors duration-150',
      active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted',
    )

  return (
    <div className="flex flex-col gap-3">
      {element.type === 'text' && (
        <div className="grid grid-cols-2 gap-1.5">
          {TEXT_STYLES.map(([key, patch]) => (
            <button
              key={key}
              type="button"
              onClick={() => onChange(patch)}
              className={cn(chip(false), 'h-9')}
            >
              {t(key)}
            </button>
          ))}
        </div>
      )}
      {element.type === 'text' && (
        <Textarea
          value={element.text}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={2}
          maxLength={STORY_ELEMENT_TEXT_MAX}
          aria-label={t('elementText')}
        />
      )}

      <div className="flex items-center gap-3">
        <Label htmlFor="story-element-size" className="w-24 shrink-0 text-xs text-muted-foreground">
          {t('size')}
        </Label>
        <input
          id="story-element-size"
          type="range"
          min={0.4}
          max={3}
          step={0.1}
          value={element.scale}
          onChange={(e) => onChange({ scale: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </div>

      <div className="flex items-center gap-3">
        <Label
          htmlFor="story-element-rotation"
          className="w-24 shrink-0 text-xs text-muted-foreground"
        >
          {t('rotation')}
        </Label>
        <input
          id="story-element-rotation"
          type="range"
          min={-180}
          max={180}
          step={1}
          value={element.rotation}
          onChange={(e) => onChange({ rotation: Number(e.target.value) })}
          onDoubleClick={() => onChange({ rotation: 0 })}
          className="w-full accent-primary"
        />
        <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {element.rotation}°
        </span>
      </div>

      {element.type === 'text' && (
        <>
          <div className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{t('color')}</span>
            <div className="flex flex-wrap gap-1.5">
              {STORY_TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={t(COLOR_KEY[color])}
                  aria-pressed={element.color === color}
                  onClick={() => onChange({ color })}
                  className={cn(
                    'size-7 rounded-full border border-border ring-offset-2 ring-offset-background transition-shadow duration-150',
                    element.color === color && 'ring-2 ring-primary',
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{t('font')}</span>
            <div className="flex flex-wrap gap-1.5">
              {STORY_FONTS.map((font) => (
                <button
                  key={font}
                  type="button"
                  aria-pressed={element.font === font}
                  onClick={() => onChange({ font })}
                  className={cn(chip(element.font === font), FONT_CLASS[font])}
                >
                  {t(FONT_KEY[font])}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{t('align')}</span>
            <div className="flex gap-1.5">
              {STORY_TEXT_ALIGNS.map((align) => {
                const Icon = ALIGN_ICON[align]
                return (
                  <button
                    key={align}
                    type="button"
                    aria-label={t(ALIGN_KEY[align])}
                    aria-pressed={element.align === align}
                    onClick={() => onChange({ align })}
                    className={cn(chip(element.align === align), 'flex w-8 justify-center px-0')}
                  >
                    <Icon className="size-4 self-center" aria-hidden />
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">
              {t('textBackground')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {STORY_TEXT_BACKGROUNDS.map((bg) => (
                <button
                  key={bg}
                  type="button"
                  aria-pressed={element.background === bg}
                  onClick={() => onChange({ background: bg })}
                  className={chip(element.background === bg)}
                >
                  {t(BG_KEY[bg])}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
