'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type {
  StaffManagedStudentField,
  UpdateAcademicRecordInput,
} from '@studenthub/shared-schemas'
import {
  adminUserKeys,
  fetchUserById,
  updateAcademicRecordRequest,
  userKeys,
  type PublicUser,
} from '../../../entities/user'
import { fetchSpecialties, specialtyKeys } from '../../../entities/specialty'
import { LibraryDebtsNotice } from '../../../entities/library'
import {
  ACADEMIC_STATUS_DICT,
  DORMITORY_DICT,
  EDUCATION_LEVEL_DICT,
  FUNDING_TYPE_DICT,
  STUDY_FORM_DICT,
  yearOptions,
} from '../../../shared/config'
import {
  Button,
  DictSingleSelect,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import { useErrorToast } from '../../../shared/lib'

// dict — справочник со своим вводом; enum — закрытый список без своего ввода.
type Kind = 'number' | 'year' | 'text' | 'dict' | 'enum'

// Поля в порядке формы. Справочники — те же, что в профиле студента.
const FIELDS: { key: StaffManagedStudentField; kind: Kind; options?: string[] }[] = [
  { key: 'course', kind: 'number' },
  { key: 'specialty', kind: 'dict' },
  { key: 'educationLevel', kind: 'dict', options: EDUCATION_LEVEL_DICT },
  { key: 'studyForm', kind: 'dict', options: STUDY_FORM_DICT },
  { key: 'fundingType', kind: 'dict', options: FUNDING_TYPE_DICT },
  // Статус — закрытый список: от него зависят дата ухода из вуза, проход по студенческому
  // и выдача книг, а «Отчислена» своим вводом не закрывала ни одно из них.
  { key: 'academicStatus', kind: 'enum', options: ACADEMIC_STATUS_DICT },
  { key: 'enrollmentYear', kind: 'year' },
  { key: 'graduationYear', kind: 'year' },
  { key: 'gpa', kind: 'number' },
  { key: 'studentCardNumber', kind: 'text' },
  // Общежитие тоже ведёт вуз: оно печатается в студенческом, который проверяют на вахте.
  { key: 'dormitory', kind: 'dict', options: DORMITORY_DICT },
]

// Статусы, с которыми студент выходит из вуза: при переводе в них показываем книги, которые
// за ним числятся в библиотеке (Фаза 20.11). Значения — из ACADEMIC_STATUS_DICT.
const LEAVING_STATUSES = new Set(['Выпускник', 'Отчислен', 'Переведён'])

const NUMERIC = new Set<StaffManagedStudentField>([
  'course',
  'enrollmentYear',
  'graduationYear',
  'gpa',
])

function initialOf(user: PublicUser): Record<string, string> {
  const o: Record<string, string> = {}
  for (const f of FIELDS) {
    const raw = (user as unknown as Record<string, unknown>)[f.key]
    o[f.key] = raw == null ? '' : String(raw)
  }
  return o
}

/**
 * Учебные данные студента — правит декан факультета или админ вуза.
 *
 * Уходят только изменённые поля: номер студенческого в профиль чужому человеку не
 * приходит, и пустое поле здесь значит «не знаю», а не «стереть». Отправка всех полей
 * разом затёрла бы номер у каждого, кому правили, скажем, курс.
 */
export function AcademicRecordModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const t = useTranslations('Users')
  const user = useQuery({ queryKey: userKeys.detail(userId), queryFn: () => fetchUserById(userId) })

  return (
    <Modal onClose={onClose} title={t('academicTitle')} size="lg">
      {user.data ? (
        // Форма монтируется с уже пришедшими данными — начальное состояние без эффектов.
        <AcademicRecordForm user={user.data} onClose={onClose} />
      ) : user.isError ? (
        <p className="text-sm text-muted-foreground">{t('academicLoadError')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {FIELDS.slice(0, 5).map((f) => (
            <Skeleton key={f.key} className="h-10 w-full" />
          ))}
        </div>
      )}
    </Modal>
  )
}

function AcademicRecordForm({ user, onClose }: { user: PublicUser; onClose: () => void }) {
  const t = useTranslations('Users')
  const tProfile = useTranslations('Profile')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const { show } = useErrorToast('academic-record')
  const specialties = useQuery({ queryKey: specialtyKeys.list(), queryFn: fetchSpecialties })
  const specialtyOptions = (specialties.data ?? []).map((s) => s.name)

  const [initial] = useState(() => initialOf(user))
  const [form, setForm] = useState(initial)
  const set = (k: string, v: string): void => setForm((p) => ({ ...p, [k]: v }))

  const changed = FIELDS.filter((f) => (form[f.key] ?? '') !== (initial[f.key] ?? ''))
  const leaving =
    form.academicStatus !== initial.academicStatus &&
    LEAVING_STATUSES.has(form.academicStatus ?? '')

  const save = useMutation({
    mutationFn: () => {
      const input: Record<string, unknown> = {}
      for (const f of changed) {
        const v = (form[f.key] ?? '').trim()
        input[f.key] = NUMERIC.has(f.key) ? (v === '' ? null : Number(v)) : v
      }
      return updateAcademicRecordRequest(user.id, input as UpdateAcademicRecordInput)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: userKeys.detail(user.id) })
      void qc.invalidateQueries({ queryKey: adminUserKeys.all })
      toast.success(t('academicSaved'))
      onClose()
    },
    onError: show,
  })

  const control = (f: (typeof FIELDS)[number]): React.ReactNode => {
    const val = form[f.key] ?? ''
    if (f.kind === 'year')
      return (
        <DictSingleSelect value={val} onChange={(v) => set(f.key, v)} options={yearOptions()} />
      )
    if (f.kind === 'enum')
      return (
        // Запись до справочника («Отчислена») видна подписью, пока не выбрали значение из списка.
        <Select
          value={(f.options ?? []).includes(val) ? val : ''}
          onValueChange={(v) => set(f.key, v)}
        >
          <SelectTrigger id={`academic-${f.key}`} className="w-full">
            <SelectValue placeholder={val} />
          </SelectTrigger>
          <SelectContent>
            {(f.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    if (f.kind === 'dict')
      return (
        <DictSingleSelect
          value={val}
          onChange={(v) => set(f.key, v)}
          options={f.key === 'specialty' ? specialtyOptions : (f.options ?? [])}
        />
      )
    return (
      <Input
        id={`academic-${f.key}`}
        type={f.kind === 'number' ? 'number' : 'text'}
        step={f.key === 'gpa' ? '0.01' : undefined}
        value={val}
        onChange={(e) => set(f.key, e.target.value)}
      />
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (changed.length > 0) save.mutate()
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-2">
            <Label htmlFor={`academic-${f.key}`}>{tProfile(f.key)}</Label>
            {control(f)}
            {f.key === 'studentCardNumber' && (
              <p className="text-xs text-muted-foreground">{t('academicCardHint')}</p>
            )}
          </div>
        ))}
      </div>
      {leaving && <LibraryDebtsNotice userId={user.id} />}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" onClick={onClose}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" loading={save.isPending} disabled={changed.length === 0}>
          {t('academicSave')}
        </Button>
      </div>
    </form>
  )
}
