'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronRight, FolderOpen, Link2, Paperclip, Plus } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { fetchMaterials, materialKeys, type Material } from '../../../entities/material'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableText,
  useTableSort,
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
  const canCreate = role !== null && AUTHOR_ROLES.includes(role)

  const materials = useQuery({ queryKey: materialKeys.list(), queryFn: () => fetchMaterials() })
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = materials.data ?? []
  // Сортировки по умолчанию нет: сервер отдаёт материалы в своём порядке, и стрелка
  // в шапке означала бы выбор, которого не делали.
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<Material>(rows, (m, key) => {
    if (key === 'title') return m.title
    if (key === 'subject') return m.subject
    if (key === 'teacher') return `${m.teacher.lastName} ${m.teacher.firstName}`
    if (key === 'files') return m.media.length
    if (key === 'created') return m.createdAt
    return null
  })

  const open = sorted.find((m) => m.id === openId) ?? null

  return (
    // Сквозная flex-цепочка до таблицы: `fill` требует, чтобы каждый предок отдавал ей
    // высоту, иначе прокручивается страница целиком, а не тело таблицы (§10.7).
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
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
      ) : !materials.isLoading && rows.length === 0 ? (
        <EmptyState icon={<FolderOpen className="size-6" aria-hidden />} title={t('empty')} />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="title" sort={sort} onSort={toggle}>
                  {t('materialTitle')}
                </TableHead>
                <TableHead sortKey="subject" sort={sort} onSort={toggle} className={HIDE.subject}>
                  {t('subject')}
                </TableHead>
                <TableHead sortKey="teacher" sort={sort} onSort={toggle} className={HIDE.teacher}>
                  {t('colTeacher')}
                </TableHead>
                <TableHead sortKey="files" sort={sort} onSort={toggle}>
                  {t('colFiles')}
                </TableHead>
                <TableHead sortKey="created" sort={sort} onSort={toggle} className={HIDE.created}>
                  {t('colCreated')}
                </TableHead>
                <TableHead>
                  <span className="sr-only">{t('open')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {sorted.map((m) => (
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
        </Card>
      )}

      {creating && <CreateMaterialModal onClose={() => setCreating(false)} />}
      {open && (
        <MaterialDetailModal
          key={open.id}
          material={open}
          canManage={canCreate}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
