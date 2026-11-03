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
  ImagePlus,
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
import { Button, FieldError, Input, Label } from '../../../shared/ui'
import type { EditorElement } from '../model/editor-element'
import {
  STORY_PHOTO_FILTERS,
  type StoryPhotoFilter,
  type StoryStage,
} from '../model/use-story-stage'
import { ElementInspector } from './element-inspector'

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

/** Шапка панели: заголовок и «закрыть» — снять выбор или вернуться к общим настройкам. */
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
    <div className="flex items-center gap-2">
      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
      {onClose && (
        <button
          type="button"
          aria-label={tCommon('close')}
          onClick={onClose}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground motion-reduce:transition-none',
            closeClassName,
          )}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      {children}
    </section>
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
      className="flex h-10 items-center gap-2 rounded-lg bg-muted/50 px-3 text-left text-sm transition-colors duration-150 hover:bg-muted motion-reduce:transition-none"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0">{label}</span>
      {value && <span className="min-w-0 flex-1 truncate text-muted-foreground">{value}</span>}
      <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
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
    <div className="flex flex-col gap-5">
      <PanelHeader title={t('settingsTitle')} onClose={onClose} closeClassName="xl:hidden" />
      <Section title={t('audienceTitle')}>
        <div className="flex flex-col gap-2">{audience}</div>
      </Section>

      {/* Фон выбирается только у сторис без медиа — поверх фото он не виден. */}
      {!hasMedia && (
        <Section title={t('background')}>
          <div className="flex flex-wrap gap-2">
            {STORY_BACKGROUNDS.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={t(BG_KEY[key])}
                title={t(BG_KEY[key])}
                aria-pressed={(background ?? 'graphite') === key}
                onClick={() => onBackground(key)}
                className={cn(
                  'size-8 rounded-full ring-offset-2 ring-offset-card transition-shadow duration-150',
                  STORY_BACKGROUND_CLASS[key],
                  (background ?? 'graphite') === key && 'ring-2 ring-primary',
                )}
              />
            ))}
          </div>
        </Section>
      )}

      {(linkUrl !== undefined || hasPoll) && (
        <Section title={t('attachments')}>
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
        </Section>
      )}
    </div>
  )
}

