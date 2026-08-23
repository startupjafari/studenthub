'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { FileCog, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { DOCUMENT_CATEGORIES } from '@studenthub/shared-config'
import { DOCUMENT_FIELD_VALUES } from '@studenthub/shared-schemas'
import {
  createCustomDocumentType,
  deleteDocumentType,
  documentTypeKeys,
  fetchDocumentTypes,
  updateDocumentType,
  type EffectiveDocumentType,
} from '../../../entities/document-type'
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

// Экран «Типы документов» (Ф15D, 15.20): админ вуза включает/выключает типы,
// задаёт срок хранения и добавляет собственные типы. Каталог гибридный (статика + правки).
export function DocumentTypesAdminView() {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const q = useQuery({ queryKey: documentTypeKeys.list(), queryFn: fetchDocumentTypes })

  const invalidate = () => qc.invalidateQueries({ queryKey: documentTypeKeys.all })
  const onErr = (e: unknown) => toast.error(tErr(errCode(e)))

  const typeName = (t2: EffectiveDocumentType) =>
    t2.custom ? (t2.label ?? t2.typeId) : t(`docType_${t2.typeId}`)

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title={t('dt_title')}
        subtitle={t('dt_subtitle')}
        actions={
          <Button onClick={() => setAdding((v) => !v)}>
            <Plus className="size-4" aria-hidden /> {t('dt_addCustom')}
          </Button>
        }
      />

      {adding && <AddCustomForm onDone={() => setAdding(false)} onErr={onErr} />}

      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : q.isError ? (
        <p className="text-sm text-destructive">{tErr('INTERNAL_ERROR')}</p>
      ) : (
        DOCUMENT_CATEGORIES.map((cat) => {
          const rows = (q.data ?? []).filter((x) => x.category === cat)
          if (rows.length === 0) return null
          return (
            <section key={cat} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{t(`docCat_${cat}`)}</h2>
              <div className="divide-y divide-border rounded-xl border border-border">
                {rows.map((row) => (
                  <TypeRow
                    key={row.typeId}
                    row={row}
                    name={typeName(row)}
                    onChanged={invalidate}
                    onErr={onErr}
                  />
                ))}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}

function TypeRow({
  row,
  name,
  onChanged,
  onErr,
}: {
  row: EffectiveDocumentType
  name: string
  onChanged: () => void
  onErr: (e: unknown) => void
}) {
  const t = useTranslations('Documents')
  const [retention, setRetention] = useState(row.retentionDays?.toString() ?? '')

  const updateMut = useMutation({
    mutationFn: (input: { enabled?: boolean; retentionDays?: number | null }) =>
      updateDocumentType(row.typeId, input),
    onSuccess: onChanged,
    onError: onErr,
  })
  const removeMut = useMutation({
    mutationFn: () => deleteDocumentType(row.typeId),
    onSuccess: () => {
      onChanged()
      toast.success(t('dt_removed'))
    },
    onError: onErr,
  })

  const saveRetention = () => {
    const trimmed = retention.trim()
    const next = trimmed === '' ? null : Number(trimmed)
    if (next !== null && (!Number.isInteger(next) || next < 0)) return
    if (next === (row.retentionDays ?? null)) return
    updateMut.mutate({ retentionDays: next })
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <Checkbox
          checked={row.enabled}
          onCheckedChange={(v) => updateMut.mutate({ enabled: v === true })}
          aria-label={t('dt_enabled')}
        />
        <span
          className={`truncate font-medium ${!row.enabled ? 'text-muted-foreground line-through' : ''}`}
        >
          {name}
        </span>
        {row.custom && <Badge variant="info">{t('dt_custom')}</Badge>}
        {!row.enabled && <Badge variant="outline">{t('dt_disabled')}</Badge>}
      </label>

      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          value={retention}
          onChange={(e) => setRetention(e.target.value)}
          onBlur={saveRetention}
          placeholder={t('dt_retention')}
          className="h-9 w-28"
          aria-label={t('dt_retention')}
        />
        <span className="text-xs text-muted-foreground">{t('dt_days')}</span>
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label={row.custom ? t('dt_delete') : t('dt_reset')}
        loading={removeMut.isPending}
        onClick={() => removeMut.mutate()}
      >
        {row.custom ? (
          <Trash2 className="size-4" aria-hidden />
        ) : (
          <RotateCcw className="size-4" aria-hidden />
        )}
      </Button>
    </div>
  )
}

function AddCustomForm({ onDone, onErr }: { onDone: () => void; onErr: (e: unknown) => void }) {
  const t = useTranslations('Documents')
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [category, setCategory] = useState<string>(DOCUMENT_CATEGORIES[0])
  const [label, setLabel] = useState('')
  const [fields, setFields] = useState<string[]>([])
  const [retention, setRetention] = useState('')

  const mut = useMutation({
    mutationFn: () =>
      createCustomDocumentType({
        code: code.trim().toUpperCase(),
        category: category as 'PERSONAL',
        label: label.trim(),
        fields: fields as 'number'[],
        retentionDays: retention.trim() ? Number(retention.trim()) : undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentTypeKeys.all })
      toast.success(t('dt_created'))
      onDone()
    },
    onError: onErr,
  })

  const valid = code.trim().length >= 2 && label.trim().length > 0

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dt-code">{t('dt_code')}</Label>
          <Input
            id="dt-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="CLUB_CARD"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dt-label">{t('dt_label')}</Label>
          <Input id="dt-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t('dt_category')}</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`docCat_${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dt-ret">{t('dt_retention')}</Label>
          <Input
            id="dt-ret"
            type="number"
            min={0}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t('dt_fields')}</Label>
        <div className="flex flex-wrap gap-3">
          {DOCUMENT_FIELD_VALUES.map((f) => (
            <label key={f} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={fields.includes(f)}
                onCheckedChange={(v) =>
                  setFields((prev) => (v === true ? [...prev, f] : prev.filter((x) => x !== f)))
                }
              />
              {t(`dt_field_${f}`)}
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('dt_cancel')}
        </Button>
        <Button onClick={() => mut.mutate()} loading={mut.isPending} disabled={!valid}>
          <FileCog className="size-4" aria-hidden /> {t('dt_add')}
        </Button>
      </div>
    </div>
  )
}
