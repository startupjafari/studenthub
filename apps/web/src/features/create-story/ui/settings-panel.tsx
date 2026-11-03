'use client'

import type { ReactNode } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronRight,
  Copy,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import {
  STORY_BACKGROUNDS,
  type CreateStoryInput,
  type StoryBackgroundValue,
} from '@studenthub/shared-schemas'
import { OPTIONAL_TEXT } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { STORY_BACKGROUND_CLASS } from '../../../entities/story'
import { Button, FieldError, Input } from '../../../shared/ui'
import type { EditorElement } from '../model/editor-element'
import {
  STORY_PHOTO_FILTERS,
  type StoryPhotoFilter,
  type StoryStage,
} from '../model/use-story-stage'
import { ElementInspector } from './element-inspector'
import { ICON_ACTION, RangeField, Section, Segmented, SwatchGrid } from './editor-controls'

/** Что показывает правая панель, когда на кадре ничего не выбрано. */
export type SettingsView = 'general' | 'media' | 'link' | 'poll'

export const MAX_POLL_OPTIONS = 4
export const MIN_POLL_OPTIONS = 2

const BG_KEY: Record<StoryBackgroundValue, string> = {
  sunset: 'bgSunset',
  ocean: 'bgOcean',
  forest: 'bgForest',
  grape: 'bgGrape',
  graphite: 'bgGraphite',
  rose: 'bgRose',
}

const FILTER_KEY: Record<StoryPhotoFilter, string> = {
  none: 'filterNone',
  vivid: 'filterVivid',
  warm: 'filterWarm',
  cool: 'filterCool',
  fade: 'filterFade',
  mono: 'filterMono',
}

const ELEMENT_KEY = {
  text: 'toolText',
  emoji: 'toolEmoji',
  mention: 'toolMention',
  event: 'toolEvent',
  post: 'toolPost',
  schedule: 'toolPair',
} as const

