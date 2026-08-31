'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { BookOpen, CalendarRange, GraduationCap, Plus, Trash2 } from 'lucide-react'
import {
  Badge,
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
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useConfirm,
  usePagedSort,
} from '../../../shared/ui'
import type { CourseSortValue, SubjectSortValue, TermSortValue } from '@studenthub/shared-schemas'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { useAppSelector } from '../../../shared/store'
import { groupKeys, fetchGroups } from '../../../entities/group'
import {
  courseKeys,
  fetchCoursesPaged,
  fetchSubjectsPaged,
  fetchTermsPaged,
  deleteCourseRequest,
  deleteSubjectRequest,
  deleteTermRequest,
} from '../../../entities/course'
import { CreateSubjectModal } from './create-subject-modal'
import { CreateTermModal } from './create-term-modal'
import { CreateCourseModal } from './create-course-modal'

type ModalKind = 'subject' | 'term' | 'course' | null
type TabKind = 'courses' | 'subjects' | 'terms'

// Потолок 100 — столько разрешает OffsetPaginationSchema, на которой построен GET /courses.
const PAGE_SIZES = [20, 50, 100] as const
// Ширины колонок: дисциплина · группа · семестр · преподаватель · кредиты · «удалить».
const COURSE_COLS = ['26%', '14%', '16%', '24%', '10%', '3.5rem'] as const
// Справочник: дисциплина · код · удаление.
const SUBJECT_COLS = ['60%', '30%', '3.5rem'] as const
// Семестры: название · начало · конец · статус · удаление.
const TERM_COLS = ['32%', '18%', '18%', '18%', '3.5rem'] as const
// На узком экране остаются дисциплина, группа и удаление — остальное дополняющее.
const HIDE = {
  term: 'hidden lg:table-cell',
  teacher: 'hidden md:table-cell',
  credits: 'hidden xl:table-cell',
} as const
// Порядок классов = порядок колонок курсов: скелетон прячет те же, что и шапка.
const SKELETON_COLS = [undefined, undefined, HIDE.term, HIDE.teacher, HIDE.credits, undefined]

// Кнопка справа в шапке — своя у каждой вкладки.
const ADD_ACTION: Record<TabKind, { modal: Exclude<ModalKind, null>; label: string }> = {
  courses: { modal: 'course', label: 'assignCourse' },
  subjects: { modal: 'subject', label: 'addSubject' },
  terms: { modal: 'term', label: 'addTerm' },
}

