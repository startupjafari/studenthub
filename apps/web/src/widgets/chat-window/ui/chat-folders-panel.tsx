'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ArrowLeft,
  BookOpen,
  Building2,
  Check,
  Folders,
  GraduationCap,
  GripVertical,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { CHAT_FOLDER_LIMITS } from '@studenthub/shared-schemas'
import type { ChatFolder, ChatListItem } from '../../../entities/chat'
import { Avatar, AvatarFallback, AvatarImage, Button, Checkbox, Input } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { avatarColor, chatInitials, chatTitle, TYPE_TAG } from '../lib/format'
import { BUILTIN_FOLDERS } from '../lib/folders'

// Настройка папок чатов (§2) — не модальное окно, а панель на месте списка чатов.
//
// Сборка папки — это работа со всем списком диалогов: имя, состав, порядок вкладок. В окне
// поверх списка на это оставалось меньше половины экрана, а на телефоне окно и сам список
// дрались за одну и ту же площадь. Панель занимает колонку целиком и на телефоне читается
// как обычный экран с «назад» — тем же жестом, что и выход из переписки.
//
// Три экрана внутри одной панели: список папок → настройка папки → выбор чатов. Отдельными
// маршрутами они быть не могут: список чатов на десктопе порталится в сайдбар, и панель
// живёт там же, где жил бы он.

type Screen = 'list' | 'edit' | 'pick'

/** Черновик папки: правки живут здесь, на сервер уходят одним сохранением. */
interface Draft {
  // 'new' — папки ещё нет; иначе id существующей.
  id: string | 'new'
  name: string
  chatIds: string[]
}

// Типы чатов для быстрого набора состава (экран выбора). Берём те же встроенные вкладки,
// что и в ряду папок: набор типов у продукта один, и второй его список разъехался бы
// с первым при добавлении роли.
const TYPE_ICON: Record<string, LucideIcon> = {
  folderPersonal: User,
  folderGroups: Users,
  folderSubjects: BookOpen,
  folderDean: Building2,
  folderUniversity: GraduationCap,
}
const TYPE_GROUPS = BUILTIN_FOLDERS.filter((f) => f.types && f.types.length > 0)

