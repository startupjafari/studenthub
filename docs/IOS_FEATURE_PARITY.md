# StudentHub iOS — соответствие веб-версии

Сверка страниц веба (`apps/web/src/app`, меню — `widgets/app-shell/model/nav.ts`) с приложением
для iPhone (`apps/ios`) для всех 11 ролей платформы.

Дата сверки: 2026-11-08, ветка `feat/ios-all-roles`. Как устроена доработка и чем проверено —
`docs/IOS_IMPLEMENTATION_REPORT.md`.

## Статусы

| Статус | Что значит |
|---|---|
| **Implemented** | Экран есть, основные действия подключены к настоящему API, код собирается. На устройстве не проверялось. |
| **Adapted** | Сделано иначе, чем в вебе, потому что на телефоне так удобнее или иначе нельзя (холст, перетаскивание, таблица с колонками). |
| **Missing** | API есть, на iOS функции нет. |
| **Blocked by API** | На сервере нет маршрута или модели. Без изменений бэкенда не сделать. |
| **Verified** | Проверено вручную на устройстве или симуляторе. |

Ни одна строка не помечена **Verified**: код собирался через `xtool dev build`, запуска на
симуляторе или телефоне не было, тесты XCTest не прогонялись.

## Роли и оболочка

| Роль | Вкладки | Стартовый экран («Обзор») | Статус |
|---|---|---|---|
| STUDENT, STAROSTA | Главная, Расписание, Чаты, Учёба, Сервисы | лента | Implemented |
| TEACHER | Главная, Расписание, Чаты, Учёба, Сервисы | лента; обзор преподавателя — в «Учёбе» | Implemented |
| DEAN | Обзор, Расписание (факультета), Чаты, Разделы, Лента | `DeanScreen.dashboard` | Implemented |
| UNIVERSITY_ADMIN | Обзор, Чаты, Разделы, Лента | `UniAdminScreen.dashboard` | Implemented |
| UNIVERSITY_MODERATOR | Обзор, Чаты, Разделы, Лента | `AdminScreen.universityModeratorDashboard` | Implemented |
| PLATFORM_ADMIN | Обзор, Чаты, Разделы | `AdminScreen.platformDashboard` | Implemented |
| PLATFORM_MODERATOR | Обзор, Чаты, Разделы | `AdminScreen.platformModeratorDashboard` | Implemented |
| EMPLOYER | Обзор, Чаты, Разделы | `CareerScreen.employerHome` | Implemented |
| SECURITY_GUARD | Обзор, Разделы (без чатов и ленты) | `SecurityScreen.post` | Implemented |
| LIBRARIAN | Обзор, Разделы (без чатов и ленты) | `LibrarianScreen.home` | Implemented |

| Функция | iOS | Статус |
|---|---|---|
| «Разделы» — меню роли из веба по тем же группам, с поиском; группа «Аккаунт» у всех | `WorkspaceView`, каталоги областей (`*Screen.workspace`) | Implemented |
| Профиль из аватара в верхней панели любой вкладки | `ProfileToolbarButton` | Implemented |
| Колокольчик уведомлений на «Обзоре» | `RoleDashboardView` | Implemented |
| Бейдж непрочитанных чатов | `ChatBadgeModel` (кроме охраны и библиотеки) | Implemented |
| Ссылки веба открывают раздел роли в приложении | `DeepLink`, `CommunityDeepLink`, `AreaDeepLink` (ролевой разбор) | Implemented |
| Роль, которой сборка не знает | `UnsupportedRoleView`: «обновите приложение или откройте веб» | Implemented |
| Отключение разделов платформой (`platform/state`) | `CommunitySectionGate` для событий, документов, заявок, портфолио, вступления в чат | Implemented |
| Сохранение пути и прокрутки после перезапуска | — | Missing |

## До входа