// Управление дисциплинами (декан/админ вуза): назначение курсов группам, справочник, семестры.
export function CourseAdminView() {
  const t = useTranslations('CourseAdmin')
  const locale = useLocale()
  // Дата приходит ISO-строкой; раньше её резали как `.slice(0, 10)` — на экране
  // оказывался машинный формат 2025-09-01 вместо привычного пользователю.
  const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString(locale)
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()
  const universityId = useAppSelector((s) => s.auth.universityId)
  const [modal, setModal] = useState<ModalKind>(null)
  // Вкладка стала управляемой: её переключатель уехал в шапку страницы, а кнопка
  // действия справа зависит от того, какая вкладка открыта.
  const [tab, setTab] = useState<TabKind>('courses')
  // Страница и порядок — свои у каждой вкладки: наборы колонок разные, и общее
  // состояние сбрасывало бы сортировку при переключении.
  const coursesPage = usePagedSort<CourseSortValue>()
  const subjectsPage = usePagedSort<SubjectSortValue>()
  const termsPage = usePagedSort<TermSortValue>()

  const courses = useQuery({
    queryKey: courseKeys.list(coursesPage.query),
    queryFn: () => fetchCoursesPaged(coursesPage.query),
    retry: false,
    // Прежние строки держатся на экране, пока грузится следующая страница.
    placeholderData: (prev) => prev,
  })
  const subjects = useQuery({
    queryKey: courseKeys.subjects(subjectsPage.query),
    queryFn: () => fetchSubjectsPaged(subjectsPage.query),
    retry: false,
    placeholderData: (prev) => prev,
  })
  const terms = useQuery({
    queryKey: courseKeys.terms(termsPage.query),
    queryFn: () => fetchTermsPaged(termsPage.query),
    retry: false,
    placeholderData: (prev) => prev,
  })
  const groups = useQuery({ queryKey: groupKeys.list(), queryFn: () => fetchGroups() })

  const del = useMutation({
    mutationFn: async (task: { kind: Exclude<ModalKind, null>; id: string }) => {
      if (task.kind === 'subject') return deleteSubjectRequest(task.id)
      if (task.kind === 'term') return deleteTermRequest(task.id)
      return deleteCourseRequest(task.id)
    },
    onSuccess: () => {
      // Префикс ['courses'] — ключи списков содержат объект параметров (страница,
      // сортировка), и точечная инвалидация мимо него не попадёт.
      qc.invalidateQueries({ queryKey: courseKeys.all })
      toast.success(t('deleted'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  const courseRows = courses.data?.items ?? []
  const coursesTotal = courses.data?.total ?? 0
  const subjectRows = subjects.data?.items ?? []
  const subjectsTotal = subjects.data?.total ?? 0
  const termRows = terms.data?.items ?? []
  const termsTotal = terms.data?.total ?? 0

  async function onDelete(kind: Exclude<ModalKind, null>, id: string, name: string) {
    const ok = await confirm({ title: t('confirmDelete'), description: name, destructive: true })
    if (ok) del.mutate({ kind, id })
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      {/* PageHeader внутри Tabs: TabsList обязан жить внутри корня Radix, иначе
          переключатель не связан с содержимым. */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabKind)}
        // Цепочка flex до таблицы: `fill` у Table требует, чтобы каждый предок отдавал
        // ей высоту, иначе прокручивается страница целиком, а не тело таблицы.
        className="flex min-h-0 flex-1 flex-col"
      >
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          tabs={
            <TabsList>
              <TabsTrigger value="courses">{t('tab.courses')}</TabsTrigger>
              <TabsTrigger value="subjects">{t('tab.subjects')}</TabsTrigger>
              <TabsTrigger value="terms">{t('tab.terms')}</TabsTrigger>
            </TabsList>
          }
          actions={
            // Действие своё у каждой вкладки: назначить курс, добавить дисциплину, семестр.
            <Button size="md" onClick={() => setModal(ADD_ACTION[tab].modal)}>
              <Plus className="size-4" aria-hidden />
              {t(ADD_ACTION[tab].label)}
            </Button>
          }
        />

        {/* Курсы */}
        <TabsContent value="courses" className="flex min-h-0 flex-1 flex-col">
          {!courses.isLoading && coursesTotal === 0 ? (
            <EmptyState
              icon={<BookOpen />}
              title={t('noCourses')}
              description={t('noCoursesHint')}
            />
          ) : (
            <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
              <Table fixed scrollBody fill cols={COURSE_COLS}>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      sortKey="subject"
                      sort={coursesPage.sort}
                      onSort={coursesPage.toggle}
                    >
                      {t('colSubject')}
                    </TableHead>
                    <TableHead sortKey="group" sort={coursesPage.sort} onSort={coursesPage.toggle}>
                      {t('colGroup')}
                    </TableHead>
                    <TableHead
                      sortKey="term"
                      sort={coursesPage.sort}
                      onSort={coursesPage.toggle}
                      className={HIDE.term}
                    >
                      {t('colTerm')}
                    </TableHead>
                    <TableHead
                      sortKey="teacher"
                      sort={coursesPage.sort}
                      onSort={coursesPage.toggle}
                      className={HIDE.teacher}
                    >
                      {t('colTeacher')}
                    </TableHead>
                    <TableHead
                      numeric
                      sortKey="credits"
                      sort={coursesPage.sort}
                      onSort={coursesPage.toggle}
                      className={HIDE.credits}
                    >
                      {t('colCredits')}
                    </TableHead>
                    <TableHead>
                      <span className="sr-only">{t('delete')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {courses.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
                  {courseRows.map((c) => (
                    <TableRow key={c.id} className="hover:bg-muted/40">
                      <TableCell className="font-medium">
                        <TableText value={c.subject.name} />
                      </TableCell>
                      <TableCell>
                        <TableText value={c.group.name} />
                      </TableCell>
                      <TableCell className={cn(HIDE.term, 'text-muted-foreground')}>
                        {c.term ? <TableText value={c.term.name} /> : <TableEmpty />}
                      </TableCell>
                      <TableCell className={cn(HIDE.teacher, 'text-muted-foreground')}>
                        {c.teacher ? (
                          <TableText value={`${c.teacher.firstName} ${c.teacher.lastName}`} />
                        ) : (
                          <TableEmpty />
                        )}
                      </TableCell>
                      <TableCell className={cn(HIDE.credits, 'text-right tabular-nums')}>
                        {c.credits != null ? c.credits : <TableEmpty />}
                      </TableCell>
                      <TableCell>
                        <DeleteButton
                          onClick={() => onDelete('course', c.id, c.subject.name)}
                          label={t('delete')}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                page={coursesPage.page}
                total={coursesTotal}
                limit={coursesPage.limit}
                onPageChange={coursesPage.setPage}
                limitOptions={PAGE_SIZES}
                onLimitChange={coursesPage.setLimit}
              />
            </Card>
          )}
        </TabsContent>

        {/* Справочник дисциплин */}
        <TabsContent value="subjects" className="flex min-h-0 flex-1 flex-col">
          {!subjects.isLoading && subjectsTotal === 0 ? (
            <EmptyState
              icon={<GraduationCap />}
              title={t('noSubjects')}
              description={t('noSubjectsHint')}
            />
          ) : (
            <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
              <Table fixed scrollBody fill cols={SUBJECT_COLS}>
                <TableHeader>
                  <TableRow>
                    <TableHead sortKey="name" sort={subjectsPage.sort} onSort={subjectsPage.toggle}>
                      {t('colSubject')}
                    </TableHead>
                    <TableHead sortKey="code" sort={subjectsPage.sort} onSort={subjectsPage.toggle}>
                      {t('colCode')}
                    </TableHead>
                    <TableHead>
                      <span className="sr-only">{t('delete')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subjects.isLoading && <TableSkeletonRows columns={3} />}
                  {subjectRows.map((sub) => (
                    <TableRow key={sub.id} className="hover:bg-muted/40">
                      <TableCell className="font-medium">
                        <TableText value={sub.name} />
                      </TableCell>
                      <TableCell>
                        {sub.code ? <Badge variant="secondary">{sub.code}</Badge> : <TableEmpty />}
                      </TableCell>
                      <TableCell>
                        <DeleteButton
                          onClick={() => onDelete('subject', sub.id, sub.name)}
                          label={t('delete')}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                page={subjectsPage.page}
                total={subjectsTotal}
                limit={subjectsPage.limit}
                onPageChange={subjectsPage.setPage}
                limitOptions={PAGE_SIZES}
                onLimitChange={subjectsPage.setLimit}
              />
            </Card>
          )}
        </TabsContent>

        {/* Семестры */}
        <TabsContent value="terms" className="flex min-h-0 flex-1 flex-col">
          {!terms.isLoading && termsTotal === 0 ? (
            <EmptyState
              icon={<CalendarRange />}
              title={t('noTerms')}
              description={t('noTermsHint')}
            />
          ) : (
            <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
              <Table fixed scrollBody fill cols={TERM_COLS}>
                <TableHeader>
                  <TableRow>
                    <TableHead sortKey="name" sort={termsPage.sort} onSort={termsPage.toggle}>
                      {t('colTerm')}
                    </TableHead>
                    <TableHead sortKey="startsOn" sort={termsPage.sort} onSort={termsPage.toggle}>
                      {t('colStartsOn')}
                    </TableHead>
                    <TableHead sortKey="endsOn" sort={termsPage.sort} onSort={termsPage.toggle}>
                      {t('colEndsOn')}
                    </TableHead>
                    <TableHead sortKey="isActive" sort={termsPage.sort} onSort={termsPage.toggle}>
                      {t('colStatus')}
                    </TableHead>
                    <TableHead>
                      <span className="sr-only">{t('delete')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terms.isLoading && <TableSkeletonRows columns={5} />}
                  {termRows.map((tm) => (
                    <TableRow key={tm.id} className="hover:bg-muted/40">
                      <TableCell className="font-medium">
                        <TableText value={tm.name} />
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        <TableText value={fmtDate(tm.startsOn)} />
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        <TableText value={fmtDate(tm.endsOn)} />
                      </TableCell>
                      <TableCell>
                        {tm.isActive ? (
                          <Badge variant="success">{t('active')}</Badge>
                        ) : (
                          <TableEmpty />
                        )}
                      </TableCell>
                      <TableCell>
                        <DeleteButton
                          onClick={() => onDelete('term', tm.id, tm.name)}
                          label={t('delete')}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                page={termsPage.page}
                total={termsTotal}
                limit={termsPage.limit}
                onPageChange={termsPage.setPage}
                limitOptions={PAGE_SIZES}
                onLimitChange={termsPage.setLimit}
              />
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {modal === 'subject' && universityId && (
        <CreateSubjectModal universityId={universityId} onClose={() => setModal(null)} />
      )}
      {modal === 'term' && universityId && (
        <CreateTermModal universityId={universityId} onClose={() => setModal(null)} />
      )}
      {modal === 'course' && (
        <CreateCourseModal
          subjects={subjectRows}
          groups={groups.data ?? []}
          terms={termRows}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function DeleteButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" icon onClick={onClick} aria-label={label}>
      <Trash2 className="size-4 text-muted-foreground" aria-hidden />
    </Button>
  )
}