export function ChatFoldersPanel({
  embedded,
  hidden,
  folders,
  chats,
  busy,
  editId,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
}: {
  embedded: boolean
  /** Колонка скрыта на узком экране (открыта переписка) — как и сам список чатов. */
  hidden: boolean
  folders: ChatFolder[]
  chats: ChatListItem[]
  busy?: boolean
  /** Открыть сразу на настройке этой папки — «Настроить папку» из меню вкладки. */
  editId?: string | null
  onClose: () => void
  onCreate: (input: { name: string; chatIds: string[] }) => void
  onUpdate: (id: string, input: { name?: string; chatIds?: string[] }) => void
  onDelete: (id: string) => void
  /** Новый порядок вкладок: id папок сверху вниз. */
  onReorder: (ids: string[]) => void
}) {
  // Стартовый экран считается один раз при монтировании: панель открывают либо «настроить
  // папки» (список), либо «настроить папку» из меню вкладки (сразу её настройка).
  const initial = editId ? folders.find((f) => f.id === editId) : undefined
  const [screen, setScreen] = useState<Screen>(initial ? 'edit' : 'list')
  const [draft, setDraft] = useState<Draft | null>(
    initial ? { id: initial.id, name: initial.name, chatIds: initial.chatIds } : null,
  )

  // Чаты, из которых вообще можно собрать папку: непринятые запросы (§50) и архив в свои
  // папки не попадают — у них свои вкладки, и галочка там ничего бы не дала.
  const pickable = useMemo(() => chats.filter((c) => !c.requestIncoming && !c.archived), [chats])
  const chatById = useMemo(() => new Map(chats.map((c) => [c.id, c])), [chats])

  const ordered = useMemo(
    () => [...folders].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [folders],
  )

  // Папку удалили (из настройки самой папки или из меню вкладки) — возвращаемся к списку.
  // Навигацию делает исчезновение папки, а не нажатие: удаление проходит через подтверждение
  // в родителе, и по нажатию мы ушли бы с экрана ещё до ответа «да».
  useEffect(() => {
    if (!draft || draft.id === 'new') return
    if (folders.some((f) => f.id === draft.id)) return
    setDraft(null)
    setScreen('list')
  }, [folders, draft])

  function openFolder(f: ChatFolder): void {
    setDraft({ id: f.id, name: f.name, chatIds: f.chatIds })
    setScreen('edit')
  }

  function openNew(): void {
    setDraft({ id: 'new', name: '', chatIds: [] })
    setScreen('edit')
  }

  function save(): void {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) return
    if (draft.id === 'new') onCreate({ name, chatIds: draft.chatIds })
    else onUpdate(draft.id, { name, chatIds: draft.chatIds })
    setDraft(null)
    setScreen('list')
  }

  return (
    <aside
      className={cn(
        embedded
          ? 'flex h-full w-full flex-col'
          : cn(
              // Те же классы, что у списка чатов: панель встаёт на его место, а не рядом.
              'w-full shrink-0 flex-col border-r border-border md:flex md:w-80 lg:hidden',
              hidden ? 'hidden md:flex' : 'flex',
            ),
      )}
    >
      {screen === 'list' ? (
        <FoldersScreen
          folders={ordered}
          onBack={onClose}
          onOpen={openFolder}
          onNew={openNew}
          onReorder={onReorder}
        />
      ) : screen === 'edit' && draft ? (
        <EditScreen
          draft={draft}
          chatById={chatById}
          busy={busy}
          onBack={() => {
            setDraft(null)
            setScreen('list')
          }}
          onName={(name) => setDraft({ ...draft, name })}
          onRemoveChat={(id) =>
            setDraft({ ...draft, chatIds: draft.chatIds.filter((c) => c !== id) })
          }
          onAddChats={() => setScreen('pick')}
          onDelete={draft.id === 'new' ? undefined : () => onDelete(draft.id)}
          onSave={save}
        />
      ) : draft ? (
        <PickScreen
          chats={pickable}
          picked={draft.chatIds}
          onCancel={() => setScreen('edit')}
          onApply={(chatIds) => {
            setDraft({ ...draft, chatIds })
            setScreen('edit')
          }}
        />
      ) : null}
    </aside>
  )
}

// ── Шапка панели ─────────────────────────────────────────────────────────────
// Высота та же, что у шапки списка чатов и шапки переписки (py-3 вокруг 40-px кнопок):
// нижние границы всех трёх идут одной линией, и переход между экранами не дёргает вёрстку.
function PanelHeader({
  title,
  onBack,
  action,
}: {
  title: string
  onBack: () => void
  action?: React.ReactNode
}) {
  const t = useTranslations('Chats')
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-3">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('back')}
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate text-lg font-bold">{title}</span>
      {action}
    </div>
  )
}

