'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarPlus, Check, Layers, MousePointerClick, Plus } from 'lucide-react'
import type { UpdatePairInput } from '@studenthub/shared-schemas'
import type { ApiErrorBody } from '@studenthub/shared-types'
import {
  Button,
  Card,
  EmptyState,
  FormAlert,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  PageHeader,
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { GroupSelect } from '../../../entities/group'
import { fetchMe, userKeys } from '../../../entities/user'
import {
  fetchScheduleContainer,
  fetchScheduleContainers,
  scheduleKeys,
  updatePairRequest,
  updateScheduleRequest,
  type Pair,
} from '../../../entities/schedule'
import { ScheduleEditor } from './schedule-editor'
import { AddPairModal } from './add-pair-modal'
import { CreateVersionModal } from './create-version-modal'
import { ScheduleDayList } from './schedule-day-list'
import { PairDetailsModal } from './pair-details-modal'
import { conflictDescription } from '../lib/conflict-description'

function apiErr(e: unknown): ApiErrorBody {
  return e as ApiErrorBody
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function addMinutes(hhmm: string, delta: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  let tot = (h ?? 0) * 60 + (m ?? 0) + delta
  tot = Math.max(0, Math.min(tot, 23 * 60 + 59))
  return `${pad(Math.floor(tot / 60))}:${pad(tot % 60)}`
}

export function ManageSchedule({ mode = 'admin' }: { mode?: 'admin' | 'teacher' }) {
  const isTeacher = mode === 'teacher'
  const t = useTranslations('Schedule')
  const locale = useLocale()
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  // Вуз для выбора аудитории: платформенной роли его надо указать, вуз-ролям сервер
  // подставит свой из JWT.
  const universityId = me.data?.universityId ?? undefined

  const [groupId, setGroupId] = useState<string>('')
  const [containerId, setContainerId] = useState<string>('')
  const [versionOpen, setVersionOpen] = useState(false)
  const [selectedPair, setSelectedPair] = useState<Pair | null>(null)
  // Заготовка новой пары: null — модалка закрыта.
  const [addDraft, setAddDraft] = useState<{
    dayOfWeek: number
    startTime: string
    endTime: string
  } | null>(null)
  const [showWeekend, setShowWeekend] = useState(false)
  // День, открытый в мобильном списке. По умолчанию — сегодняшний.
  const [mobileDay, setMobileDay] = useState(() => ((new Date().getDay() + 6) % 7) + 1)

  const containers = useQuery({
    queryKey: scheduleKeys.containers(groupId),
    queryFn: () => fetchScheduleContainers(groupId),
    enabled: !!groupId,
  })

  // Выбранную версию не сбрасываем на активную при обновлении списка: только что созданный
  // черновик (C-F13) остаётся открытым. На активную переключаемся, когда выбранной в списке
  // нет — другая группа или версию удалили.
  useEffect(() => {
    const list = containers.data
    if (!list) return
    setContainerId((current) => {
      if (list.some((c) => c.id === current)) return current
      return (list.find((c) => c.isActive) ?? list[0])?.id ?? ''
    })
  }, [containers.data])

  const container = useQuery({
    queryKey: scheduleKeys.container(containerId),
    queryFn: () => fetchScheduleContainer(containerId),
    enabled: !!containerId,
  })

  const invalidateContainer = (): void => {
    void qc.invalidateQueries({ queryKey: scheduleKeys.container(containerId) })
    void qc.invalidateQueries({ queryKey: scheduleKeys.all })
  }

  const activateContainer = useMutation({
    mutationFn: (id: string) => updateScheduleRequest(id, { isActive: true }),
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.containers(groupId) })
      toast.success(t('containerActivated'))
    },
    // Пары версии сверяются с активными сетками других групп (C-F13): конфликт — с перечнем.
    onError: (e) => {
      const err = apiErr(e)
      if (err.code === 'CONFLICT') {
        toast.error(t('conflictTitle'), {
          description: conflictDescription(err.details, locale, (k) => t(k)),
        })
      } else showApiError(e)
    },
  })

  const movePair = useMutation({
    mutationFn: (v: { id: string; input: UpdatePairInput }) => updatePairRequest(v.id, v.input),
    onMutate: () => resetApiError(),
    onSuccess: () => {
      invalidateContainer()
      toast.success(t('pairMoved'))
    },
    onError: (e) => {
      const err = apiErr(e)
      if (err.code === 'CONFLICT') {
        toast.error(t('conflictTitle'), {
          description: conflictDescription(err.details, locale, (k) => t(k)),
        })
      } else showApiError(e)
    },
  })

  const pairs = container.data?.pairs ?? []
  // Преподаватель правит только свои пары (бэк это enforce'ит; здесь — прячем действия
  // и запрещаем перетаскивание, чтобы не предлагать заведомо отказной запрос).
  const canEditPair = (p: Pair): boolean => !isTeacher || p.teacher?.id === me.data?.id

  // Клик по пустому месту календаря — заготовка для модалки: день и время уже выбраны,
  // остаётся ввести предмет.
  function openAddPair(dayOfWeek: number, startTime: string): void {
    resetApiError()
    setSelectedPair(null)
    setAddDraft({ dayOfWeek, startTime, endTime: addMinutes(startTime, 90) })
  }

  // Клик по пустому слоту календаря → модалка добавления (время выбрано на календаре).
  function onSlotClick(dayOfWeek: number, startTime: string): void {
    openAddPair(dayOfWeek, startTime)
  }

  // Клик по паре → карточка пары в модалке.
  function onPairClick(p: Pair): void {
    setSelectedPair(p)
  }

  // Перетаскивание пары по сетке — та же правка, что и форма в карточке.
  // Оптимистично не обновляем: сервер может отклонить перенос по конфликту, и откат
  // выглядел бы как «пара сама прыгнула назад» без объяснения.
  function onPairMove(
    pair: Pair,
    next: { dayOfWeek: number; startTime: string; endTime: string },
  ): void {
    movePair.mutate({ id: pair.id, input: next })
  }

  const weekendPairs = pairs.some((p) => p.dayOfWeek > 5)
  // Выходные показываем, только если в них что-то есть или их включили руками: пустые
  // Сб и Вс забирали четверть ширины сетки у рабочих дней.
  const days = showWeekend || weekendPairs ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5]
  // ISO: 1 = понедельник, у getDay() 0 = воскресенье.
  const todayDow = ((new Date().getDay() + 6) % 7) + 1

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title={isTeacher ? t('myScheduleTitle') : t('manageTitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Группа и версия — в шапке: это выбор области, а не настройка внутри
                экрана, и отдельный тулбар под заголовком дублировал полосу. Группа —
                с поиском на сервере: в списке первых 100 групп хвоста алфавита не было. */}
            <div className="w-48">
              <label htmlFor="schedule-group" className="sr-only">
                {t('selectGroup')}
              </label>
              <GroupSelect
                id="schedule-group"
                size="md"
                value={groupId || null}
                onChange={(next) => {
                  setGroupId(next ?? '')
                  setSelectedPair(null)
                }}
              />
            </div>

            {groupId && (
              <Select value={containerId} onValueChange={setContainerId}>
                <SelectTrigger size="md" className="w-52" aria-label={t('containers')}>
                  <SelectValue placeholder={t('noContainers')} />
                </SelectTrigger>
                <SelectContent>
                  {(containers.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.isActive ? ` · ${t('active')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {groupId && !isTeacher && (
              <Button
                type="button"
                variant="outline"
                size="md"
                icon
                aria-label={t('createContainer')}
                title={t('createContainer')}
                onClick={() => setVersionOpen(true)}
              >
                <Plus className="size-4" aria-hidden />
              </Button>
            )}

            {groupId &&
              containerId &&
              !isTeacher &&
              !containers.data?.find((c) => c.id === containerId)?.isActive && (
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  loading={activateContainer.isPending}
                  onClick={() => activateContainer.mutate(containerId)}
                >
                  <Check className="size-4" aria-hidden />
                  {t('activate')}
                </Button>
              )}

            {containerId && (
              <Button type="button" size="md" onClick={() => openAddPair(todayDow, '08:00')}>
                <Plus className="size-4" aria-hidden />
                {t('addPair')}
              </Button>
            )}
          </div>
        }
      />

      <FormAlert error={apiError} />

      {!groupId ? (
        <EmptyState
          icon={<Layers className="size-6" aria-hidden />}
          title={t('pickGroupTitle')}
          description={t('pickGroupHint')}
        />
      ) : !containerId ? (
        <EmptyState
          icon={<CalendarPlus className="size-6" aria-hidden />}
          title={t('noContainers')}
          description={isTeacher ? t('noScheduleTeacherHint') : t('createContainerHint')}
        />
      ) : container.isLoading ? (
        <Skeleton fill className="min-h-0" />
      ) : (
        <>
          {/* Телефон: один день списком. Недельная сетка на 360 px нечитаема. */}
          <div className="flex min-h-0 flex-1 flex-col md:hidden">
            <ScheduleDayList
              pairs={pairs}
              day={mobileDay}
              onDayChange={setMobileDay}
              selectedPairId={selectedPair?.id ?? null}
              todayDow={todayDow}
              onPairClick={onPairClick}
              onAdd={(d) => openAddPair(d, '08:00')}
            />
          </div>

          {/* Компьютер и планшет: неделя целиком, во всю ширину области контента. */}
          <div className="hidden min-h-0 flex-1 flex-col gap-2 md:flex">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MousePointerClick className="size-3.5" aria-hidden />
                {t('editorDragHint')}
              </p>
              {!weekendPairs && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowWeekend((v) => !v)}
                >
                  {showWeekend ? t('hideWeekend') : t('showWeekend')}
                </Button>
              )}
            </div>
            {/* Прокрутка внутри карточки: страница целиком не едет, шапка дней липкая.
                `sh-scroll` держит полосу прокрутки видимой и резервирует под неё место,
                иначе сетка сдвигалась бы на её ширину в момент появления. */}
            <Card className="sh-scroll min-h-0 flex-1 gap-0 overflow-auto py-0">
              <ScheduleEditor
                pairs={pairs}
                days={days}
                selectedPairId={selectedPair?.id ?? null}
                todayDow={todayDow}
                canEditPair={canEditPair}
                onSlotClick={onSlotClick}
                onPairClick={onPairClick}
                onPairMove={onPairMove}
              />
            </Card>
          </div>
        </>
      )}

      {selectedPair && (
        <PairDetailsModal
          pair={selectedPair}
          universityId={universityId}
          canEdit={canEditPair(selectedPair)}
          isTeacher={isTeacher}
          containerId={containerId}
          containerActive={containers.data?.find((c) => c.id === containerId)?.isActive ?? false}
          onClose={() => setSelectedPair(null)}
        />
      )}

      {addDraft && containerId && (
        <AddPairModal
          scheduleId={containerId}
          universityId={universityId}
          isTeacher={isTeacher}
          meId={me.data?.id}
          initial={addDraft}
          onClose={() => setAddDraft(null)}
        />
      )}

      {versionOpen && groupId && (
        <CreateVersionModal
          groupId={groupId}
          hasActive={containers.data?.some((c) => c.isActive) ?? false}
          onCreated={setContainerId}
          onClose={() => setVersionOpen(false)}
        />
      )}
    </div>
  )
}
