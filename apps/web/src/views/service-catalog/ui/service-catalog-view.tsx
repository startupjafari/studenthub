'use client'

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ClipboardList, Plus, Search } from 'lucide-react'
import { ADMIN_PAGE_SIZES } from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import {
  catalogAdminKeys,
  customizeApplicationService,
  fetchManagedService,
  fetchManagedServices,
  pickLocale,
  type ManagedServiceDetail,
  type ManagedServiceRow,
} from '../../../entities/application-service'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { useAppSelector } from '../../../shared/store'
import { ServiceEditorModal } from './service-editor-modal'

const PAGE_SIZES = ADMIN_PAGE_SIZES

// Услуга · категория · срок · состав (документы/поля) · статус · действие.
const COLS = ['30%', '18%', '10%', '14%', '14%', '14%'] as const
const COLS_NARROW = ['50%', '0', '0', '0', '25%', '25%'] as const
const HIDE = {
  category: 'hidden md:table-cell',
  sla: 'hidden lg:table-cell',
  content: 'hidden lg:table-cell',
} as const
const SKELETON_COLS = [undefined, HIDE.category, HIDE.sla, HIDE.content, undefined, undefined]

// Что открыто в редакторе: новая услуга или существующая (детали догружаются).
type Editing = { kind: 'new' } | { kind: 'existing'; id: string }

/**
 * Каталог услуг вуза (docs/PROJECT.md §3.2). Админ вуза видит свои услуги и шаблоны платформы:
 * шаблон можно «настроить» — вуз получает копию, и студенты дальше видят её вместо шаблона.
 * Админ платформы ведёт сами шаблоны.
 */
export function ServiceCatalogView() {
  const t = useTranslations('ServiceCatalog')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const role = useAppSelector((s) => s.auth.role)
  const isUniAdmin = role === Role.UNIVERSITY_ADMIN
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  const [editing, setEditing] = useState<Editing | null>(null)

  const params = { page, limit, ...(search ? { search } : {}) }
  const query = useQuery({
    queryKey: catalogAdminKeys.list(params),
    queryFn: () => fetchManagedServices(params),
    placeholderData: keepPreviousData,
  })

  const editingId = editing?.kind === 'existing' ? editing.id : null
  const detail = useQuery({
    queryKey: catalogAdminKeys.detail(editingId ?? ''),
    queryFn: () => fetchManagedService(editingId ?? ''),
    enabled: editingId !== null,
  })

  const customize = useMutation({
    mutationFn: customizeApplicationService,
    onSuccess: async (copy) => {
      await qc.invalidateQueries({ queryKey: catalogAdminKeys.all })
      toast.success(t('customized'))
      setEditing({ kind: 'existing', id: copy.id })
    },
    onError: (error) => toast.error(tErr(toApiError(error).code)),
  })

  const rows = query.data?.items ?? []
  const name = (row: { nameRu: string }) =>
    pickLocale(row as unknown as Record<string, unknown>, 'name', locale)

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        subtitle={isUniAdmin ? t('subtitleUniversity') : t('subtitlePlatform')}
        actions={
          <>
            <div className="relative w-full sm:w-56">
              <Search
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                size="md"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <Button size="md" onClick={() => setEditing({ kind: 'new' })}>
              <Plus className="size-4" aria-hidden /> {t('add')}
            </Button>
          </>
        }
      />

      {query.isError ? (
        <EmptyState title={tErr(toApiError(query.error).code)} description={tErr('retryHint')} />
      ) : rows.length === 0 && !query.isLoading ? (
        <EmptyState
          icon={<ClipboardList className="size-6" aria-hidden />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colService')}</TableHead>
                <TableHead className={HIDE.category}>{t('colCategory')}</TableHead>
                <TableHead numeric className={HIDE.sla}>
                  {t('colSla')}
                </TableHead>
                <TableHead className={HIDE.content}>{t('colContent')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">{t('colActions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {rows.map((row) => (
                <ServiceRow
                  key={row.id}
                  row={row}
                  name={name(row)}
                  categoryName={name(row.category)}
                  isUniAdmin={isUniAdmin}
                  customizing={customize.isPending && customize.variables === row.id}
                  onOpen={(id) => setEditing({ kind: 'existing', id })}
                  onCustomize={() => customize.mutate(row.id)}
                />
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            limit={limit}
            total={query.data?.total ?? 0}
            onPageChange={setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={(n) => {
              setLimit(n)
              setPage(1)
            }}
          />
        </Card>
      )}

      {editing?.kind === 'new' && (
        <ServiceEditorModal
          service={null}
          onClose={() => setEditing(null)}
          onCustomized={(id) => setEditing({ kind: 'existing', id })}
        />
      )}
      {/* key — чтобы форма пересоздалась с данными другой услуги (после «Настроить»). */}
      {editing?.kind === 'existing' && detail.data && (
        <ServiceEditorModal
          key={detail.data.id}
          service={detail.data as ManagedServiceDetail}
          onClose={() => setEditing(null)}
          onCustomized={(id) => setEditing({ kind: 'existing', id })}
        />
      )}
    </div>
  )
}

function ServiceRow({
  row,
  name,
  categoryName,
  isUniAdmin,
  customizing,
  onOpen,
  onCustomize,
}: {
  row: ManagedServiceRow
  name: string
  categoryName: string
  isUniAdmin: boolean
  customizing: boolean
  onOpen: (id: string) => void
  onCustomize: () => void
}) {
  const t = useTranslations('ServiceCatalog')
  // Шаблон, который вуз уже настроил: студенты его не видят — видят копию.
  const replaced = row.isTemplate && row.customizedId !== null

  return (
    <TableRow className="hover:bg-muted/40">
      <TableCell>
        <span className={cn('flex min-w-0 flex-col', (!row.active || replaced) && 'opacity-60')}>
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <TableText value={name} />
            {isUniAdmin && row.isTemplate && <Badge variant="outline">{t('template')}</Badge>}
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">{row.code}</span>
        </span>
      </TableCell>
      <TableCell className={cn(HIDE.category, 'text-muted-foreground')}>
        <TableText value={categoryName} />
      </TableCell>
      <TableCell className={cn(HIDE.sla, 'text-right text-muted-foreground tabular-nums')}>
        {t('slaValue', { hours: row.slaHours })}
      </TableCell>
      <TableCell className={cn(HIDE.content, 'text-muted-foreground')}>
        <TableText
          value={t('contentValue', { docs: row.requirementsCount, fields: row.formFieldsCount })}
        />
      </TableCell>
      <TableCell>
        {replaced ? (
          <Badge variant="secondary">{t('statusReplaced')}</Badge>
        ) : row.active ? (
          <Badge variant="success">{t('statusActive')}</Badge>
        ) : (
          <Badge variant="outline">{t('statusInactive')}</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        {isUniAdmin && row.isTemplate ? (
          replaced ? (
            <Button size="sm" variant="ghost" onClick={() => onOpen(row.customizedId ?? row.id)}>
              {t('openCopy')}
            </Button>
          ) : (
            <span className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => onOpen(row.id)}>
                {t('view')}
              </Button>
              <Button size="sm" variant="outline" loading={customizing} onClick={onCustomize}>
                {t('customize')}
              </Button>
            </span>
          )
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onOpen(row.id)}>
            {t('edit')}
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}
