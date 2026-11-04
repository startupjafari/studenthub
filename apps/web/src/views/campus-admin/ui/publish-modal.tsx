'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { campusKeys, publishCampus, type CampusTree } from '../../../entities/campus'
import { Button, Label, Modal, Textarea } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

interface Issue {
  floorId: string | null
  code: string
}

/** `floors.<floorId>.<путь>` из details ответа публикации → этаж и код проблемы. */
function parseIssues(details: { field: string; message: string }[] = []): Issue[] {
  return details.map((d) => {
    const m = /^floors\.([0-9a-f-]{36})/.exec(d.field)
    return { floorId: m?.[1] ?? null, code: d.message }
  })
}

/**
 * Публикация: заметка к версии и проверка на сервере той же функцией, что в редакторе. Не
 * прошло — список проблем с переходом в редактор нужного этажа.
 */
export function PublishModal({ tree, onClose }: { tree: CampusTree; onClose: () => void }) {
  const t = useTranslations('Campus')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const floorName = new Map(
    tree.buildings.flatMap((b) =>
      b.floors.map(
        (f) => [f.id, `${b.code ?? b.name} · ${t('floorN', { label: f.label })}`] as const,
      ),
    ),
  )

  const mut = useMutation({
    mutationFn: () =>
      publishCampus(tree.id, {
        note: note.trim() || undefined,
        floorRevisions: Object.fromEntries(
          tree.buildings.flatMap((b) =>
            b.floors.filter((f) => f.plan).map((f) => [f.id, f.plan!.revision]),
          ),
        ),
      }),
    onSuccess: (v) => {
      void qc.invalidateQueries({ queryKey: campusKeys.all })
      toast.success(t('publishedToast', { number: v.number, spaces: v.spaces }))
      onClose()
    },
    onError: (e) => {
      const err = toApiError(e)
      if (err.code === 'VALIDATION_ERROR') setIssues(parseIssues(err.details))
      else toast.error(tErr(err.code))
    },
  })

  return (
    <Modal onClose={onClose} title={t('publish')} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('publishHint')}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="publish-note">{t('publishNote')}</Label>
          <Textarea
            id="publish-note"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {issues && (
          <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4" aria-hidden />
              {t('publishBlocked', { count: issues.length })}
            </p>
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
              {issues.map((i, n) => (
                <li key={n} className="flex items-center justify-between gap-3">
                  <span>
                    {i.floorId ? `${floorName.get(i.floorId) ?? ''}: ` : ''}
                    {t.has(`problem_${i.code}`) ? t(`problem_${i.code}`) : i.code}
                  </span>
                  {i.floorId && (
                    <Link
                      href={`/campus-editor/${i.floorId}`}
                      className="shrink-0 text-primary hover:underline"
                    >
                      {t('openEditor')}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" loading={mut.isPending} onClick={() => mut.mutate()}>
            {t('publish')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
