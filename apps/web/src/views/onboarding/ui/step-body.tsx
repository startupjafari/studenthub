'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Check, CircleAlert, Copy, Link2, Minus, Plus, Rocket, UserPlus } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { CreateTermSchema, type OnboardingStep } from '@studenthub/shared-schemas'
import { createFacultyRequest, facultyKeys, fetchFaculties } from '../../../entities/faculty'
import { createSpecialtyRequest, specialtyKeys } from '../../../entities/specialty'
import { createGroupRequest, groupKeys } from '../../../entities/group'
import { createRoomRequest, roomKeys } from '../../../entities/room'
import { courseKeys, createSubjectRequest, createTermRequest } from '../../../entities/course'
import { createInviteRequest, inviteKeys, type CreatedInvite } from '../../../entities/invite'
import { onboardingKeys, type OnboardingState, type OnboardingStepState } from '../../../entities/onboarding' // prettier-ignore
import {
  Button,
  DatePicker,
  FieldError,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { QuickAdd } from './quick-add'

interface Props {
  step: OnboardingStepState
  state: OnboardingState
  onOpenStep: (step: OnboardingStep) => void
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
    case 'terms':
      return <TermsStep {...props} />
    case 'deans':
      return <DeansStep />
    case 'launch':
      return <LaunchStep {...props} />
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
          <Button loading={confirming} onClick={onConfirmProfile}>
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
        <SelectTrigger className="sm:w-56 sm:shrink-0" aria-label={t('faculty')}>
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

// ── Учебный год ─────────────────────────────────────────────────────────────

/**
 * Семестр заводится одной строкой: название и две даты. Номер и активность — детали,
 * без которых шаг засчитывается; их правят в разделе курсов, когда дойдут до расписания.
 *
 * Проверяем той же схемой, что и сервер: иначе «конец раньше начала» доходил бы до API
 * и возвращался безликим 422 вместо подсказки у поля.
 */
function TermsStep({ state }: Props) {
  const t = useTranslations('Setup')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')

  const input = { universityId: state.university.id, name: name.trim(), startsOn, endsOn }
  const valid = CreateTermSchema.safeParse(input).success
  const reversed = startsOn !== '' && endsOn !== '' && endsOn < startsOn

  const mut = useMutation({
    mutationFn: () => createTermRequest(input),
    onSuccess: () => {
      setName('')
      setStartsOn('')
      setEndsOn('')
      refresh(qc, 'terms')
    },
    onError: (e: unknown) => toast.error(tErr(toApiError(e).code)),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) mut.mutate()
      }}
      className="flex flex-col gap-1.5"
    >
      {/* Даты стоят парой и на телефоне: «с» и «по» читаются как одно поле. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_11rem_auto]">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('step.terms.placeholder')}
          aria-label={t('step.terms.placeholder')}
          className="col-span-2 sm:col-span-1"
        />
        <DatePicker
          value={startsOn}
          onChange={setStartsOn}
          placeholder={t('termStarts')}
          aria-label={t('termStarts')}
        />
        <DatePicker
          value={endsOn}
          onChange={setEndsOn}
          min={startsOn || undefined}
          placeholder={t('termEnds')}
          aria-label={t('termEnds')}
          aria-invalid={reversed}
        />
        <Button
          type="submit"
          disabled={!valid}
          loading={mut.isPending}
          className="col-span-2 sm:col-span-1"
        >
          <Plus className="size-4" aria-hidden />
          {t('add')}
        </Button>
      </div>
      <FieldError>{reversed ? t('termEndsBeforeStart') : null}</FieldError>
    </form>
  )
}

// ── Деканы ───────────────────────────────────────────────────────────────────

/**
 * Приглашение декана: факультет и, по желанию, почта. Строка устроена так же, как у
 * групп — выбор факультета слева, — чтобы шаги читались одинаково.
 *
 * Ссылка после создания остаётся на экране: токен сервер отдаёт один раз, и если его не
 * показать, приглашение выдано впустую. Шаг засчитывается уже по выданному приглашению.
 */
function DeansStep() {
  const t = useTranslations('Setup')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const faculties = useQuery({ queryKey: facultyKeys.list(), queryFn: () => fetchFaculties() })
  const list = faculties.data ?? []
  const [facultyId, setFacultyId] = useState<string>('')
  const selected = facultyId || list[0]?.id || ''
  const [email, setEmail] = useState('')
  const [created, setCreated] = useState<CreatedInvite | null>(null)

  const mut = useMutation({
    mutationFn: () =>
      createInviteRequest({
        role: Role.DEAN,
        facultyId: selected,
        email: email.trim() || undefined,
      }),
    onSuccess: (invite) => {
      setCreated(invite)
      setEmail('')
      void qc.invalidateQueries({ queryKey: inviteKeys.all })
      void qc.invalidateQueries({ queryKey: onboardingKeys.state() })
    },
    onError: (e: unknown) => toast.error(tErr(toApiError(e).code)),
  })

  if (!faculties.isLoading && list.length === 0) {
    return <p className="text-sm text-warning">{t('needFaculties')}</p>
  }

  const link = created ? `/register?token=${created.token}` : ''
  const copy = () => {
    void navigator.clipboard.writeText(`${window.location.origin}${link}`)
    toast.success(t('linkCopied'))
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (selected) mut.mutate()
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <Select value={selected} onValueChange={setFacultyId}>
          <SelectTrigger className="sm:w-56 sm:shrink-0" aria-label={t('faculty')}>
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
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('step.deans.placeholder')}
          aria-label={t('step.deans.placeholder')}
          className="sm:flex-1"
        />
        <Button type="submit" disabled={!selected} loading={mut.isPending}>
          <UserPlus className="size-4" aria-hidden />
          {t('invite')}
        </Button>
      </form>

      {created && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Link2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            {t('inviteCreated')}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="flex h-10 min-w-0 flex-1 items-center truncate rounded-xl border border-border bg-background px-3.5 text-sm">
              {link}
            </code>
            <Button type="button" variant="outline" onClick={copy}>
              <Copy className="size-4" aria-hidden />
              {t('copyLink')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Запуск ───────────────────────────────────────────────────────────────────

/**
 * Чек-лист вместо одной кнопки.
 *
 * Отключённая кнопка без объяснения — худший вид отказа: человек видит, что нельзя, и
 * не видит почему. Здесь перечислены все шаги с их состоянием, и каждая строка открывает
 * свой шаг. Что блокирует запуск, решает сервер (`blocking`), а не этот экран: решение о
 * запуске принимает он, и у фронта не должно быть на этот счёт своего мнения.
 */
function LaunchStep({ state, onOpenStep, onLaunch, launching }: Props) {
  const t = useTranslations('Setup')

  if (state.university.status === 'ACTIVE') {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm text-success">
          <Check className="size-4" aria-hidden />
          {t('launchedAlready')}
        </p>
        <div>
          <Button asChild variant="outline">
            <Link href="/university-admin">{t('toDashboard')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  const blocking = new Set(state.blocking)
  const checklist = state.steps.filter((s) => s.step !== 'launch')

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-2 sm:grid-cols-2">
        {checklist.map((s) => {
          const missing = blocking.has(s.step)
          return (
            <li key={s.step}>
              <button
                type="button"
                onClick={() => onOpenStep(s.step)}
                className={cn(
                  'flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 text-left text-sm transition-colors hover:bg-muted/40',
                  missing ? 'border-warning/30' : 'border-border',
                )}
              >
                {s.done ? (
                  <Check className="size-4 shrink-0 text-success" aria-hidden />
                ) : missing ? (
                  <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                ) : (
                  <Minus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{t(`step.${s.step}.title`)}</span>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    s.done ? 'text-success' : missing ? 'text-warning' : 'text-muted-foreground',
                  )}
                >
                  {s.done ? t('checkDone') : missing ? t('checkMissing') : t('skipped')}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {state.canLaunch ? t('launchReady') : t('launchBlocked', { n: state.blocking.length })}
        </p>
        <Button
          disabled={!state.canLaunch}
          loading={launching}
          onClick={onLaunch}
          className="shrink-0"
        >
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
  kind: 'faculties' | 'specialties' | 'groups' | 'rooms' | 'terms' | 'subjects',
): void {
  const keys = {
    faculties: facultyKeys.all,
    terms: courseKeys.all,
    specialties: specialtyKeys.all,
    groups: groupKeys.all,
    rooms: roomKeys.all,
    subjects: courseKeys.all,
  }[kind]
  void qc.invalidateQueries({ queryKey: keys })
  void qc.invalidateQueries({ queryKey: onboardingKeys.state() })
}
