'use client'

import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { EyeOff } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import {
  CreateApplicationSchema,
  type CareerApplicationStatus,
  type CreateApplicationInput,
} from '@studenthub/shared-schemas'
import { fetchVacancy, vacancyKeys, type Vacancy } from '../../../entities/vacancy'
import { useKatoNames } from '../../../entities/kato'
import { companyPath } from '../../../entities/company'
import {
  applicationKeys,
  applyToVacancy,
  fetchMyApplications,
} from '../../../entities/career-application'
import {
  careerProfileKeys,
  fetchMyCareerProfile,
  type CareerProfile,
} from '../../../entities/career-profile'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  FieldError,
  Label,
  Modal,
  Skeleton,
  Textarea,
} from '../../../shared/ui'
import { toApiError, useApplicationStatusLabels } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'
import { salaryText } from '../lib/salary-text'

// Откликаться могут только студенты: сотрудники вуза смотрят витрину, чтобы понимать, что
// уже одобрено, — отклик от их имени сервер всё равно не примет.
const APPLICANT_ROLES: readonly Role[] = [Role.STUDENT, Role.STAROSTA]

interface VacancyDetailModalProps {
  /** Строка витрины: окно открывается сразу с ней, а свежая карточка догружается. */
  vacancy: Vacancy
  /** Вуз витрины — только у платформенных ролей, у остальных он в токене. */
  universityId: string | null
  onClose: () => void
}

/**
 * Карточка вакансии с откликом.
 *
 * Отклик — сопроводительное письмо и одна кнопка: длинная форма отсекала бы тех, кто
 * откликнулся бы «просто попробовать». Карьерный профиль компания видит, только если он
 * открыт работодателям или студент открыл его ей галочкой (21.D1) — об этом форма
 * предупреждает до отклика.
 */