/** Заголовок блока — как «Папки» и «Выбранные чаты» в макете. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
      {children}
    </p>
  )
}

// ── Экран 1: список папок ────────────────────────────────────────────────────
function FoldersScreen({
  folders,
  onBack,
  onOpen,
  onNew,
  onReorder,
}: {
  folders: ChatFolder[]
  onBack: () => void
  onOpen: (f: ChatFolder) => void
  onNew: () => void
  onReorder: (ids: string[]) => void
}) {
  const t = useTranslations('Chats')
  const limitReached = folders.length >= CHAT_FOLDER_LIMITS.MAX_FOLDERS
  const reorder = useRowReorder(
    folders.map((f) => f.id),
    onReorder,
  )
  // Порядок во время перетаскивания — уже переставленный: строка едет за пальцем, соседи
  // расступаются сразу, а не после отпускания.
  const view = reorder.apply(folders)

  return (
    <>
      <PanelHeader title={t('foldersTitle')} onBack={onBack} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-4">
        <div className="flex shrink-0 flex-col items-center gap-3 pb-5 text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Folders className="size-8" aria-hidden />
          </span>
          <p className="max-w-xs text-sm text-muted-foreground">{t('foldersDescription')}</p>
          <Button onClick={onNew} disabled={limitReached} className="gap-2">
            <Plus className="size-4" aria-hidden />
            {t('foldersCreate')}
          </Button>
          {limitReached && (
            <p className="text-xs text-muted-foreground">
              {t('foldersLimit', { max: CHAT_FOLDER_LIMITS.MAX_FOLDERS })}
            </p>
          )}
        </div>

        <SectionTitle>{t('foldersSection')}</SectionTitle>
        {/* Блок держит всю оставшуюся высоту колонки, а не растёт от числа папок: список
            папок — главное на экране, и его рамка не должна прыгать после каждой созданной
            или удалённой папки. Прокручивается он сам, внутри рамки. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border">
          {folders.length === 0 ? (
            <p className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
              {t('foldersEmpty')}
            </p>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {view.map((f, i) => (
                <div
                  key={f.id}
                  ref={reorder.rowRef(f.id)}
                  style={reorder.rowStyle(f.id)}
                  className={cn(
                    'group relative flex items-center gap-2 bg-background pr-2 transition-colors',
                    i > 0 && 'border-t border-border',
                    reorder.draggingId === f.id && 'z-10 shadow-lg',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(f)}
                    className="min-w-0 flex-1 cursor-pointer px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                  >
                    <p className="truncate text-sm font-medium">{f.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('foldersChatCount', { count: f.chatIds.length })}
                    </p>
                  </button>
                  {/* Ручка сортировки. На десктопе появляется при наведении — постоянная
                      колонка точек в спокойном списке только шумит; на тач-устройствах
                      наведения нет, поэтому там она видна всегда. */}
                  <button
                    type="button"
                    aria-label={t('foldersReorder')}
                    title={t('foldersReorder')}
                    onPointerDown={(e) => reorder.start(e, f.id)}
                    className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground opacity-100 transition-opacity hover:text-foreground active:cursor-grabbing lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
                  >
                    <GripVertical className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Экран 2: настройка папки ─────────────────────────────────────────────────
function EditScreen({
  draft,
  chatById,
  busy,
  onBack,
  onName,
  onRemoveChat,
  onAddChats,
  onDelete,
  onSave,
}: {
  draft: Draft
  chatById: Map<string, ChatListItem>
  busy?: boolean
  onBack: () => void
  onName: (v: string) => void
  onRemoveChat: (id: string) => void
  onAddChats: () => void
  onDelete?: () => void
  onSave: () => void
}) {
  const t = useTranslations('Chats')
  return (
    <>
      <PanelHeader
        title={draft.id === 'new' ? t('foldersCreate') : t('foldersSettings')}
        onBack={onBack}
        action={
          <button
            type="button"
            aria-label={t('foldersSave')}
            title={t('foldersSave')}
            disabled={!draft.name.trim() || busy}
            onClick={onSave}
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="size-5" aria-hidden />
          </button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-3 py-4">
        <div className="shrink-0">
          <SectionTitle>{t('foldersNameLabel')}</SectionTitle>
          <Input
            autoFocus
            value={draft.name}
            maxLength={CHAT_FOLDER_LIMITS.NAME_MAX}
            placeholder={t('foldersNamePlaceholder')}
            onChange={(e) => onName(e.target.value)}
            aria-label={t('foldersNameLabel')}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <SectionTitle>{t('foldersSelectedChats')}</SectionTitle>
          {/* Блок во всю оставшуюся высоту: рамка стоит на месте, а состав прокручивается
              внутри неё. Весь состав без пагинации и без «показать ещё» — папку собирают
              глазами по всему списку, и спрятанный хвост пришлось бы раскрывать каждый раз. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border">
            <button
              type="button"
              onClick={onAddChats}
              className="flex w-full shrink-0 cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/5"
            >
              <Plus className="size-4 shrink-0" aria-hidden />
              {t('foldersAddChats')}
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {draft.chatIds.map((id) => {
                const c = chatById.get(id)
                if (!c) return null
                const title = chatTitle(c, t)
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 border-t border-border px-3 py-2"
                  >
                    <Avatar className="size-8 shrink-0">
                      {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                      <AvatarFallback
                        className={cn('text-xs font-medium text-white', avatarColor(c.id))}
                      >
                        {chatInitials(title)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
                    <button
                      type="button"
                      aria-label={t('foldersRemoveChat')}
                      title={t('foldersRemoveChat')}
                      onClick={() => onRemoveChat(id)}
                      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Удаление прижато к низу колонки: это не продолжение состава, а выход из папки
            совсем, и стоять вплотную к последнему чату ему нельзя. */}
        {onDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-2xl border border-border px-3 py-2.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
          >
            <Trash2 className="size-4 shrink-0" aria-hidden />
            {t('foldersDelete')}
          </button>
        )}
      </div>
    </>
  )
}