| Страница веба | iOS | Статус |
|---|---|---|
| `/login` — пароль, 2FA, автозаполнение | `LoginView`, `TwoFactorStepView` | Implemented |
| `/login`, вкладка QR — вход по коду с телефона, где уже вошли | `QRSignInView`: `qr/create`, опрос `qr/claim`, код из SVG сервера | Implemented |
| `/forgot-password` | `ForgotPasswordView`: `auth/password/forgot` | Implemented |
| `/reset-password` — новый пароль по ссылке из письма | `ResetPasswordView`: `auth/password/reset`, политика пароля до запроса, «ссылка не работает» → новое письмо. Открывается по `studenthub://reset-password?token=…` или вставкой ссылки («Есть приглашение?» на экране входа); https-ссылка письма — после apple-app-site-association на домене | Implemented |
| `/legal/privacy`, `/legal/terms` | `LegalDocumentView`: полный текст, раскрывающиеся разделы, ru и kk | Implemented |
| `/register` — регистрация по приглашению | `RegisterView`: превью `invites/:token/preview` (роль, область, отказ по коду), `auth/register-by-invite`, email у приглашения без адреса, согласие и согласие представителя до 18 лет. Фото — после входа, в профиле. Ссылка — так же, как у сброса пароля | Adapted |
| Регистрация работодателя | `CareerSignupSheet` | Implemented |

## Главная, лента, публикации

| Функция | API | Статус |
|---|---|---|
| Лента с курсором, реакции, комментарии, репост, закладки, жалоба, просмотры, медиа | `/posts/*` | Implemented |
| Фильтры: все, группа, вуз, преподаватели, важное, сохранённое, модерация | `GET /posts?filter=` | Implemented |
| Пост: аудитория по роли, заголовок, черновик, отложенная публикация, «опубликовать сейчас» | `POST /posts`, `/posts/:id/publish` | Implemented |
| Закрепление, отправка поста в чат | `PATCH /posts/:id/pin`, `POST /chats/:id/share-post` | Implemented |
| Свои черновики и отложенные | `GET /posts?status&authorId` | Implemented |
| Статьи: чтение, лайк, закладка, комментарии, похожие, репост, создание и правка | `/profile/articles/*` | Implemented |
| Правка комментария к посту | маршрута нет | Blocked by API |

## Истории

| Функция | Статус |
|---|---|
| Полоса, просмотр, реакции, ответ, заглушить, удаление | Implemented |
| Кто посмотрел | Implemented |
| Опрос, ссылка, упоминания в редакторе | Adapted — упоминания ставятся столбиком, без перетаскивания |
| Актуальное: просмотр, создание, правка, порядок | Implemented |
| Предзагрузка соседних историй | Implemented |

## Чаты

Без изменений в этой ветке: список, переписка, вложения, голосовые, опросы, группы, реальное
время — Implemented. Вступление в чат по ссылке `/join-chat/<id>?k=` — Implemented.

## Расписание и календарь

| Функция | Статус |
|---|---|
| День и неделя, карточка пары с разовыми изменениями, работа без сети | Implemented |
| Все страницы `GET /schedule` (по 500 пар, `nextCursor`) | Implemented |
| Календарь (месяц и повестка) из пар, заданий, экзаменов, событий, праздников РК — студент, преподаватель, декан | Implemented |
| Листание недельного расписания на любую неделю | Missing (изменения хранятся на 14 дней вперёд) |
| Тип занятия (лекция или практика) | Blocked by API |

## Учёба студента

| Страница веба | iOS | Статус |
|---|---|---|
| `/academic` | `StudentAcademicView` | Implemented |
| `/grades`, `/attendance` | `StudentGradesView`, `StudentAttendanceView` | Implemented |
| `/assignments` | вкладки по статусу, карточка, черновик, сдача, файлы к сдаче | Implemented |
| материалы | фильтр по дисциплине, открытие файлов | Implemented |
| `/exams`, `/study-plan` | `StudentExamsView`, `StudentStudyPlanView` | Implemented |
| `/tasks` | `StudentTasksView` — производный список из заданий, заявок, событий | Implemented |
| `/checkin` | сканер, ручной ввод, ссылка `/checkin?t=` | Implemented |
| `/student-id` | QR с обновлением раз в 45 с | Implemented |
| «Мои задачи» как своя сущность | модели нет | Blocked by API |

