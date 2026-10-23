'use client'

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import {
  Ban,
  Download,
  GraduationCap,
  KeyRound,
  LogOut,
  ShieldCheck,
  Users as UsersIcon,
} from 'lucide-react'
import { Role, isHigherRole } from '@studenthub/shared-types'
import { ADMIN_PAGE_SIZES, type UserSortValue } from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import { saveFile, useMediaQuery } from '../../../shared/lib'
import {
  adminUserKeys,
  blockUserRequest,
  exportUsers,
  fetchMe,
  fetchUsers,
  ProfileLink,
  resetUserTwoFactorRequest,
  revokeUserSessionsRequest,
  unblockUserRequest,
  userKeys,
  type AdminUser,
} from '../../../entities/user'
import { AcademicRecordModal } from '../../../features/edit-academic-record'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  SegmentedTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  useSortState,
} from '../../../shared/ui'

interface UsersTableProps {
  title: string
  subtitle?: string
  // Фиксированная роль (экраны студентов/преподавателей/деканов) — тогда фильтр роли скрыт.
  role?: Role
  showRoleFilter?: boolean
}

// Роли вуза — их фильтр есть у всех, кому список доступен.
const UNIVERSITY_FILTER_ROLES: Role[] = [
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
  Role.TEACHER,
  Role.STAROSTA,
  Role.STUDENT,
  Role.SECURITY_GUARD,
  Role.LIBRARIAN,
]
// Платформа видит всех (UserService.listScope), в том числе людей вне вузов: своих админов
// и модераторов и работодателей. Вузу эти роли в фильтре не нужны — в его выборке их нет.
const PLATFORM_FILTER_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  ...UNIVERSITY_FILTER_ROLES,
  Role.EMPLOYER,
]
const PLATFORM_VIEWERS: Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]
// Варианты размера страницы — те же, что разрешает серверная схема (предел 200).
const PAGE_SIZES = ADMIN_PAGE_SIZES
// Ширины колонок: имя · email · роль · статус · действия (последняя — только тем,
// кто может блокировать; без неё берём первые четыре). Действий в строке до четырёх
// (учёба, сброс 2FA, сессии, блокировка с подписью) — колонка под них шире прочих служебных.
const COLS = ['24%', '26%', '16%', '14%', '20%'] as const
// До `md` почта и роль не показываются: пять колонок на 375px дают по 15–23px каждая, и
// таблица превращается в столбик многоточий (DESIGN_SYSTEM §15 — на мобильном таблица
// становится списком строк, а не сжимается). Остаются имя, статус и действие.
const COLS_NARROW = ['53%', '31%', '16%'] as const
const COLS_NARROW_READONLY = ['70%', '30%'] as const
const CAN_BLOCK: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
]
// Учебные данные студента (курс, форма оплаты, статус) ведёт вуз: декан — своего
// факультета, админ — своего вуза. Сервер проверяет область сам.
const CAN_EDIT_ACADEMIC: Role[] = [Role.DEAN, Role.UNIVERSITY_ADMIN]
const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]
// Срок блокировки: 0 — бессрочно. Три значения, а не поле ввода — как в разборе жалоб и
// мини-аппе: «7» и «70» в поле различаются одним промахом, а цена промаха — чужой доступ.
const BLOCK_TERMS = [
  { days: 0, key: 'blockForever' },
  { days: 7, key: 'blockWeek' },
  { days: 30, key: 'blockMonth' },
] as const
type BlockTerm = (typeof BLOCK_TERMS)[number]['days']

