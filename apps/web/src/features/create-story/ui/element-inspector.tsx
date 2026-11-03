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
import { Textarea } from '../../../shared/ui'
import type { EditorElement } from '../model/editor-element'
import { RangeField, Section, Segmented, SwatchGrid } from './editor-controls'

const ALIGN_ICON = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const
const ALIGN_KEY = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight' } as const
const FONT_KEY = { sans: 'fontSans', serif: 'fontSerif', mono: 'fontMono' } as const
// Короткие подписи для сегментов: в колонке 280px полные не помещаются.
const FONT_SHORT_KEY = { sans: 'fontSans', serif: 'fontSerifShort', mono: 'fontMono' } as const
const BG_SHORT_KEY = { none: 'bgNoneShort', solid: 'bgSolid', soft: 'bgSoft' } as const
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
// Пределы — как в схеме элемента (StoryElementSchema).
const MIN_SCALE = 0.4
const MAX_SCALE = 3

/**
 * Свойства выбранного элемента, сверху вниз: текст и готовые стили, типографика, цвет,
 * подложка; у любого элемента — размер и поворот. Набор намеренно короткий: три шрифта
 * и шесть цветов, а не палитра на все случаи.
 */
export function ElementInspector({
  element,
  onChange,
}: {
  element: EditorElement
  onChange: (patch: Partial<EditorElement>) => void
}) {
  const t = useTranslations('Stories')
  const transform = (
    <>
      <RangeField
        label={t('size')}
        value={element.scale}
        display={`${Math.round(element.scale * 100)}%`}
        min={MIN_SCALE}
        max={MAX_SCALE}
        step={0.05}
        onChange={(scale) => onChange({ scale })}
        onReset={() => onChange({ scale: 1 })}
      />
      <RangeField
        label={t('rotation')}
        value={element.rotation}
        display={`${element.rotation}°`}
        min={-180}
        max={180}
        step={1}
        onChange={(rotation) => onChange({ rotation })}
        onReset={() => onChange({ rotation: 0 })}
      />
    </>
  )

  if (element.type !== 'text') {
    return <Section title={t('transform')}>{transform}</Section>
  }

  return (
    <>
      <Section title={t('toolText')}>
        <Textarea
          value={element.text}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={2}
          maxLength={STORY_ELEMENT_TEXT_MAX}
          aria-label={t('elementText')}
          className="w-full resize-none rounded-[10px]"
        />
        <div className="grid grid-cols-2 gap-2">
          {TEXT_STYLES.map(([key, patch]) => (
            <button
              key={key}
              type="button"
              onClick={() => onChange(patch)}
              className="h-9 rounded-lg bg-muted/50 px-3 text-xs font-medium transition-colors duration-150 hover:bg-muted motion-reduce:transition-none"
            >
              {t(key)}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('typography')}>
        <Segmented
          label={t('font')}
          value={element.font}
          onChange={(font) => onChange({ font })}
          options={STORY_FONTS.map((font) => ({
            value: font,
            label: t(FONT_SHORT_KEY[font]),
            ariaLabel: t(FONT_KEY[font]),
            className: FONT_CLASS[font],
          }))}
        />
        <Segmented
          label={t('align')}
          value={element.align}
          onChange={(align) => onChange({ align })}
          options={STORY_TEXT_ALIGNS.map((align) => {
            const Icon = ALIGN_ICON[align]
            return {
              value: align,
              ariaLabel: t(ALIGN_KEY[align]),
              label: <Icon className="size-4" aria-hidden />,
            }
          })}
        />
        {transform}
      </Section>

      <Section title={t('color')}>
        <SwatchGrid
          label={t('color')}
          value={element.color}
          onChange={(color) => onChange({ color })}
          options={STORY_TEXT_COLORS.map((color) => ({
            value: color,
            label: t(COLOR_KEY[color]),
            color,
          }))}
        />
      </Section>

      <Section title={t('textBackground')}>
        <Segmented
          label={t('textBackground')}
          value={element.background}
          onChange={(background) => onChange({ background })}
          options={STORY_TEXT_BACKGROUNDS.map((bg) => ({
            value: bg,
            label: t(BG_SHORT_KEY[bg]),
            ariaLabel: t(BG_KEY[bg]),
          }))}
        />
      </Section>
    </>
  )
}