## Преподаватель

| Страница веба | iOS | Статус |
|---|---|---|
| `/teacher` | `TeachingDashboardView`, выгрузка отчёта | Implemented |
| `/teacher/gradebook` | журнал: контрольные точки, оценки, итог | Implemented |
| `/teacher/assignments` | создание, публикация, проверка работ, возврат на исправление | Implemented |
| `/teacher/attendance` | журнал по дням, отметка с примечаниями и QR самоотметки | Implemented |
| `/teacher/exams` | экзамены и ведомость | Implemented |
| `/teacher/materials` | материалы с файлами | Implemented |
| `/teacher/schedule` | свои пары и изменения | Implemented |
| `/teacher/posts`, `/teacher/events` | свои публикации; события — общий экран сотрудников | Implemented |
| `/teacher/consultations`, `/teacher/groups` | «Предстоящие / Все»; группы с поиском и пометкой старосты | Implemented |
| Разовые изменения расписания преподавателем | права только у админа и декана, веб их тоже не даёт | Blocked by API |
| Правка названия материала | PATCH нет | Blocked by API |
| Перетаскивание пар в недельной сетке | форма правки | Adapted |

## Староста

| Страница веба | iOS | Статус |
|---|---|---|
| `/starosta/group`, `/starosta/classmates` | `StarostaGroupView` с фильтром «Одногруппники» | Implemented |
| `/starosta/group-documents` | запросы и прогресс по студентам | Implemented |
| `/starosta/invites` | создание, отзыв, импорт CSV/XLSX | Implemented |
| `/starosta/applications`, `/events`, `/schedule` | те же экраны, что у студента | Implemented |

## Профиль и настройки

| Функция | Статус |
|---|---|
| Шапка, счётчики, вкладки, сведения, правка, чужой профиль, дружба | Implemented |
| Друзья: список, входящие, отправленные, поиск | Implemented |
| Фото и видео профиля, альбомы | Implemented |
| Логин, язык писем и пушей (`locale`), привязка Telegram (роли платформы) | Implemented |
| Пароль, 2FA, уведомления, приватность, выгрузка данных, тема, поддержка, удаление аккаунта | Implemented |
| Чужой список друзей | `GET /friends` без `userId` — Blocked by API |
| Список сессий и завершение одной | Blocked by API |

## Сервисы студента

| Функция | Статус |
|---|---|
| Деканат, консультации, карта кампуса, библиотека читателя | Implemented |
| Заявки: каталог, анкета, документы по требованиям, результат, история, повторная подача | Implemented |
| Документы: мои, архив, мне открыли, загрузка, доступ, запросы документов | Implemented |
| Портфолио: правка и порядок | Implemented |
| События: вкладки, карточка, запись, встреча, обсуждение, создание | Implemented |
| Страница вуза `/universities/[id]` | Implemented |
| Маршрут по кампусу, 3D-вид | Missing |

## Карьера

| Страница веба | Статус |
|---|---|
| `/career`, `/career/vacancies` (+ карточка, отклик), `/applications`, `/profile`, `/resume`, `/events` | Implemented |
| `/career/companies`, `/vacancy-review`, `/analytics` (сотрудники вуза и платформы, выбор вуза у платформы) | Implemented |
| `/companies/[id]`, `/r/resume/[slug]` | Implemented |
| Графики аналитики карьеры | Adapted — полосы долей и строки значений |

## Работодатель

| Страница веба | Статус |
|---|---|
| `/employer` (обзор), `/vacancies`, `/candidates`, `/access`, `/team`, профиль компании | Implemented |
| Саморегистрация, подтверждение почты, вступление в команду | Implemented (с экрана входа) |
| Ссылки из писем (`/employer/verify`, `/employer/join`) открывают приложение | Adapted — ссылка или код вставляются вручную |
| Карточка своей вакансии отдельным запросом | GET нет, ищется в списке — Adapted |

## Деканат

