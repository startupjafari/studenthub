'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Check, CircleAlert, Rocket } from 'lucide-react'
import type { OnboardingStep } from '@studenthub/shared-schemas'
import { createFacultyRequest, facultyKeys, fetchFaculties } from '../../../entities/faculty'
import { createSpecialtyRequest, specialtyKeys } from '../../../entities/specialty'
import { createGroupRequest, groupKeys } from '../../../entities/group'
import { createRoomRequest, roomKeys } from '../../../entities/room'
import { courseKeys, createSubjectRequest } from '../../../entities/course'
import { onboardingKeys, type OnboardingState, type OnboardingStepState } from '../../../entities/onboarding' // prettier-ignore
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { QuickAdd } from './quick-add'

interface Props {
  step: OnboardingStepState
  state: OnboardingState
  onConfirmProfile: () => void
  confirming: boolean
  onLaunch: () => void
  launching: boolean
}

/** Содержимое раскрытого шага: у каждого своё, общего здесь только оболочка. */
export function StepBody(props: Props) {
  switch (props.step.step) {
    case 'profile':
      return <ProfileStep {...props} />
    case 'faculties':
      return <FacultiesStep {...props} />
    case 'specialties':
      return <SimpleListStep {...props} kind="specialties" />
    case 'groups':
      return <GroupsStep />
    case 'rooms':
      return <SimpleListStep {...props} kind="rooms" />
    case 'subjects':
      return <SimpleListStep {...props} kind="subjects" />
    case 'launch':
      return <LaunchStep {...props} />
    // У семестра три обязательных поля, из них два — даты. Строка ввода здесь ничего
    // не ускоряет, поэтому шаг честно отправляет в полный раздел.
    case 'terms':
    case 'deans':
    default:
      return null
  }
}

// ── Шаг «О вузе» ─────────────────────────────────────────────────────────────

/**
 * Реквизиты показаны, но не редактируются: их правит платформа (`PATCH /universities/:id`
 * доступен только PLATFORM_ADMIN). Кнопка здесь означает «я проверил, всё верно», и это
 * единственный шаг, пройденность которого приходится хранить: по данным его не отличить —
 * название и город заполнены с момента создания вуза.
 */