// ── Экран 3: выбор чатов ─────────────────────────────────────────────────────
function PickScreen({
  chats,
  picked,
  onCancel,
  onApply,
}: {
  chats: ChatListItem[]
  picked: string[]
  onCancel: () => void
  onApply: (chatIds: string[]) => void
}) {
  const t = useTranslations('Chats')
  // Пока выбирают — набор локальный: «назад» должно отменять выбор целиком, а не
  // оставлять половину проставленных галочек в папке.
  const [sel, setSel] = useState<string[]>(picked)
  const [query, setQuery] = useState('')
  const selSet = useMemo(() => new Set(sel), [sel])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chats
    return chats.filter((c) => chatTitle(c, t).toLowerCase().includes(q))
  }, [chats, query, t])

  function toggle(id: string): void {
    setSel((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= CHAT_FOLDER_LIMITS.MAX_CHATS_PER_FOLDER) return prev
      return [...prev, id]
    })
  }

  /**
   * Тип чата как быстрый набор состава: галочка отмечает разом все диалоги этого типа.
   *
   * Папка хранит явный список чатов, а не правило «все группы» — поэтому тип здесь именно
   * кнопка «отметить всё это», а не фильтр, который будет сам подхватывать новые чаты.
   * Галочка у типа стоит, пока в папке лежат все его чаты: сняли один — снялась и она.
   */
  function toggleType(ids: string[], on: boolean): void {
    setSel((prev) => {
      if (!on) return prev.filter((x) => !ids.includes(x))
      const next = [...prev]
      for (const id of ids) {
        if (next.length >= CHAT_FOLDER_LIMITS.MAX_CHATS_PER_FOLDER) break
        if (!next.includes(id)) next.push(id)
      }
      return next
    })
  }

  return (
    <>
      <PanelHeader
        title={t('foldersPickTitle')}
        onBack={onCancel}
        action={
          <button
            type="button"
            aria-label={t('foldersDone')}
            title={t('foldersDone')}
            onClick={() => onApply(sel)}
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10 active:scale-90"
          >
            <Check className="size-5" aria-hidden />
          </button>
        }
      />
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-10 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-3 py-4">
        <div className="shrink-0">
          <SectionTitle>{t('foldersChatTypes')}</SectionTitle>
          <div className="overflow-hidden rounded-2xl border border-border">
            {TYPE_GROUPS.map((g, i) => {
              const ids = chats.filter((c) => g.types?.includes(c.type)).map((c) => c.id)
              if (ids.length === 0) return null
              const on = ids.every((id) => selSet.has(id))
              const Icon = TYPE_ICON[g.id] ?? Users
              return (
                <label
                  key={g.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50',
                    i > 0 && 'border-t border-border',
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm">{t(g.id)}</span>
                  <Checkbox checked={on} onCheckedChange={(v) => toggleType(ids, v === true)} />
                </label>
              )
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <SectionTitle>{t('foldersChatsSection')}</SectionTitle>
          {/* Блок во всю оставшуюся высоту: по мере набора в поиске рамка не должна
              схлопываться до одной строки и снова разъезжаться. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border">
            {visible.length === 0 ? (
              <p className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
                {t('noResults')}
              </p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {visible.map((c, i) => {
                  const title = chatTitle(c, t)
                  const tag = TYPE_TAG[c.type]
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/50',
                        i > 0 && 'border-t border-border',
                      )}
                    >
                      <Avatar className="size-9 shrink-0">
                        {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                        <AvatarFallback
                          className={cn('text-xs font-medium text-white', avatarColor(c.id))}
                        >
                          {chatInitials(title)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t(tag.key)}
                        </span>
                      </span>
                      <Checkbox
                        checked={selSet.has(c.id)}
                        onCheckedChange={() => toggle(c.id)}
                        aria-label={title}
                      />
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Перетаскивание строк ─────────────────────────────────────────────────────
/**
 * Смена порядка папок перетаскиванием за ручку.
 *
 * Pointer-события, а не HTML5 drag-and-drop: последний на тач-устройствах просто не
 * стреляет, а ряд папок правят в первую очередь с телефона. Строки в списке одной высоты,
 * поэтому новое место считается делением сдвига на высоту строки — без измерения каждой.
 */
function useRowReorder(ids: string[], onReorder: (ids: string[]) => void) {
  const rows = useRef(new Map<string, HTMLElement>())
  type Drag = { id: string; from: number; to: number; dy: number }
  const [drag, setDrag] = useState<Drag | null>(null)
  // Тот же жест, но читаемый из обработчика событий: обновлять порядок из функции-апдейтера
  // состояния нельзя — в StrictMode её зовут дважды, и перестановка ушла бы на сервер дважды.
  const dragRef = useRef<Drag | null>(null)
  const set = (d: Drag | null): void => {
    dragRef.current = d
    setDrag(d)
  }

  function start(e: React.PointerEvent<HTMLElement>, id: string): void {
    const from = ids.indexOf(id)
    if (from < 0 || ids.length < 2) return
    e.preventDefault()
    const startY = e.clientY
    const height = rows.current.get(id)?.offsetHeight ?? 56
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    set({ id, from, to: from, dy: 0 })

    const move = (ev: PointerEvent): void => {
      const dy = ev.clientY - startY
      const to = Math.min(ids.length - 1, Math.max(0, from + Math.round(dy / height)))
      set({ id, from, to, dy })
    }
    const end = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      const d = dragRef.current
      set(null)
      if (d && d.to !== d.from) {
        const next = [...ids]
        next.splice(d.to, 0, ...next.splice(d.from, 1))
        onReorder(next)
      }
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  return {
    start,
    draggingId: drag?.id ?? null,
    rowRef: (id: string) => (el: HTMLElement | null) => {
      if (el) rows.current.set(id, el)
      else rows.current.delete(id)
    },
    /** Порядок, который видно прямо сейчас: во время перетаскивания — уже переставленный. */
    apply<T extends { id: string }>(items: T[]): T[] {
      if (!drag) return items
      const next = [...items]
      next.splice(drag.to, 0, ...next.splice(drag.from, 1))
      return next
    },
    // Соседи ничего не смещают: они уже стоят на новых местах (см. apply). Свой сдвиг есть
    // только у перетаскиваемой строки — путь пальца минус строки, через которые она уже
    // перескочила, иначе она уехала бы вдвое дальше курсора.
    rowStyle(id: string): React.CSSProperties | undefined {
      if (!drag || id !== drag.id) return undefined
      const height = rows.current.get(id)?.offsetHeight ?? 56
      return { transform: `translateY(${drag.dy - (drag.to - drag.from) * height}px)` }
    },
  }
}
