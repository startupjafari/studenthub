'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  ALLOWED_TRANSITIONS,
  applicationKeys,
  transitionApplicationRequest,
  type ApplicationStatusValue,
} from '../../../entities/application'
import { Button, FormAlert, Label } from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'

interface TransitionStatusFormProps {
  applicationId: string
  currentStatus: ApplicationStatusValue
}

export function TransitionStatusForm({ applicationId, currentStatus }: TransitionStatusFormProps) {
  const t = useTranslations('Applications')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const [target, setTarget] = useState<ApplicationStatusValue | null>(null)
  const [comment, setComment] = useState('')

  const targets = ALLOWED_TRANSITIONS[currentStatus]

  const mutation = useMutation({
    mutationFn: (toStatus: ApplicationStatusValue) =>
      transitionApplicationRequest(applicationId, {
        toStatus,
        comment: comment.trim() || undefined,
      }),
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: applicationKeys.detail(applicationId) })
      void qc.invalidateQueries({ queryKey: applicationKeys.all })
      setTarget(null)
      setComment('')
      toast.success(t('statusChanged'))
    },
    onError: (e) => showApiError(e),
  })

  if (targets.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noTransitions')}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <FormAlert error={apiError} />
      <Label>{t('changeStatus')}</Label>
      <div className="flex flex-wrap gap-2">
        {targets.map((s) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={target === s ? 'default' : 'outline'}
            onClick={() => setTarget(s)}
          >
            {t(`status${s}`)}
          </Button>
        ))}
      </div>
      {target && (
        <div className="flex flex-col gap-2">
          <textarea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('commentPlaceholder')}
            className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              loading={mutation.isPending}
              onClick={() => mutation.mutate(target)}
            >
              {t('transitionTo', { status: t(`status${target}`) })}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setTarget(null)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
