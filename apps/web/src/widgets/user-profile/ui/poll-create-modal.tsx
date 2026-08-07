'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Check, ChevronDown, ChevronUp, Plus, Save, X } from 'lucide-react'
import { CONTENT_VISIBILITY, POLL_RESULTS_VISIBILITY } from '@studenthub/shared-schemas'
import { createPoll, pollKeys, updatePoll, type PollView } from '../../../entities/poll'
import {
  Button,
  Checkbox,
  FormAlert,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { ContentModal } from './content-modal'

type ClosePreset = 'none' | '1d' | '3d' | '7d' | 'custom'

interface Props {
  userId: string
  initial?: PollView | null
  onClose: () => void
}

export function PollCreateModal({ userId, initial, onClose }: Props) {
  const t = useTranslations('Profile')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const [question, setQuestion] = useState(initial?.question ?? '')
  const [options, setOptions] = useState<string[]>(
    initial ? initial.options.map((o) => o.text) : ['', ''],
  )
  const [multiple, setMultiple] = useState(initial?.multiple ?? false)
  const [anonymous, setAnonymous] = useState(initial?.anonymous ?? true)
  const [allowRevote, setAllowRevote] = useState(initial?.allowRevote ?? false)
  const [resultsVisibility, setResultsVisibility] = useState(
    initial?.resultsVisibility ?? 'AFTER_VOTE',
  )
  const [visibility, setVisibility] = useState(initial?.visibility ?? 'UNIVERSITY')
  const [closePreset, setClosePreset] = useState<ClosePreset>(initial?.closesAt ? 'custom' : 'none')
  const [customClose, setCustomClose] = useState(
    initial?.closesAt ? initial.closesAt.slice(0, 16) : '',
  )
  const [showSettings, setShowSettings] = useState(false)

  const saveMut = useMutation({
    mutationFn: (status: 'DRAFT' | 'PUBLISHED') => {
      const input = {
        question: question.trim(),
        options: options.map((o) => o.trim()).filter(Boolean),
        multiple,
        anonymous,
        allowRevote,
        resultsVisibility: resultsVisibility as (typeof POLL_RESULTS_VISIBILITY)[number],
        visibility: visibility as (typeof CONTENT_VISIBILITY)[number],
        status,
        closesAt: closesAt(),
      }
      return initial ? updatePoll(initial.id, input) : createPoll(input)
    },
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pollKeys.byUser(userId) })
      toast.success(t('saved'))
      onClose()
    },
    onError: (e) => showApiError(e),
  })

  function closesAt(): Date | null {
    if (closePreset === 'none') return null
    if (closePreset === 'custom') return customClose ? new Date(customClose) : null
    const days = closePreset === '1d' ? 1 : closePreset === '3d' ? 3 : 7
    return new Date(Date.now() + days * 86_400_000)
  }

  const validOptions = options.map((o) => o.trim()).filter(Boolean)
  const canPublish = question.trim().length > 0 && validOptions.length >= 2

  const closeOptions: { id: ClosePreset; label: string }[] = [
    { id: 'none', label: t('closeNone') },
    { id: '1d', label: t('close1d') },
    { id: '3d', label: t('close3d') },
    { id: '7d', label: t('close7d') },
    { id: 'custom', label: t('closeCustom') },
  ]

  return (
    <ContentModal title={initial ? t('editPoll') : t('addPoll')} onClose={onClose} size="lg">
      <FormAlert error={apiError} />
      {/* Вопрос */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="poll-q">{t('pollQuestion')}</Label>
        <Input
          id="poll-q"
          value={question}
          maxLength={150}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('pollQuestionPlaceholder')}
        />
      </div>

      {/* Варианты */}
      <div className="flex flex-col gap-2">
        <Label>{t('pollOptions')}</Label>
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center text-sm text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <Input
              value={opt}
              maxLength={120}
              onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
              placeholder={t('pollOptionPlaceholder')}
            />
            {options.length > 2 && (
              <button
                type="button"
                aria-label={t('delete')}
                onClick={() => setOptions(options.filter((_, j) => j !== i))}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
        ))}
        {options.length < 10 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => setOptions([...options, ''])}
          >
            <Plus className="size-4" aria-hidden />
            {t('pollAddOption')}
          </Button>
        )}
      </div>

      {/* Настройки (сворачиваемо) */}
      <div className="rounded-xl border border-border">
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          {t('pollSettings')}
          {showSettings ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        {showSettings && (
          <div className="flex flex-col gap-4 border-t border-border p-4">
            <div className="flex flex-col gap-2">
              <Label>{t('pollAnswerType')}</Label>
              <div className="flex gap-2">
                {[
                  { v: false, label: t('pollSingle') },
                  { v: true, label: t('pollMultiple') },
                ].map((o) => (
                  <button
                    key={String(o.v)}
                    type="button"
                    onClick={() => setMultiple(o.v)}
                    className={cn(
                      'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                      multiple === o.v
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={anonymous} onCheckedChange={(v) => setAnonymous(v === true)} />
              {t('pollAnonymous')}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={allowRevote} onCheckedChange={(v) => setAllowRevote(v === true)} />
              {t('pollAllowRevote')}
            </label>

            <div className="flex flex-col gap-2">
              <Label>{t('pollResultsLabel')}</Label>
              <Select value={resultsVisibility} onValueChange={setResultsVisibility}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLL_RESULTS_VISIBILITY.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`pollResults_${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t('pollClose')}</Label>
              <Select value={closePreset} onValueChange={(v) => setClosePreset(v as ClosePreset)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {closeOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {closePreset === 'custom' && (
                <Input
                  type="datetime-local"
                  value={customClose}
                  onChange={(e) => setCustomClose(e.target.value)}
                />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t('pollVisibility')}</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_VISIBILITY.map((v) => (
                    <SelectItem key={v} value={v}>
                      {t(`vis_${v}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          loading={saveMut.isPending && saveMut.variables === 'DRAFT'}
          disabled={!canPublish}
          onClick={() => saveMut.mutate('DRAFT')}
        >
          <Save className="size-4" aria-hidden />
          {t('saveDraft')}
        </Button>
        <Button
          type="button"
          loading={saveMut.isPending && saveMut.variables === 'PUBLISHED'}
          disabled={!canPublish}
          onClick={() => saveMut.mutate('PUBLISHED')}
        >
          <Check className="size-4" aria-hidden />
          {t('publish')}
        </Button>
      </div>
    </ContentModal>
  )
}