/** Выбрано фото или видео: масштаб и подгонка, фильтры, замена и удаление. */
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
    <div className="flex flex-col gap-5">
      <PanelHeader title={kind === 'photo' ? t('photoTitle') : t('videoTitle')} onClose={onClose} />

      {kind === 'photo' && (
        <>
          <Section title={t('zoom')}>
            <input
              type="range"
              aria-label={t('zoom')}
              min={stage.minZoom}
              max={stage.maxZoom}
              step={0.01}
              value={stage.zoom}
              disabled={!stage.ready}
              onChange={(e) => stage.setZoom(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-xs text-muted-foreground">{t('photoHint')}</p>
          </Section>

          <Section title={t('fitTitle')}>
            <div className="grid grid-cols-2 gap-1.5">
              {([false, true] as const).map((whole) => (
                <button
                  key={String(whole)}
                  type="button"
                  aria-pressed={stage.whole === whole}
                  disabled={!stage.ready}
                  onClick={() => stage.whole !== whole && stage.toggleWhole()}
                  className={cn(
                    'h-9 rounded-lg px-2 text-xs font-medium transition-colors duration-150 disabled:opacity-50 motion-reduce:transition-none',
                    stage.whole === whole
                      ? 'bg-primary/15 text-primary'
                      : 'bg-muted/50 hover:bg-muted',
                  )}
                >
                  {whole ? t('fitWhole') : t('fitFill')}
                </button>
              ))}
            </div>
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
                    className="group flex flex-col items-center gap-1 text-xs"
                  >
                    {/* Локальный object-URL: оптимизировать blob next/image не может. */}
                    <img
                      src={stage.url ?? ''}
                      alt=""
                      className={cn(
                        'aspect-square w-full rounded-lg object-cover ring-offset-2 ring-offset-card transition-shadow duration-150',
                        stage.filter === key ? 'ring-2 ring-primary' : 'group-hover:opacity-90',
                      )}
                      style={{ filter: STORY_PHOTO_FILTERS[key] || undefined }}
                    />
                    <span
                      className={stage.filter === key ? 'text-primary' : 'text-muted-foreground'}
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

      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="md" className="flex-1" onClick={onReplace}>
          <RefreshCw className="size-4" aria-hidden />
          {t('replaceMedia')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="md"
          className="text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="size-4" aria-hidden />
          {t('removeMedia')}
        </Button>
      </div>
    </div>
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
    <div className="flex flex-col gap-4">
      <PanelHeader title={t('addLink')} onClose={onClose} />
      <div>
        <Input
          {...form.register('linkUrl', OPTIONAL_TEXT)}
          type="url"
          inputMode="url"
          placeholder="https://"
          aria-label={t('linkUrl')}
          autoFocus
        />
        <FieldError>{form.formState.errors.linkUrl && t('badLink')}</FieldError>
      </div>
      <Input
        {...form.register('linkLabel', OPTIONAL_TEXT)}
        placeholder={t('linkLabel')}
        aria-label={t('linkLabel')}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start text-destructive hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="size-4" aria-hidden />
        {t('removeLink')}
      </Button>
    </div>
  )
}

/** Опрос: вопрос и 2–4 варианта; поля — без лишних рамок вокруг. */
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
    <div className="flex flex-col gap-3">
      <PanelHeader title={t('addPoll')} onClose={onClose} />
      <Label className="text-xs text-muted-foreground" htmlFor="story-poll-question">
        {t('pollQuestion')}
      </Label>
      <Input
        id="story-poll-question"
        {...form.register('poll.question')}
        placeholder={t('pollQuestion')}
        autoFocus
      />
      <div className="flex flex-col gap-2">
        {poll.options.map((option, index) => (
          // Варианты опроса — строки без id, порядок меняется только удалением.
          <div key={index} className="flex items-center gap-1.5">
            <Input
              value={option}
              onChange={(e) =>
                setOptions(poll.options.map((o, i) => (i === index ? e.target.value : o)))
              }
              placeholder={t('pollOption', { n: index + 1 })}
              aria-label={t('pollOption', { n: index + 1 })}
            />
            {poll.options.length > MIN_POLL_OPTIONS && (
              <Button
                type="button"
                variant="ghost"
                size="md"
                icon
                aria-label={t('removeOption')}
                onClick={() => setOptions(poll.options.filter((_, i) => i !== index))}
              >
                <X className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        ))}
      </div>
      {poll.options.length < MAX_POLL_OPTIONS && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setOptions([...poll.options, ''])}
        >
          <Plus className="size-4" aria-hidden />
          {t('addOption')}
        </Button>
      )}
      <FieldError>{form.formState.errors.poll && t('pollIncomplete')}</FieldError>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start text-destructive hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="size-4" aria-hidden />
        {t('removePoll')}
      </Button>
    </div>
  )
}

/** Выбран элемент кадра: его свойства, порядок слоёв, копия и удаление. */
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
  const action =
    'flex size-9 items-center justify-center rounded-lg bg-muted/50 transition-colors duration-150 hover:bg-muted disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none'
  return (
    <div className="flex flex-col gap-4">
      <PanelHeader title={t(ELEMENT_KEY[element.type])} onClose={onClose} />

      {onReplaceCard && (
        <Button type="button" variant="secondary" size="md" onClick={onReplaceCard}>
          <ImagePlus className="size-4" aria-hidden />
          {t('replaceCard')}
        </Button>
      )}

      <ElementInspector element={element} onChange={onChange} />

      <Section title={t('layer')}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={action}
            aria-label={t('bringForward')}
            title={t('bringForward')}
            disabled={!canForward}
            onClick={onForward}
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={action}
            aria-label={t('sendBackward')}
            title={t('sendBackward')}
            disabled={!canBackward}
            onClick={onBackward}
          >
            <ArrowDown className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={action}
            aria-label={t('duplicate')}
            title={t('duplicate')}
            disabled={!canDuplicate}
            onClick={onDuplicate}
          >
            <Copy className="size-4" aria-hidden />
          </button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="size-4" aria-hidden />
            {t('removeElement')}
          </Button>
        </div>
      </Section>
    </div>
  )
}
