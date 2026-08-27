'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { DOCUMENT_CATEGORIES } from '@studenthub/shared-config'
import {
  deleteDocumentType,
  documentTypeKeys,
  fetchDocumentTypes,
  updateDocumentType,
  type EffectiveDocumentType,
} from '../../../entities/document-type'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableText,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { CreateDocumentTypeModal } from './create-document-type-modal'

// Ширины колонок: включён · тип · категория · поля · срок хранения · сброс.
const COLS = ['3rem', '30%', '16%', '28%', '14%', '3.5rem'] as const
// На узком экране остаются включение, название и срок — то, чем реально управляют.
const HIDE = {
  category: 'hidden md:table-cell',
  fields: 'hidden xl:table-cell',
} as const
const SKELETON_COLS = [undefined, undefined, HIDE.category, HIDE.fields, undefined, undefined]

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

  // Порядок фиксированный: категории идут в порядке справочника, внутри — по названию.
  // Так строки одной категории стоят рядом (их видно колонкой), а сортировки по клику
  // здесь нет намеренно — каталог приходит целиком одним ответом, страниц у него нет.
  // Категория в DTO — строка (каталог гибридный, свои типы вуз заводит сам), поэтому
  // позицию ищем по списку значений, а не через indexOf константного кортежа.
  const catOrder = (category: string): number => {
    const i = (DOCUMENT_CATEGORIES as readonly string[]).indexOf(category)
    // Неизвестная категория (тип добавлен после обновления справочника) — в конец.
    return i === -1 ? DOCUMENT_CATEGORIES.length : i
  }
  const rows = [...(q.data ?? [])].sort((a, b) => {
    const byCat = catOrder(a.category) - catOrder(b.category)
    return byCat !== 0 ? byCat : typeName(a).localeCompare(typeName(b))
  })

  // Цепочка flex до таблицы: `fill` требует, чтобы высоту отдавал каждый предок,
  // иначе прокручивается страница целиком, а не тело таблицы.
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('dt_title')}
        subtitle={t('dt_subtitle')}
        actions={
          <Button size="md" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden /> {t('dt_addCustom')}
          </Button>
        }
      />

      {q.isError ? (
        <p className="text-sm text-destructive">{tErr('INTERNAL_ERROR')}</p>
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS}>
            <TableHeader>
              <TableRow>
                {/* Чекбокс включения — первой колонкой: это главное действие экрана,
                    и глаз идёт по одному вертикальному ряду, а не ищет его в конце строки. */}
                <TableHead>
                  <span className="sr-only">{t('dt_enabled')}</span>
                </TableHead>
                <TableHead>{t('dt_colType')}</TableHead>
                <TableHead className={HIDE.category}>{t('dt_category')}</TableHead>
                <TableHead className={HIDE.fields}>{t('dt_colFields')}</TableHead>
                <TableHead numeric>{t('dt_retention')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('dt_reset')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {rows.map((row) => (
                <TypeRow
                  key={row.typeId}
                  row={row}
                  name={typeName(row)}
                  onChanged={invalidate}
                  onErr={onErr}
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {adding && <CreateDocumentTypeModal onClose={() => setAdding(false)} onErr={onErr} />}
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
    <TableRow className="hover:bg-muted/40">
      <TableCell>
        <Checkbox
          checked={row.enabled}
          onCheckedChange={(v) => updateMut.mutate({ enabled: v === true })}
          aria-label={t('dt_enabled')}
        />
      </TableCell>
      <TableCell>
        <span
          className={cn(
            'flex min-w-0 items-center gap-2 font-medium',
            // Выключенный тип виден, но явно погашен: он остаётся в списке, чтобы его
            // можно было включить обратно.
            !row.enabled && 'text-muted-foreground line-through',
          )}
        >
          <TableText value={name} />
          {row.custom && <Badge variant="info">{t('dt_custom')}</Badge>}
        </span>
      </TableCell>
      <TableCell className={cn(HIDE.category, 'text-muted-foreground')}>
        <TableText value={t(`docCat_${row.category}`)} />
      </TableCell>
      <TableCell className={cn(HIDE.fields, 'text-muted-foreground')}>
        {row.fields.length > 0 ? (
          <TableText value={row.fields.map((f) => t(`dt_field_${f}`)).join(', ')} />
        ) : (
          <span className="text-xs">{t('dt_noFields')}</span>
        )}
      </TableCell>
      <TableCell>
        <span className="flex items-center justify-end gap-1.5">
          <Input
            type="number"
            min={0}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            onBlur={saveRetention}
            placeholder={t('dt_retention')}
            size="sm"
            className="w-20 text-right"
            aria-label={t('dt_retention')}
          />
          <span className="text-xs text-muted-foreground">{t('dt_days')}</span>
        </span>
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={row.custom ? t('dt_delete') : t('dt_reset')}
          title={row.custom ? t('dt_delete') : t('dt_reset')}
          loading={removeMut.isPending}
          onClick={() => removeMut.mutate()}
        >
          {row.custom ? (
            <Trash2 className="size-4" aria-hidden />
          ) : (
            <RotateCcw className="size-4" aria-hidden />
          )}
        </Button>
      </TableCell>
    </TableRow>
  )
}