/** Тело панели: секции через 24px. */
function Panel({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>
}

/** Шапка панели 36px: заголовок и «закрыть» — снять выбор или вернуться к общим. */
export function PanelHeader({
  title,
  onClose,
  closeClassName,
}: {
  title: string
  onClose?: () => void
  closeClassName?: string
}) {
  const tCommon = useTranslations('Common')
  return (
    <div className="flex h-9 items-center gap-2">
      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
      {onClose && (
        <button
          type="button"
          aria-label={tCommon('close')}
          onClick={onClose}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground motion-reduce:transition-none',
            closeClassName,
          )}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

/** Строка-ссылка на вложенную настройку: «Ссылка · example.com ›». */
function Row({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: typeof Link2
  label: string
  value?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 items-center gap-3 rounded-[10px] bg-muted/50 px-3 text-left text-sm transition-colors duration-150 hover:bg-muted motion-reduce:transition-none"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0">{label}</span>
      {value && <span className="min-w-0 flex-1 truncate text-muted-foreground">{value}</span>}
      <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

/** Удалить — единственное красное действие панели. */
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="md"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={onClick}
    >
      <Trash2 className="size-4" aria-hidden />
      {label}
    </Button>
  )
}

/** Ничего не выбрано: аудитория, фон текстовой сторис, ссылка и опрос, если они есть. */
export function GeneralSettings({
  audience,
  hasMedia,
  background,
  onBackground,
  linkUrl,
  pollQuestion,
  hasPoll,
  onOpen,
  onClose,
}: {
  /** Выбор аудитории — тот же, что и у смены аудитории вышедшей сторис. */
  audience: ReactNode
  hasMedia: boolean
  background: StoryBackgroundValue | undefined
  onBackground: (value: StoryBackgroundValue) => void
  linkUrl: string | undefined
  pollQuestion: string | undefined
  hasPoll: boolean
  onOpen: (view: SettingsView) => void
  /** Закрыть шторку на узком экране; на широком общие настройки видны всегда. */
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  return (
    <Panel>
      <PanelHeader title={t('settingsTitle')} onClose={onClose} closeClassName="lg:hidden" />
      <Section title={t('audienceTitle')}>
        <div className="flex flex-col gap-2">{audience}</div>
      </Section>

      {/* Фон выбирается только у сторис без медиа — поверх фото он не виден. */}
      {!hasMedia && (
        <Section title={t('background')}>
          <SwatchGrid
            label={t('background')}
            value={background ?? 'graphite'}
            onChange={onBackground}
            options={STORY_BACKGROUNDS.map((key) => ({
              value: key,
              label: t(BG_KEY[key]),
              className: STORY_BACKGROUND_CLASS[key],
            }))}
          />
        </Section>
      )}

      {(linkUrl !== undefined || hasPoll) && (
        <Section title={t('attachments')}>
          <div className="flex flex-col gap-2">
            {linkUrl !== undefined && (
              <Row
                icon={Link2}
                label={t('addLink')}
                value={linkUrl || undefined}
                onClick={() => onOpen('link')}
              />
            )}
            {hasPoll && (
              <Row
                icon={BarChart3}
                label={t('addPoll')}
                value={pollQuestion || undefined}
                onClick={() => onOpen('poll')}
              />
            )}
          </div>
        </Section>
      )}
    </Panel>
  )
}

/** Выбрано фото или видео: масштаб и размещение, фильтры, замена и удаление. */
export function MediaSettings({
  kind,
  stage,
  filtersSupported,
  onReplace,
  onRemove,
  onClose,
}: {
  kind: 'photo' | 'video'
  stage: StoryStage
  /** Фильтр запекается в кадр через canvas; без его поддержки фильтров не предлагаем. */
  filtersSupported: boolean
  onReplace: () => void
  onRemove: () => void
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  return (
    <Panel>
      <PanelHeader title={kind === 'photo' ? t('photoTitle') : t('videoTitle')} onClose={onClose} />

      {kind === 'photo' && (
        <>
          <Section title={t('fitTitle')}>
            <Segmented
              label={t('fitTitle')}
              value={stage.whole ? 'whole' : 'fill'}
              disabled={!stage.ready}
              onChange={(next) => (next === 'whole') !== stage.whole && stage.toggleWhole()}
              options={[
                { value: 'fill', label: t('fitFill') },
                { value: 'whole', label: t('fitWhole') },
              ]}
            />
            <RangeField
              label={t('zoom')}
              value={stage.zoom}
              display={`${Math.round(stage.zoom * 100)}%`}
              min={stage.minZoom}
              max={stage.maxZoom}
              step={0.01}
              disabled={!stage.ready}
              onChange={stage.setZoom}
              onReset={() => stage.setZoom(1)}
            />
          </Section>

          {filtersSupported && stage.url && (
            <Section title={t('filters')}>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(STORY_PHOTO_FILTERS) as StoryPhotoFilter[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={stage.filter === key}
                    onClick={() => stage.setFilter(key)}
                    className="group flex flex-col gap-1.5 text-xs"
                  >
                    {/* Локальный object-URL: оптимизировать blob next/image не может. */}
                    <img
                      src={stage.url ?? ''}
                      alt=""
                      className={cn(
                        'aspect-square w-full rounded-lg object-cover ring-offset-2 ring-offset-card transition-shadow duration-150 motion-reduce:transition-none',
                        stage.filter === key ? 'ring-2 ring-primary' : 'group-hover:opacity-90',
                      )}
                      style={{ filter: STORY_PHOTO_FILTERS[key] || undefined }}
                    />
                    <span
                      className={cn(
                        'truncate text-center',
                        stage.filter === key ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {t(FILTER_KEY[key])}
                    </span>
                  </button>
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" size="md" onClick={onReplace}>
          <RefreshCw className="size-4" aria-hidden />
          {t('replaceMedia')}
        </Button>
        <RemoveButton label={t('removeMedia')} onClick={onRemove} />
      </div>
    </Panel>
  )
}

/** Ссылка внизу сторис: адрес и подпись кнопки. */
export function LinkSettings({
  form,
  onRemove,
  onClose,
}: {
  form: UseFormReturn<CreateStoryInput>
  onRemove: () => void
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  return (
    <Panel>
      <PanelHeader title={t('addLink')} onClose={onClose} />
      <Section title={t('linkUrl')}>
        <div className="flex flex-col gap-2">
          <Input
            {...form.register('linkUrl', OPTIONAL_TEXT)}
            type="url"
            inputMode="url"
            size="md"
            placeholder="https://"
            aria-label={t('linkUrl')}
            autoFocus
          />
          <FieldError>{form.formState.errors.linkUrl && t('badLink')}</FieldError>
          <Input
            {...form.register('linkLabel', OPTIONAL_TEXT)}
            size="md"
            placeholder={t('linkLabel')}
            aria-label={t('linkLabel')}
          />
        </div>
      </Section>
      <div>
        <RemoveButton label={t('removeLink')} onClick={onRemove} />
      </div>
    </Panel>
  )
}

/** Опрос: вопрос и 2–4 варианта. */
export function PollSettings({
  form,
  onRemove,
  onClose,
}: {
  form: UseFormReturn<CreateStoryInput>
  onRemove: () => void
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  const poll = form.watch('poll')
  if (!poll) return null

  function setOptions(options: string[]): void {
    form.setValue('poll.options', options, { shouldValidate: form.formState.isSubmitted })
  }

  return (
    <Panel>
      <PanelHeader title={t('addPoll')} onClose={onClose} />
      <Section title={t('pollQuestion')}>
        <Input
          {...form.register('poll.question')}
          size="md"
          placeholder={t('pollQuestion')}
          aria-label={t('pollQuestion')}
          autoFocus
        />
      </Section>
      <Section title={t('pollOptions')}>
        <div className="flex flex-col gap-2">
          {poll.options.map((option, index) => (
            // Варианты опроса — строки без id, порядок меняется только удалением.
            <div key={index} className="flex items-center gap-2">
              <Input
                value={option}
                size="md"
                onChange={(e) =>
                  setOptions(poll.options.map((o, i) => (i === index ? e.target.value : o)))
                }
                placeholder={t('pollOption', { n: index + 1 })}
                aria-label={t('pollOption', { n: index + 1 })}
              />
              <button
                type="button"
                className={ICON_ACTION}
                aria-label={t('removeOption')}
                title={t('removeOption')}
                disabled={poll.options.length <= MIN_POLL_OPTIONS}
                onClick={() => setOptions(poll.options.filter((_, i) => i !== index))}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ))}
          {poll.options.length < MAX_POLL_OPTIONS && (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setOptions([...poll.options, ''])}
            >
              <Plus className="size-4" aria-hidden />
              {t('addOption')}
            </Button>
          )}
        </div>
        <FieldError>{form.formState.errors.poll && t('pollIncomplete')}</FieldError>
      </Section>
      <div>
        <RemoveButton label={t('removePoll')} onClick={onRemove} />
      </div>
    </Panel>
  )
}

/** Выбран элемент кадра: его свойства, затем порядок слоёв, копия и удаление. */
export function ElementSettings({
  element,
  onChange,
  onForward,
  onBackward,
  onDuplicate,
  onRemove,
  onReplaceCard,
  canForward,
  canBackward,
  canDuplicate,
  onClose,
}: {
  element: EditorElement
  onChange: (patch: Partial<EditorElement>) => void
  onForward: () => void
  onBackward: () => void
  onDuplicate: () => void
  onRemove: () => void
  /** Карточка события, публикации или пары — выбрать другую запись, не двигая карточку. */
  onReplaceCard?: () => void
  canForward: boolean
  canBackward: boolean
  canDuplicate: boolean
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  return (
    <Panel>
      <PanelHeader title={t(ELEMENT_KEY[element.type])} onClose={onClose} />

      {onReplaceCard && (
        <Button type="button" variant="secondary" size="md" onClick={onReplaceCard}>
          <RefreshCw className="size-4" aria-hidden />
          {t('replaceCard')}
        </Button>
      )}

      <ElementInspector element={element} onChange={onChange} />

      <Section title={t('layer')}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={ICON_ACTION}
            aria-label={t('bringForward')}
            title={t('bringForward')}
            disabled={!canForward}
            onClick={onForward}
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={ICON_ACTION}
            aria-label={t('sendBackward')}
            title={t('sendBackward')}
            disabled={!canBackward}
            onClick={onBackward}
          >
            <ArrowDown className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={ICON_ACTION}
            aria-label={t('duplicate')}
            title={t('duplicate')}
            disabled={!canDuplicate}
            onClick={onDuplicate}
          >
            <Copy className="size-4" aria-hidden />
          </button>
          <div className="ml-auto">
            <RemoveButton label={t('removeElement')} onClick={onRemove} />
          </div>
        </div>
      </Section>
    </Panel>
  )
}