| Страница веба | Статус |
|---|---|
| `/dean` — обзор дня, графики, выгрузка отчёта | Implemented |
| `/dean/groups`, `/students`, `/teachers`, `/starostas` — назначение старосты, учебные данные, выгрузка | Implemented |
| `/dean/courses`, `/exams` (ведомость), `/analytics`, `/appointments` | Implemented |
| `/dean/schedule` — версии, пары, разовые изменения | Implemented; сетка — Adapted |
| `/dean/invites`, `/applications`, `/posts`, `/events`, `/chats` | общие экраны — Implemented |
| Время записи на приём в поясе вуза | показывается в поясе устройства — Adapted |

## Администратор вуза

| Страница веба | Статус |
|---|---|
| `/university-admin` (обзор), `/analytics`, `/setup` | Implemented |
| `/faculties`, `/specialties`, `/groups` | Implemented |
| `/rooms` — помещения, QR-наклейки (AirPrint, «Поделиться») | Implemented |
| `/campus`, `/campus/[id]` — свойства, корпуса, этажи, публикация, версии | Implemented |
| Холст-редактор этажа и территории (`/campus-editor/*`) | Adapted — план только просмотр |
| `/cameras`, `/cameras/watch` — агенты, камеры, до 4 потоков | Implemented |
| `/schedule`, `/courses` | Implemented |
| `/users`, `/students`, `/teachers`, `/deans`, `/invites`, `/complaints`, `/audit` | общие экраны — Implemented |
| `/applications`, `/services`, `/document-types`, `/document-templates`, `/document-journal`, `/library/*`, `/posts`, `/events`, `/security` | общие экраны сотрудников — Implemented |
| Импорт списков факультетов, групп, расписания | маршрутов с файлом нет — Blocked by API |

## Общие разделы сотрудников

| Функция | Статус |
|---|---|
| Очередь заявок: фильтры, карточка, все решения, документы, результат и справка | Implemented |
| Обновление очереди в реальном времени | Missing (обновление жестом) |
| Каталог услуг, типы и шаблоны документов (загрузка DOCX, проверка, предпросмотр, публикация), журнал документов | Implemented |
| Библиотека вуза: настройки, каталог, отчёты, журнал просмотра удостоверений | Implemented |
| Публикации вуза и деканата, управление событиями, журналы охраны | Implemented |
| Перестановка документов и вопросов услуги | Missing |

## Администрирование и модерация

| Страница веба | Статус |
|---|---|
| Обзоры администратора и модераторов платформы, модератора вуза; статистика | Implemented |
| Жалобы: разбор, меры, переписка, «ко всем дублям» | Implemented |
| Журнал аудита, пользователи (блокировка, сессии, сброс 2FA, выгрузка), приглашения (импорт) | Implemented |
| Поддержка: переписка, ответ, темы, склейка, эскалация, закрытие | Implemented; голосовые и вложения — Missing |
| Вузы, заявки на демо, доступ к документам, модерация публикаций | Implemented |
| События и каталог услуг платформы, кампус модератора вуза | общие экраны — Implemented |
| Администраторы в карточке вуза | `GET /users` без фильтра вуза — Blocked by API |
| Повторная отправка приглашения | маршрута нет — Blocked by API |
| Сортировка по колонкам таблиц | Adapted — фильтры, порядок сервера |

## Охрана

| Страница веба | Статус |
|---|---|
| `/security` — пост, проходы, посетители, журналы | Implemented |
| `/security/cameras` — поток с водяным знаком, стена до 4 камер | Implemented |
| `/security/rooms`, `/r/<код>` — статус помещения | Implemented |
| `/verify-id`, `/scan` | Implemented |

## Библиотекарь

| Страница веба | Статус |
|---|---|
| `/library`, `/issue`, `/return`, `/loans`, `/reservations` | Implemented |
| `/library/catalog` (+ карточка, экземпляры, импорт, наклейки в PDF) | Implemented |
| `/library/inventory`, `/reports`, `/clearances`, `/c/<код>`, сканер QR и штрихкодов | Implemented |
| Ручное кадрирование обложки | Adapted — обрезка по центру до 2:3 |