export function VacancyDetailModal({
  vacancy: preview,
  universityId,
  onClose,
}: VacancyDetailModalProps) {
  const t = useTranslations('Vacancies')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const role = useAppSelector((s) => s.auth.role)
  const canApply = role !== null && APPLICANT_ROLES.includes(role)

  // Свежая карточка: витрина могла устареть, а заодно сервер считает просмотр.
  const detail = useQuery({
    queryKey: vacancyKeys.byId(preview.id),
    queryFn: () => fetchVacancy(preview.id, universityId),
    placeholderData: preview,
  })
  const vacancy = detail.data ?? preview
  // Город вакансии — код КАТО: показываем название на языке интерфейса.
  const { nameOf: cityName } = useKatoNames([vacancy.city])

  // Уже откликался? Повторный отклик сервер отклонит, поэтому вместо формы показываем статус.
  const mineParams = { vacancyId: preview.id, limit: 1 }
  const mine = useQuery({
    queryKey: applicationKeys.mine(mineParams),
    queryFn: () => fetchMyApplications(mineParams),
    enabled: canApply,
  })
  const existing = mine.data?.items[0]

  // Видимость карьерного профиля — чтобы до отклика сказать, увидит ли компания профиль
  // (21.D1). Тот же ключ, что у экрана профиля: переключение там сразу видно здесь.
  const profile = useQuery({
    queryKey: careerProfileKeys.mine(),
    queryFn: fetchMyCareerProfile,
    enabled: canApply,
  })

  const form = useForm<CreateApplicationInput>({
    resolver: zodResolver(CreateApplicationSchema),
    defaultValues: { vacancyId: preview.id, shareProfile: false },
  })
  const shareProfile = form.watch('shareProfile') ?? false

  const apply = useMutation({
    mutationFn: applyToVacancy,
    onSuccess: async (_data, values) => {
      toast.success(t('applied'))
      await qc.invalidateQueries({ queryKey: applicationKeys.all })
      // Открытие профиля компании видно в списке «кому открыт» на экране профиля.
      if (values.shareProfile) await qc.invalidateQueries({ queryKey: careerProfileKeys.all })
    },
    onError: (error) => toast.error(tErr(toApiError(error).code)),
  })

  const salary = salaryText(vacancy, { from: t('salaryFrom'), to: t('salaryTo') }, locale)
  const deadline = vacancy.deadline
    ? new Date(vacancy.deadline).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
    : null

  return (
    <Modal onClose={onClose} title={vacancy.title} size="xl">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          {/* Витрина вакансии видна только вузу с допуском компании — значит, видна и её
              страница: название ведёт туда. */}
          <Link
            href={companyPath(vacancy.company.id)}
            className="self-start font-medium text-primary hover:underline"
          >
            {vacancy.company.name}
          </Link>
          <p className="text-sm text-muted-foreground">
            {[cityName(vacancy.city), salary, deadline ? t('deadline', { date: deadline }) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        {vacancy.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {vacancy.skills.map((skill) => (
              <Badge key={skill} variant="outline">
                {skill}
              </Badge>
            ))}
          </div>
        )}

        {/* Описание — простой текст из формы компании: переносы строк сохраняем, разметку нет. */}
        <p className="text-sm whitespace-pre-line">{vacancy.description}</p>

        {canApply && (
          <div className="border-t border-border pt-4">
            {mine.isLoading ? (
              <Skeleton className="h-10 w-full rounded-lg" />
            ) : existing ? (
              <ExistingApplication status={existing.status} />
            ) : (
              <form
                onSubmit={form.handleSubmit((values) => apply.mutate(values))}
                className="flex flex-col gap-3"
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="coverLetter">{t('coverLetter')}</Label>
                  <Textarea
                    id="coverLetter"
                    rows={4}
                    placeholder={t('coverLetterPlaceholder')}
                    aria-invalid={!!form.formState.errors.coverLetter}
                    {...form.register('coverLetter')}
                  />
                  <FieldError>
                    {form.formState.errors.coverLetter ? t('coverLetterTooLong') : null}
                  </FieldError>
                </div>
                {profile.data && (
                  <ProfileVisibilityNotice
                    profile={profile.data}
                    companyId={vacancy.company.id}
                    shareProfile={shareProfile}
                    onShareProfileChange={(value) => form.setValue('shareProfile', value)}
                  />
                )}
                <div className="flex justify-end">
                  <Button type="submit" loading={apply.isPending}>
                    {t('apply')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * Что компания увидит из профиля (21.D1). Скрытый профиль отклик не раскрывает: компания
 * получает строку кандидата, но не карьерный профиль. Галочка открывает его только этой
 * компании — закрыть можно в «Моих откликах» и на экране профиля.
 */
function ProfileVisibilityNotice({
  profile,
  companyId,
  shareProfile,
  onShareProfileChange,
}: {
  profile: CareerProfile
  companyId: string
  shareProfile: boolean
  onShareProfileChange: (value: boolean) => void
}) {
  const t = useTranslations('Vacancies')

  if (profile.visibility === 'EMPLOYERS') {
    return <p className="text-sm text-muted-foreground">{t('profileVisibleNote')}</p>
  }
  if (profile.profileGrants.some((grant) => grant.companyId === companyId)) {
    return <p className="text-sm text-muted-foreground">{t('profileSharedNote')}</p>
  }
  return (
    <Alert variant="warning">
      <EyeOff aria-hidden />
      <AlertTitle>{t('profileHiddenTitle')}</AlertTitle>
      <AlertDescription className="gap-3">
        <p>{t('profileHiddenText')}</p>
        <div className="flex items-start gap-3 text-foreground">
          <Checkbox
            id="shareProfile"
            checked={shareProfile}
            onCheckedChange={(checked) => onShareProfileChange(checked === true)}
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="shareProfile" className="cursor-pointer">
              {t('shareProfile')}
            </Label>
            <span className="text-xs text-muted-foreground">{t('shareProfileHint')}</span>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  )
}

function ExistingApplication({ status }: { status: CareerApplicationStatus }) {
  const t = useTranslations('Vacancies')
  const { label, tone } = useApplicationStatusLabels()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t('alreadyApplied')}</span>
        <Badge variant={tone[status]}>{label[status]}</Badge>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/career/applications">{t('goToApplications')}</Link>
      </Button>
    </div>
  )
}
