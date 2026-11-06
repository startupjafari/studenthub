'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronRight, FolderOpen, Link2, Paperclip, Plus } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import type { MaterialSort } from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import { fetchMaterialsPage, materialKeys, type Material } from '../../../entities/material'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  SegmentedTabs,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  usePagedSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { CreateMaterialModal } from './create-material-modal'
import { MaterialDetailModal } from './material-detail-modal'

const AUTHOR_ROLES: Role[] = [Role.TEACHER, Role.DEAN, Role.UNIVERSITY_ADMIN, Role.PLATFORM_ADMIN]

// Название забирает остаток ширины: остальные колонки — короткие и предсказуемые.
const COLS = ['auto', '14rem', '13rem', '7rem', '9rem', '3.5rem'] as const
// Узкий экран: остаются название, вложения и переход — по ним материал и находят.
const COLS_NARROW = ['auto', '0', '0', '5.5rem', '0', '2.75rem'] as const
const HIDE = {
  subject: 'hidden md:table-cell',
  teacher: 'hidden xl:table-cell',
  created: 'hidden lg:table-cell',
} as const
const SKELETON_COLS = [undefined, HIDE.subject, HIDE.teacher, undefined, HIDE.created, undefined]

// «Мои» — по умолчанию: раньше экран показывал общий поток материалов всего вуза, и свой
// материал недельной давности оказывался за пределами выдачи — ни найти, ни удалить.
type TabId = 'mine' | 'all'
const TAB_ORDER: TabId[] = ['mine', 'all']
const TAB_LABEL: Record<TabId, string> = { mine: 'tabMine', all: 'tabAll' }
// Размер страницы — как у остальных таблиц с номерами страниц; предел серверной схемы — 100.
const PAGE_SIZES = [20, 50, 100] as const

/**
 * «Материалы»: таблица материалов, создание и содержимое — в модальных окнах.
 *
 * Форма создания больше не развёрнута на странице (§10.1): она висела над списком у всех
 * ролей, а у каждого материала была своя всегда раскрытая зона загрузки — десяток
 * материалов превращал экран в ленту пунктирных прямоугольников. Теперь строка отвечает
 * «что это, чьё и есть ли вложения», а файлы и ссылка открываются по клику.
 */
export function MaterialsView() {
  const t = useTranslations('Materials')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const role = useAppSelector((s) => s.auth.role)
  const myId = useAppSelector((s) => s.auth.user?.id)
  const canCreate = role !== null && AUTHOR_ROLES.includes(role)
  // Преподаватель управляет только своими материалами (так же решает сервер).
  const canManage = (m: Material): boolean =>
    canCreate && (role !== Role.TEACHER || m.teacher.id === myId)

  const [tab, setTab] = useState<TabId>('mine')
  // Страница и порядок — на сервере: упорядочены все материалы вкладки, а не загруженная
  // часть. Сортировки по умолчанию нет — сервер отдаёт свежие сверху, и стрелка в шапке
  // означала бы выбор, которого не делали. Прежняя страница видна, пока грузится следующая.
  const paged = usePagedSort<MaterialSort>(PAGE_SIZES[0])
  const filters = { ...(tab === 'mine' ? { mine: true } : {}), ...paged.query }
  const materials = useQuery({
    queryKey: materialKeys.page(filters),
    queryFn: () => fetchMaterialsPage(filters),
    placeholderData: keepPreviousData,
  })
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = materials.data?.items ?? []
  const total = materials.data?.total ?? 0
  const open = rows.find((m) => m.id === openId) ?? null

  return (
    // Сквозная flex-цепочка до таблицы: `fill` требует, чтобы каждый предок отдавал ей
    // высоту, иначе прокручивается страница целиком, а не тело таблицы (§10.7).
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        tabs={
          <SegmentedTabs
            aria-label={t('title')}
            value={tab}
            onChange={(next) => {
              // Другая вкладка — другая выборка: листать её начинают с первой страницы.
              setTab(next)
              paged.setPage(1)
            }}
            items={TAB_ORDER.map((id) => ({ value: id, label: t(TAB_LABEL[id]) }))}
          />
        }
        actions={
          canCreate && (
            <Button size="md" className="gap-1.5" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {t('add')}
            </Button>
          )
        }
      />

      {materials.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !materials.isLoading && total === 0 ? (
        <EmptyState icon={<FolderOpen className="size-6" aria-hidden />} title={t('empty')} />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="title" sort={paged.sort} onSort={paged.toggle}>
                  {t('materialTitle')}
                </TableHead>
                <TableHead
                  sortKey="subject"
                  sort={paged.sort}
                  onSort={paged.toggle}
                  className={HIDE.subject}
                >
                  {t('subject')}
                </TableHead>
                <TableHead
                  sortKey="teacher"
                  sort={paged.sort}
                  onSort={paged.toggle}
                  className={HIDE.teacher}
                >
                  {t('colTeacher')}
                </TableHead>
                <TableHead sortKey="files" sort={paged.sort} onSort={paged.toggle}>
                  {t('colFiles')}
                </TableHead>
                <TableHead
                  sortKey="createdAt"
                  sort={paged.sort}
                  onSort={paged.toggle}
                  className={HIDE.created}
                >
                  {t('colCreated')}
                </TableHead>
                <TableHead>
                  <span className="sr-only">{t('open')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {rows.map((m) => (
                <TableRow
                  key={m.id}
                  onClick={() => setOpenId(m.id)}
                  className="cursor-pointer hover:bg-muted/40"
                >
                  <TableCell className="font-medium">
                    <TableText value={m.title} />
                  </TableCell>
                  <TableCell className={cn(HIDE.subject, 'text-muted-foreground')}>
                    {m.subject ? <TableText value={m.subject} /> : <TableEmpty />}
                  </TableCell>
                  <TableCell className={cn(HIDE.teacher, 'text-muted-foreground')}>
                    <TableText value={`${m.teacher.lastName} ${m.teacher.firstName}`} />
                  </TableCell>
                  {/* Вложения одной ячейкой: скрепка с числом файлов и значок ссылки.
                      Две отдельные колонки под «есть файл» и «есть ссылка» стояли бы
                      пустыми у большинства строк. */}
                  <TableCell className="text-muted-foreground">
                    <span className="flex items-center gap-2.5">
                      {m.media.length > 0 && (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Paperclip className="size-3.5 shrink-0" aria-hidden />
                          {m.media.length}
                        </span>
                      )}
                      {m.url && <Link2 className="size-3.5 shrink-0" aria-hidden />}
                      {m.media.length === 0 && !m.url && <TableEmpty />}
                    </span>
                  </TableCell>
                  <TableCell className={cn(HIDE.created, 'text-muted-foreground tabular-nums')}>
                    {new Date(m.createdAt).toLocaleDateString(locale, {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <ChevronRight
                      className="inline-block size-4 text-muted-foreground"
                      aria-hidden
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={paged.page}
            total={total}
            limit={paged.limit}
            onPageChange={paged.setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={paged.setLimit}
          />
        </Card>
      )}

      {creating && <CreateMaterialModal onClose={() => setCreating(false)} />}
      {open && (
        <MaterialDetailModal
          key={open.id}
          material={open}
          canManage={canManage(open)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