export function UsersTable({ title, subtitle, role, showRoleFilter = false }: UsersTableProps) {
  const t = useTranslations('Users')
  // Язык подписей в файле выгрузки (заголовки колонок и лист «Инфо» переводит API).
  const locale = useLocale()
  const tRoles = useTranslations('Roles')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const viewerRole = useAppSelector((s) => s.auth.role)
  const canBlock = viewerRole !== null && CAN_BLOCK.includes(viewerRole)
  const canEditAcademic = viewerRole !== null && CAN_EDIT_ACADEMIC.includes(viewerRole)
  const hasActions = canBlock || canEditAcademic
  const filterRoles =
    viewerRole !== null && PLATFORM_VIEWERS.includes(viewerRole)
      ? PLATFORM_FILTER_ROLES
      : UNIVERSITY_FILTER_ROLES
  const [academicFor, setAcademicFor] = useState<string | null>(null)
  const [resetTfaFor, setResetTfaFor] = useState<AdminUser | null>(null)
  // Блокировка гасит все сессии человека — только через диалог со сроком, не одним кликом.
  const [blockFor, setBlockFor] = useState<AdminUser | null>(null)
  const [sessionsFor, setSessionsFor] = useState<AdminUser | null>(null)
  // `md` — та же граница, на которой в проекте прячут второстепенные колонки таблиц
  // (`hidden md:table-cell` в комнатах, документах, курсах).
  const isWide = useMediaQuery('(min-width: 768px)')

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  // Сортировка серверная (sort/order в запросе) — упорядочены все записи выборки,
  // а не только открытая страница.
  const { sort, toggle } = useSortState()

  const effectiveRole = role ?? (roleFilter === 'all' ? undefined : roleFilter)
  const filters = {
    ...(effectiveRole ? { role: effectiveRole } : {}),
    ...(search ? { search } : {}),
    ...(sort ? { sort: sort.key as UserSortValue, order: sort.dir } : {}),
  }
  const query = { ...filters, page, limit }

  const users = useQuery({
    queryKey: adminUserKeys.list(query),
    queryFn: () => fetchUsers(query),
    // Прошлая страница остаётся на экране, пока грузится новая: иначе таблица
    // мигает скелетоном на каждый клик по стрелке.
    placeholderData: keepPreviousData,
  })
  const total = users.data?.total ?? 0
  const rows = users.data?.items ?? []

  // Новый фильтр или порядок — снова с первой страницы: на «странице 5» отфильтрованной
  // выборки может не быть строк вовсе, а после смены сортировки там уже другие строки.
  function refilter(apply: () => void): void {
    apply()
    setPage(1)
  }
  const sortBy = (key: string): void => refilter(() => toggle(key))

  // Разблокировка — сразу по кнопке: она ничего не отбирает. Блокировка — в BlockUserDialog.
  const blockMut = useMutation({
    mutationFn: ({ id }: { id: string }) => unblockUserRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminUserKeys.all })
      toast.success(t('updated'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Файл собирает сервер: там полная выборка по тем же фильтрам, лист с происхождением
  // выгрузки и единое имя файла. Клиентская сборка брала первую страницу ответа и молча
  // обрывала выгрузку на 200 строках — в файле это никак не было видно.
  const exportMut = useMutation({
    mutationFn: () => exportUsers(filters, locale),
    onSuccess: saveFile,
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {/* Поиск, фильтр роли и экспорт — в шапке (DESIGN_SYSTEM §10.1): это управление
          списком, отдельной строки над таблицей оно не заслуживает. На узком экране
          шапка переносит их на вторую строку сама (flex-wrap). */}
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <Input
              value={search}
              onChange={(e) => refilter(() => setSearch(e.target.value.trim()))}
              placeholder={t('searchPlaceholder')}
              size="md"
              className="w-40 sm:w-56"
            />
            {showRoleFilter && (
              <Select
                value={roleFilter}
                onValueChange={(v) => refilter(() => setRoleFilter(v as Role | 'all'))}
              >
                <SelectTrigger size="md" className="w-36 sm:w-44">
                  <SelectValue placeholder={t('allRoles')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allRoles')}</SelectItem>
                  {filterRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {tRoles(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              type="button"
              size="md"
              onClick={() => exportMut.mutate()}
              loading={exportMut.isPending}
              disabled={total === 0}
            >
              <Download className="size-4" aria-hidden />
              {t('export')}
            </Button>
          </>
        }
      />

      {users.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !users.isLoading && rows.length === 0 ? (
        <EmptyState icon={<UsersIcon className="size-6" aria-hidden />} title={t('empty')} />
      ) : (
        // Загрузка идёт скелетоном в строках: шапка, ширины колонок и подвал остаются
        // на месте, экран не «прыгает», когда данные приходят.
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table
            fixed
            scrollBody
            fill
            cols={
              isWide
                ? hasActions
                  ? COLS
                  : COLS.slice(0, 4)
                : hasActions
                  ? COLS_NARROW
                  : COLS_NARROW_READONLY
            }
          >
            <TableHeader>
              <TableRow>
                <TableHead sortKey="name" sort={sort} onSort={sortBy}>
                  {t('colName')}
                </TableHead>
                {isWide && (
                  <TableHead sortKey="email" sort={sort} onSort={sortBy}>
                    {t('colEmail')}
                  </TableHead>
                )}
                {isWide && (
                  <TableHead sortKey="role" sort={sort} onSort={sortBy}>
                    {t('colRole')}
                  </TableHead>
                )}
                <TableHead sortKey="blocked" sort={sort} onSort={sortBy}>
                  {t('colStatus')}
                </TableHead>
                {hasActions && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.isLoading && (
                <TableSkeletonRows columns={(isWide ? 4 : 2) + (hasActions ? 1 : 0)} />
              )}
              {rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    <ProfileLink
                      userId={u.id}
                      // `-my-2 py-2` растягивает ссылку на всю высоту ячейки: строка имени
                      // в 20px меньше минимальной цели нажатия WCAG 2.5.8 (24×24).
                      className="-my-2 block truncate py-2 hover:text-primary hover:underline"
                    >
                      {u.lastName} {u.firstName}
                    </ProfileLink>
                  </TableCell>
                  {isWide && (
                    <TableCell className="text-muted-foreground">
                      <TableText value={u.email} />
                    </TableCell>
                  )}
                  {isWide && (
                    <TableCell>
                      <TableText value={tRoles(u.role)} />
                    </TableCell>
                  )}
                  <TableCell>
                    {u.isBlocked ? (
                      <Badge variant="secondary" className="text-destructive">
                        {t('blocked')}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('active')}</span>
                    )}
                  </TableCell>
                  {hasActions && (
                    <TableCell className="text-right">
                      {canEditAcademic && STUDENT_ROLES.includes(u.role) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setAcademicFor(u.id)}
                          aria-label={t('academicAction')}
                          title={t('academicAction')}
                        >
                          <GraduationCap className="size-4" aria-hidden />
                        </Button>
                      )}
                      {/* Сброс 2FA — тому, кто потерял аутентификатор: только у кого она
                          включена и только строго младшему по роли (сервер так же). */}
                      {canBlock &&
                        viewerRole &&
                        isHigherRole(viewerRole, u.role) &&
                        u.twoFactorEnabled && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setResetTfaFor(u)}
                            aria-label={t('resetTwoFactor')}
                            title={t('resetTwoFactor')}
                          >
                            <KeyRound className="size-4" aria-hidden />
                          </Button>
                        )}
                      {/* Завершить сессии — угнанному аккаунту: чужой вылетает, а доступ
                          хозяина остаётся (блокировка наказала бы пострадавшего). */}
                      {canBlock && viewerRole && isHigherRole(viewerRole, u.role) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSessionsFor(u)}
                          aria-label={t('endSessions')}
                          title={t('endSessions')}
                        >
                          <LogOut className="size-4" aria-hidden />
                        </Button>
                      )}
                      {/* Блокировать можно только того, кто ниже по роли (сервер так же):
                          себя, равного и старшего — кнопки нет. */}
                      {canBlock && viewerRole && isHigherRole(viewerRole, u.role) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          loading={blockMut.isPending && blockMut.variables?.id === u.id}
                          onClick={() =>
                            u.isBlocked ? blockMut.mutate({ id: u.id }) : setBlockFor(u)
                          }
                          className={u.isBlocked ? 'text-success' : 'text-destructive'}
                          // До `md` подпись не влезает в колонку и обрезается на полуслове —
                          // остаётся иконка, а название действия уходит в доступное имя.
                          aria-label={isWide ? undefined : u.isBlocked ? t('unblock') : t('block')}
                        >
                          {u.isBlocked ? (
                            <>
                              <ShieldCheck className="size-4" aria-hidden />
                              {isWide && t('unblock')}
                            </>
                          ) : (
                            <>
                              <Ban className="size-4" aria-hidden />
                              {isWide && t('block')}
                            </>
                          )}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            total={total}
            limit={limit}
            onPageChange={setPage}
            limitOptions={PAGE_SIZES}
            // Новый размер страницы — снова с первой: «страницы 34» при 200 строках
            // на странице может уже не быть.
            onLimitChange={(n) => refilter(() => setLimit(n))}
          />
        </Card>
      )}
      {academicFor && (
        <AcademicRecordModal userId={academicFor} onClose={() => setAcademicFor(null)} />
      )}
      {resetTfaFor && (
        <ResetTwoFactorDialog user={resetTfaFor} onClose={() => setResetTfaFor(null)} />
      )}
      {blockFor && <BlockUserDialog user={blockFor} onClose={() => setBlockFor(null)} />}
      {sessionsFor && <EndSessionsDialog user={sessionsFor} onClose={() => setSessionsFor(null)} />}
    </div>
  )
}

/**
 * Блокировка с выбором срока. Она мгновенно гасит все сессии человека, и в таблице её
 * делал промах по иконке; срок (временная блокировка снимается сама) в вебе был недоступен.
 */
function BlockUserDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const t = useTranslations('Users')
  const tMod = useTranslations('Moderation')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const [days, setDays] = useState<BlockTerm>(0)

  const block = useMutation({
    mutationFn: () => blockUserRequest(user.id, days > 0 ? days : undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminUserKeys.all })
      toast.success(t('updated'))
      onClose()
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('blockTitle', { name: `${user.lastName} ${user.firstName}` })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {days === 0 ? tMod('confirmBlockForever') : tMod('confirmBlockFor', { days })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{tMod('blockTerm')}</span>
          <SegmentedTabs<`${BlockTerm}`>
            aria-label={tMod('blockTerm')}
            compact
            value={`${days}`}
            onChange={(v) => setDays(Number(v) as BlockTerm)}
            items={BLOCK_TERMS.map((term) => ({
              value: `${term.days}` as `${BlockTerm}`,
              label: tMod(term.key),
            }))}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={block.isPending}>{tCommon('cancel')}</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            loading={block.isPending}
            onClick={() => block.mutate()}
          >
            <Ban className="size-4" aria-hidden />
            {days === 0 ? tMod('blockUser') : tMod('blockUserFor', { days })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Завершение всех сессий человека — с подтверждением, как и остальные меры в строке. */
function EndSessionsDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const t = useTranslations('Users')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')

  const revoke = useMutation({
    mutationFn: () => revokeUserSessionsRequest(user.id),
    onSuccess: () => {
      toast.success(t('endSessionsDone'))
      onClose()
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('endSessions')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('endSessionsDesc', { name: `${user.lastName} ${user.firstName}` })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={revoke.isPending}>{tCommon('cancel')}</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            loading={revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            <LogOut className="size-4" aria-hidden />
            {t('endSessionsConfirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Сброс 2FA человеку, потерявшему аутентификатор и резервные коды. Подтверждается кодом
 * СВОЕГО второго фактора: сервер без него сброс не выполнит, а без включённой 2FA у самого
 * администратора — откажет, поэтому в этом случае поле кода не показываем вовсе.
 */
function ResetTwoFactorDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const t = useTranslations('Users')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const [code, setCode] = useState('')
  const ownTfa = me.data?.twoFactorEnabled === true

  const reset = useMutation({
    mutationFn: () => resetUserTwoFactorRequest(user.id, code.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminUserKeys.all })
      toast.success(t('resetTwoFactorDone'))
      onClose()
    },
    onError: (e) => {
      setCode('')
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    },
  })

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('resetTwoFactor')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('resetTwoFactorDesc', { name: `${user.lastName} ${user.firstName}` })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {me.data && !ownTfa ? (
          <p className="text-sm text-muted-foreground">{t('resetTwoFactorNeedOwn')}</p>
        ) : (
          <form
            id="reset-2fa-form"
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (code.trim()) reset.mutate()
            }}
          >
            <Label htmlFor="reset-2fa-code">{t('resetTwoFactorCode')}</Label>
            <Input
              id="reset-2fa-code"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
          </form>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
          {ownTfa && (
            <Button
              type="submit"
              form="reset-2fa-form"
              variant="destructive"
              loading={reset.isPending}
              disabled={!code.trim()}
            >
              {t('resetTwoFactorConfirm')}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
