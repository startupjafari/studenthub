'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Ellipsis, Inbox, Plus, Search, Trash2 } from 'lucide-react'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  CodeInput,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FormAlert,
  Input,
  Label,
  Modal,
  PageHeader,
  PageLoader,
  Progress,
  PromptDialog,
  SegmentedTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Stepper,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useConfirm,
} from '../../../shared/ui'
import { Caption, Code, Demo, Pitfall, Section } from './kit'

// Инвентарь shared/ui: каждый компонент во всех состояниях, которые встречаются
// в продукте. Здесь же — правило выбора: какой компонент брать и в каком случае.

const BUTTON_VARIANTS = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const
const BADGE_VARIANTS = [
  'default',
  'secondary',
  'outline',
  'success',
  'info',
  'warning',
  'destructive',
] as const
const DEMO_TABS = [
  { value: 'all', label: 'Все', count: 24 },
  { value: 'new', label: 'Новые', count: 3 },
  { value: 'done', label: 'Готовые' },
] as const

const STEPS = [
  { id: 'service', label: 'Услуга' },
  { id: 'form', label: 'Данные' },
  { id: 'docs', label: 'Документы' },
  { id: 'done', label: 'Отправка' },
]

export function ComponentsSection() {
  const confirm = useConfirm()
  const [tab, setTab] = useState<(typeof DEMO_TABS)[number]['value']>('all')
  const [checked, setChecked] = useState(true)
  const [select, setSelect] = useState('')
  const [date, setDate] = useState('')
  const [code, setCode] = useState('')
  const [modal, setModal] = useState(false)
  const [sheet, setSheet] = useState<'right' | 'bottom' | null>(null)
  const [prompt, setPrompt] = useState(false)

  return (
    <div className="flex flex-col gap-10">
      <Section
        id="buttons"
        title="Кнопки"
        note="Один заливной default на экран — это главное действие. Остальное: outline для равнозначного, ghost в панелях и строках, destructive для необратимого."
      >
        <Demo label="Варианты">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </Demo>

        <Demo label="Размеры" rule="sm — в шапках и строках, default — в формах">
          <Button size="xs">xs</Button>
          <Button size="sm">sm</Button>
          <Button>default</Button>
          <Button size="lg">lg</Button>
        </Demo>

        <Demo label="Иконочные" rule="обязателен aria-label — подписи нет">
          <Button size="icon-xs" variant="ghost" aria-label="Найти">
            <Search />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Найти">
            <Search />
          </Button>
          <Button size="icon" variant="outline" aria-label="Добавить">
            <Plus />
          </Button>
          <Button size="icon-lg" aria-label="Добавить">
            <Plus />
          </Button>
          <Caption>размер иконки задаёт кнопка — свой size писать не нужно</Caption>
        </Demo>

        <Demo label="Состояния">
          <Button>Обычная</Button>
          <Button loading>Загрузка</Button>
          <Button disabled>Выключена</Button>
          <Button variant="outline" disabled>
            Выключена
          </Button>
          <Caption>loading гасит заливку и подставляет спиннер, проставляя aria-busy</Caption>
        </Demo>

        <Demo label="С иконкой">
          <Button>
            <Plus />
            Создать заявку
          </Button>
          <Button variant="outline">
            <Check />
            Готово
          </Button>
          <Button variant="destructive">
            <Trash2 />
            Удалить
          </Button>
        </Demo>

        <Pitfall>
          Выключенная кнопка не объясняет причину. Если причина неочевидна — рядом текст или{' '}
          <Code>Tooltip</Code>, иначе пользователь упирается в тупик.
        </Pitfall>
      </Section>

      <Section
        id="badges"
        title="Бейджи"
        note="Статус, счётчик, метка. Вариант выбирается по смыслу, а не по цвету: success — успешный исход, warning — нужно действие пользователя, info — идёт обработка."
      >
        <Demo label="Варианты">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </Demo>

        <Demo label="С иконкой и счётчиком">
          <Badge variant="success">
            <Check className="size-3" aria-hidden />
            Выдан
          </Badge>
          <Badge variant="secondary">12</Badge>
          <Badge variant="destructive">
            <Trash2 className="size-3" aria-hidden />
            Отклонена
          </Badge>
        </Demo>

        <Pitfall>
          Бейдж — не кнопка. Кликабельный фильтр — это <Code>SegmentedTabs</Code> или{' '}
          <Code>Button</Code> размера <Code>xs</Code>.
        </Pitfall>
      </Section>

      <Section
        id="inputs"
        title="Поля ввода"
        note="Высота контролов — h-11, скругление rounded-xl, «дышащий» фокус ring-4. Метка обязательна и связана по htmlFor."
      >
        <Demo label="Текст" className="items-start">
          <div className="flex w-56 flex-col gap-2">
            <Label htmlFor="ds-name">Название</Label>
            <Input id="ds-name" placeholder="Справка об обучении" />
          </div>
          <div className="flex w-56 flex-col gap-2">
            <Label htmlFor="ds-err">С ошибкой</Label>
            <Input id="ds-err" aria-invalid defaultValue="—" />
            <span className="text-xs text-destructive">Поле обязательно</span>
          </div>
          <div className="flex w-56 flex-col gap-2">
            <Label htmlFor="ds-off">Выключено</Label>
            <Input id="ds-off" disabled placeholder="Недоступно" />
          </div>
        </Demo>

        <Demo label="Многострочный" className="items-start">
          <div className="flex w-full max-w-md flex-col gap-2">
            <Label htmlFor="ds-text">Комментарий</Label>
            <Textarea id="ds-text" rows={3} placeholder="Причина возврата заявки" />
          </div>
        </Demo>

        <Demo label="Выбор" className="items-start">
          <div className="flex w-56 flex-col gap-2">
            <Label htmlFor="ds-select">Факультет</Label>
            <Select value={select} onValueChange={setSelect}>
              <SelectTrigger id="ds-select">
                <SelectValue placeholder="Не выбран" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="it">Информационные технологии</SelectItem>
                <SelectItem value="law">Юриспруденция</SelectItem>
                <SelectItem value="econ">Экономика</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-56 flex-col gap-2">
            <Label htmlFor="ds-date">Дата</Label>
            <DatePicker value={date} onChange={setDate} aria-label="Дата" />
          </div>
        </Demo>

        <Demo label="Флаг">
          <Label className="gap-2">
            <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
            Согласен на обработку данных
          </Label>
        </Demo>

        <Demo
          label="Код подтверждения"
          rule="ячейки — flex-1, поэтому родитель обязан ограничивать ширину"
          className="items-start"
        >
          <div className="flex w-full max-w-xs flex-col gap-2">
            <Label htmlFor="ds-code">Код из письма</Label>
            <CodeInput
              id="ds-code"
              value={code}
              onChange={setCode}
              length={6}
              groupSize={3}
              aria-label="Код из письма"
            />
          </div>
          <Pitfall>
            В контейнере без ограничения ширины (например, в <Code>flex</Code> без{' '}
            <Code>max-w-*</Code>) ячейки растягиваются по своей внутренней ширине и распирают
            страницу — на 375 px это даёт горизонтальную прокрутку.
          </Pitfall>
        </Demo>
      </Section>

      <Section
        id="surfaces"
        title="Карточки"
        note="Внутренний отступ задаёт --card-spacing через проп size, а не классы p-* на содержимом."
      >
        <Demo label="Card" className="items-start">
          <Card className="w-72">
            <CardHeader>
              <CardTitle>Справка об обучении</CardTitle>
              <CardDescription>Готовность — 3 рабочих дня</CardDescription>
              <CardAction>
                <Badge variant="info">В работе</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>Заявка принята деканатом, ожидает подписи.</CardContent>
            <CardFooter>
              <Button size="sm" variant="ghost">
                Открыть
              </Button>
            </CardFooter>
          </Card>

          <Card size="sm" className="w-72">
            <CardHeader>
              <CardTitle>Плотный вариант</CardTitle>
              <CardDescription>size=&quot;sm&quot; — отступ 12 px</CardDescription>
            </CardHeader>
            <CardContent>Для списков и боковых панелей.</CardContent>
          </Card>
        </Demo>
      </Section>

      <Section
        id="nav"
        title="Шапка и переключатели"
        note="Заголовок страницы существует только как проп title у PageHeader. SegmentedTabs — фильтр разделов в шапке, Tabs — вкладки со связанными панелями внутри контента."
      >
        <Demo label="PageHeader" className="block p-0">
          <PageHeader
            bleed={false}
            title="Заявки"
            subtitle="Каталог услуг деканата"
            tabs={
              <SegmentedTabs
                items={DEMO_TABS}
                value={tab}
                onChange={setTab}
                aria-label="Разделы заявок"
              />
            }
            actions={
              <Button size="sm">
                <Plus />
                Создать
              </Button>
            }
          />
        </Demo>
        <Caption>
          На странице шапка идёт с <Code>bleed</Code> (по умолчанию) и гасит отступы{' '}
          <Code>main</Code>; здесь выключено, чтобы показать её в потоке витрины.
        </Caption>

        <Demo label="Tabs" className="block">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Обзор</TabsTrigger>
              <TabsTrigger value="docs">Документы</TabsTrigger>
              <TabsTrigger value="log">История</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="text-sm text-muted-foreground">
              Содержимое вкладки «Обзор».
            </TabsContent>
            <TabsContent value="docs" className="text-sm text-muted-foreground">
              Содержимое вкладки «Документы».
            </TabsContent>
            <TabsContent value="log" className="text-sm text-muted-foreground">
              Содержимое вкладки «История».
            </TabsContent>
          </Tabs>
        </Demo>

        <Demo label="Stepper" className="block">
          <Stepper steps={STEPS} current={1} />
        </Demo>

        <Demo label="Breadcrumb" rule="только при вложенности от трёх уровней">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Университет</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Факультеты</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>ИТ</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </Demo>
      </Section>

      <Section
        id="feedback"
        title="Обратная связь и состояния"
        note="Постоянное сообщение — Alert в потоке; мгновенный отклик на действие — тост. Ошибка сервера в форме — FormAlert по коду ошибки."
      >
        <Demo label="Alert" className="block">
          <div className="flex flex-col gap-3">
            <Alert>
              <Inbox />
              <AlertTitle>Заявка сохранена как черновик</AlertTitle>
              <AlertDescription>Отправьте её, когда приложите все документы.</AlertDescription>
            </Alert>
            <Alert variant="info">
              <Inbox />
              <AlertTitle>Заявка в обработке</AlertTitle>
              <AlertDescription>Деканат рассмотрит её в течение трёх дней.</AlertDescription>
            </Alert>
            <Alert variant="warning">
              <Trash2 />
              <AlertTitle>Не приложены документы</AlertTitle>
              <AlertDescription>Без скана удостоверения заявку не примут.</AlertDescription>
            </Alert>
            <Alert variant="success">
              <Check />
              <AlertTitle>Справка готова</AlertTitle>
              <AlertDescription>Заберите в деканате или скачайте PDF.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <Trash2 />
              <AlertTitle>Документ не загрузился</AlertTitle>
              <AlertDescription>Файл больше 10 МБ.</AlertDescription>
            </Alert>
            <FormAlert
              error={{
                code: 'VALIDATION_ERROR',
                message: '',
                details: [{ field: 'email', message: 'Укажите почту университета' }],
              }}
            />
          </div>
        </Demo>

        <Demo label="Тосты">
          <Button variant="outline" size="sm" onClick={() => toast.success('Заявка отправлена')}>
            success
          </Button>
          <Button variant="outline" size="sm" onClick={() => toast.error('Не удалось сохранить')}>
            error
          </Button>
          <Button variant="outline" size="sm" onClick={() => toast.warning('Проверьте документы')}>
            warning
          </Button>
          <Button variant="outline" size="sm" onClick={() => toast.info('Расписание обновлено')}>
            info
          </Button>
          <Caption>тип красит полосу сверху тоста</Caption>
        </Demo>

        <Demo label="Загрузка" className="items-start">
          <div className="flex w-64 flex-col gap-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Caption>скелетон повторяет форму будущего контента</Caption>
          </div>
          <div className="h-40 w-64 rounded-xl bg-muted/30">
            <PageLoader label="Загружаем расписание" />
          </div>
        </Demo>

        <Demo label="Пусто" className="block">
          <EmptyState
            icon={<Inbox className="size-6" aria-hidden />}
            title="Заявок пока нет"
            description="Создайте первую заявку — она появится в этом списке."
            action={
              <Button size="sm">
                <Plus />
                Создать заявку
              </Button>
            }
          />
        </Demo>

        <Demo label="Progress" className="block">
          <div className="flex w-full max-w-md flex-col gap-3">
            <Progress value={72} />
            <Progress value={40} indicatorClassName="bg-warning" />
            <Progress value={18} indicatorClassName="bg-destructive" />
            <Caption>доля от целого; неопределённое ожидание — это спиннер, не полоса</Caption>
          </div>
        </Demo>

        <Demo label="Avatar и Tooltip">
          <Avatar>
            <AvatarFallback>АК</AvatarFallback>
          </Avatar>
          <Avatar className="size-10">
            <AvatarFallback>МД</AvatarFallback>
          </Avatar>
          <Avatar className="size-12">
            <AvatarFallback>ИТ</AvatarFallback>
          </Avatar>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Скачать">
                <Search />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Пояснение к иконочной кнопке</TooltipContent>
          </Tooltip>
          <Caption>подсказки нет на тач-экране — важный текст в неё не прячем</Caption>
        </Demo>
      </Section>

      <Section
        id="overlays"
        title="Оверлеи"
        note="Modal — единственная оболочка модального окна. Подтверждение действия — useConfirm, а не собственное окно с двумя кнопками."
      >
        <Demo label="Открыть">
          <Button variant="outline" onClick={() => setModal(true)}>
            Modal
          </Button>
          <Button variant="outline" onClick={() => setSheet('right')}>
            Sheet справа
          </Button>
          <Button variant="outline" onClick={() => setSheet('bottom')}>
            Sheet снизу
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void confirm({
                title: 'Отозвать заявку?',
                description: 'Заявка вернётся в черновики.',
              })
            }
          >
            useConfirm
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void confirm({
                title: 'Удалить документ?',
                description: 'Действие необратимо.',
                destructive: true,
              })
            }
          >
            useConfirm (destructive)
          </Button>
          <Button variant="outline" onClick={() => setPrompt(true)}>
            PromptDialog
          </Button>
        </Demo>

        <Demo label="DropdownMenu" rule="меню действий над элементом; выбор значения — это Select">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Действия">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem>Открыть</DropdownMenuItem>
              <DropdownMenuItem>Скачать</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Удалить</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Demo>

        {modal && (
          <Modal onClose={() => setModal(false)} title="Новая заявка" size="lg">
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ds-modal-input">Комментарий</Label>
                <Input id="ds-modal-input" placeholder="Необязательно" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setModal(false)}>
                  Отмена
                </Button>
                <Button onClick={() => setModal(false)}>Отправить</Button>
              </div>
            </div>
          </Modal>
        )}

        <Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
          <SheetContent side={sheet ?? 'right'}>
            <SheetHeader>
              <SheetTitle>Детали заявки</SheetTitle>
            </SheetHeader>
            <div className="p-4 text-sm text-muted-foreground">
              Боковая панель — для деталей и фильтров, нижняя — для действий на телефоне.
            </div>
          </SheetContent>
        </Sheet>

        <PromptDialog
          open={prompt}
          title="Название папки"
          placeholder="Например, «Первый курс»"
          submitLabel="Создать"
          cancelLabel="Отмена"
          onSubmit={() => setPrompt(false)}
          onClose={() => setPrompt(false)}
        />
      </Section>
    </div>
  )
}
