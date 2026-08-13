'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { BookOpen, CalendarRange, GraduationCap, Plus, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'
import { groupKeys, fetchGroups } from '../../../entities/group'
import {
  courseKeys,
  fetchCourses,
  fetchSubjects,
  fetchTerms,
  deleteCourseRequest,
  deleteSubjectRequest,
  deleteTermRequest,
} from '../../../entities/course'
import { CreateSubjectModal } from './create-subject-modal'
import { CreateTermModal } from './create-term-modal'
import { CreateCourseModal } from './create-course-modal'

type ModalKind = 'subject' | 'term' | 'course' | null

// Управление дисциплинами (декан/админ вуза): назначение курсов группам, справочник, семестры.
export function CourseAdminView() {
  const t = useTranslations('CourseAdmin')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()
  const universityId = useAppSelector((s) => s.auth.universityId)
  const [modal, setModal] = useState<ModalKind>(null)

  const subjects = useQuery({
    queryKey: courseKeys.subjects(),
    queryFn: () => fetchSubjects(),
    retry: false,
  })
  const terms = useQuery({
    queryKey: courseKeys.terms(),
    queryFn: () => fetchTerms(),
    retry: false,
  })
  const courses = useQuery({
    queryKey: courseKeys.list(),
    queryFn: () => fetchCourses(),
    retry: false,
  })
  const groups = useQuery({ queryKey: groupKeys.list(), queryFn: () => fetchGroups() })

  const del = useMutation({
    mutationFn: async (task: { kind: Exclude<ModalKind, null>; id: string }) => {
      if (task.kind === 'subject') return deleteSubjectRequest(task.id)
      if (task.kind === 'term') return deleteTermRequest(task.id)
      return deleteCourseRequest(task.id)
    },
    onSuccess: (_d, task) => {
      const key =
        task.kind === 'subject'
          ? courseKeys.subjects()
          : task.kind === 'term'
            ? courseKeys.terms()
            : courseKeys.list()
      qc.invalidateQueries({ queryKey: key })
      toast.success(t('deleted'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  async function onDelete(kind: Exclude<ModalKind, null>, id: string, name: string) {
    const ok = await confirm({ title: t('confirmDelete'), description: name, destructive: true })
    if (ok) del.mutate({ kind, id })
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Tabs defaultValue="courses">
        <TabsList>
          <TabsTrigger value="courses">{t('tab.courses')}</TabsTrigger>
          <TabsTrigger value="subjects">{t('tab.subjects')}</TabsTrigger>
          <TabsTrigger value="terms">{t('tab.terms')}</TabsTrigger>
        </TabsList>

        {/* Курсы */}
        <TabsContent value="courses">
          <SectionHeader
            label={t('coursesHeader')}
            onAdd={() => setModal('course')}
            addLabel={t('assignCourse')}
          />
          {courses.isLoading ? (
            <ListSkeleton />
          ) : (courses.data ?? []).length === 0 ? (
            <EmptyState
              icon={<BookOpen />}
              title={t('noCourses')}
              description={t('noCoursesHint')}
            />
          ) : (
            <Card>
              <CardContent className="p-2">
                <ul className="divide-y divide-border">
                  {(courses.data ?? []).map((c) => (
                    <li key={c.id} className="flex items-center gap-3 p-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <BookOpen className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{c.subject.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.group.name}
                          {c.term ? ` · ${c.term.name}` : ''}
                          {c.teacher ? ` · ${c.teacher.firstName} ${c.teacher.lastName}` : ''}
                        </p>
                      </div>
                      {c.credits != null && <Badge variant="outline">{c.credits}</Badge>}
                      <DeleteButton
                        onClick={() => onDelete('course', c.id, c.subject.name)}
                        label={t('delete')}
                      />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Справочник дисциплин */}
        <TabsContent value="subjects">
          <SectionHeader
            label={t('subjectsHeader')}
            onAdd={() => setModal('subject')}
            addLabel={t('addSubject')}
          />
          {subjects.isLoading ? (
            <ListSkeleton />
          ) : (subjects.data ?? []).length === 0 ? (
            <EmptyState
              icon={<GraduationCap />}
              title={t('noSubjects')}
              description={t('noSubjectsHint')}
            />
          ) : (
            <Card>
              <CardContent className="p-2">
                <ul className="divide-y divide-border">
                  {(subjects.data ?? []).map((s) => (
                    <li key={s.id} className="flex items-center gap-3 p-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                      {s.code && <Badge variant="secondary">{s.code}</Badge>}
                      <DeleteButton
                        onClick={() => onDelete('subject', s.id, s.name)}
                        label={t('delete')}
                      />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Семестры */}
        <TabsContent value="terms">
          <SectionHeader
            label={t('termsHeader')}
            onAdd={() => setModal('term')}
            addLabel={t('addTerm')}
          />
          {terms.isLoading ? (
            <ListSkeleton />
          ) : (terms.data ?? []).length === 0 ? (
            <EmptyState
              icon={<CalendarRange />}
              title={t('noTerms')}
              description={t('noTermsHint')}
            />
          ) : (
            <Card>
              <CardContent className="p-2">
                <ul className="divide-y divide-border">
                  {(terms.data ?? []).map((tm) => (
                    <li key={tm.id} className="flex items-center gap-3 p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{tm.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {tm.startsOn.slice(0, 10)} — {tm.endsOn.slice(0, 10)}
                        </p>
                      </div>
                      {tm.isActive && <Badge variant="success">{t('active')}</Badge>}
                      <DeleteButton
                        onClick={() => onDelete('term', tm.id, tm.name)}
                        label={t('delete')}
                      />
                    </li>
                  ))}
                </ul>
              </CardContent>
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
          subjects={subjects.data ?? []}
          groups={groups.data ?? []}
          terms={terms.data ?? []}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function SectionHeader({
  label,
  onAdd,
  addLabel,
}: {
  label: string
  onAdd: () => void
  addLabel: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-heading text-sm font-semibold text-muted-foreground">{label}</h2>
      <Button size="sm" onClick={onAdd} className="gap-1.5">
        <Plus className="size-4" aria-hidden />
        {addLabel}
      </Button>
    </div>
  )
}

function DeleteButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label}>
      <Trash2 className="size-4 text-muted-foreground" aria-hidden />
    </Button>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-14 w-full rounded-xl" />
      <Skeleton className="h-14 w-full rounded-xl" />
    </div>
  )
}