function ProfileStep({ step, state, onConfirmProfile, confirming }: Props) {
  const t = useTranslations('Setup')

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Fact label={t('profileName')} value={state.university.name} />
        <Fact label={t('profileShortName')} value={state.university.shortName} />
        <Fact label={t('profileCity')} value={state.university.city} />
        <Fact label={t('profileTimezone')} value={state.university.timezone} />
      </dl>
      <p className="text-xs text-muted-foreground">{t('profileFix')}</p>
      {!step.done && (
        <div>
          <Button size="sm" loading={confirming} onClick={onConfirmProfile}>
            <Check className="size-4" aria-hidden />
            {t('profileConfirm')}
          </Button>
        </div>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{value || '—'}</dd>
    </div>
  )
}

// ── Списки, которые заводятся одним названием ────────────────────────────────

type SimpleKind = 'specialties' | 'rooms' | 'subjects'

/**
 * Специальности, аудитории и предметы: у всех трёх обязательное поле ровно одно —
 * название. Форма у них поэтому общая, а различаются только запрос и ключ кэша.
 */
function SimpleListStep({ state, kind }: Props & { kind: SimpleKind }) {
  const t = useTranslations('Setup')
  const qc = useQueryClient()
  const universityId = state.university.id

  const mut = useMutation({
    mutationFn: (name: string) => {
      if (kind === 'specialties') return createSpecialtyRequest({ name })
      if (kind === 'rooms') return createRoomRequest({ name })
      return createSubjectRequest({ universityId, name })
    },
    onSuccess: () => refresh(qc, kind),
    onError: (e: unknown) => toast.error(String((e as { message?: string }).message ?? '')),
  })

  return (
    <QuickAdd
      placeholder={t(`step.${kind}.placeholder`)}
      pending={mut.isPending}
      onAdd={(name) => mut.mutateAsync(name)}
    />
  )
}

// ── Факультеты ───────────────────────────────────────────────────────────────

function FacultiesStep({ state }: Props) {
  const t = useTranslations('Setup')
  const qc = useQueryClient()

  const mut = useMutation({
    mutationFn: (name: string) => createFacultyRequest({ name, universityId: state.university.id }),
    onSuccess: () => refresh(qc, 'faculties'),
    onError: (e: unknown) => toast.error(String((e as { message?: string }).message ?? '')),
  })

  return (
    <QuickAdd
      placeholder={t('step.faculties.placeholder')}
      pending={mut.isPending}
      onAdd={(name) => mut.mutateAsync(name)}
    />
  )
}

// ── Группы ───────────────────────────────────────────────────────────────────

/**
 * Группу нельзя завести в воздухе — только на факультете, поэтому рядом со строкой
 * стоит выбор факультета. Пока факультетов нет, шаг честно говорит об этом вместо того,
 * чтобы показывать форму, отправка которой заведомо не пройдёт.
 */
function GroupsStep() {
  const t = useTranslations('Setup')
  const qc = useQueryClient()

  const faculties = useQuery({ queryKey: facultyKeys.list(), queryFn: () => fetchFaculties() })
  const list = faculties.data ?? []
  const [facultyId, setFacultyId] = useState<string>('')
  const selected = facultyId || list[0]?.id || ''

  const mut = useMutation({
    mutationFn: (name: string) => createGroupRequest({ name, facultyId: selected }),
    onSuccess: () => refresh(qc, 'groups'),
    onError: (e: unknown) => toast.error(String((e as { message?: string }).message ?? '')),
  })

  if (!faculties.isLoading && list.length === 0) {
    return <p className="text-sm text-warning">{t('needFaculties')}</p>
  }

  return (
    <QuickAdd
      placeholder={t('step.groups.placeholder')}
      disabled={!selected}
      pending={mut.isPending}
      onAdd={(name) => mut.mutateAsync(name)}
    >
      <Select value={selected} onValueChange={setFacultyId}>
        <SelectTrigger className="sm:w-56" aria-label={t('faculty')}>
          <SelectValue placeholder={t('faculty')} />
        </SelectTrigger>
        <SelectContent>
          {list.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </QuickAdd>
  )
}

// ── Запуск ───────────────────────────────────────────────────────────────────

/**
 * Чек-лист вместо одной кнопки.
 *
 * Отключённая кнопка без объяснения — худший вид отказа: человек видит, что нельзя, и
 * не видит почему. Здесь перечислено ровно то, чего не хватает, и каждая строка ведёт
 * в свой шаг. Список приходит с сервера (`blocking`), а не считается здесь: решение о
 * запуске принимает сервер, и фронт не должен иметь на этот счёт своего мнения.
 */
function LaunchStep({ state, onLaunch, launching }: Props) {
  const t = useTranslations('Setup')

  if (state.university.status === 'ACTIVE') {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm text-success">
          <Check className="size-4" aria-hidden />
          {t('launchedAlready')}
        </p>
        <div>
          <Button asChild size="sm" variant="outline">
            <Link href="/university-admin">{t('toDashboard')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {state.blocking.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {state.blocking.map((step: OnboardingStep) => (
            <li key={step} className="flex items-center gap-2 text-sm">
              <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
              {t(`step.${step}.title`)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('launchReady')}</p>
      )}

      <div>
        <Button size="lg" disabled={!state.canLaunch} loading={launching} onClick={onLaunch}>
          <Rocket className="size-4" aria-hidden />
          {t('launch')}
        </Button>
      </div>
    </div>
  )
}

// ── Общее ────────────────────────────────────────────────────────────────────

/**
 * После добавления обновляем и сам список, и состояние мастера: счётчик шага живёт на
 * сервере и пересчитывается по данным, поэтому без второго запроса шаг остался бы
 * «не пройден» при уже заведённом факультете. Перерисовку делает `useQuery` в самом
 * мастере — подставлять ответ руками не нужно.
 */
function refresh(
  qc: ReturnType<typeof useQueryClient>,
  kind: 'faculties' | 'specialties' | 'groups' | 'rooms' | 'subjects',
): void {
  const keys = {
    faculties: facultyKeys.all,
    specialties: specialtyKeys.all,
    groups: groupKeys.all,
    rooms: roomKeys.all,
    subjects: courseKeys.all,
  }[kind]
  void qc.invalidateQueries({ queryKey: keys })
  void qc.invalidateQueries({ queryKey: onboardingKeys.state() })
}
