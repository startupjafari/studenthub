# StudentHub iOS — соответствие веб-версии

Сверка функций веба (`apps/web`) для ролей STUDENT, STAROSTA и TEACHER с приложением
для iPhone (`apps/ios`). Другие роли приложение не ведёт, им показывается экран «откройте
веб» (`UnsupportedRoleView`).

Дата сверки: 2026-11-08, ветка `feat/ios-native-parity`.

## Статусы

| Статус | Что значит |
|---|---|
| **Implemented** | Экран есть, основные действия подключены к настоящему API, код собирается. На устройстве не проверялось. |
| **Needs redesign** | Работает, но заметно уступает вебу или новой концепции. |
| **Missing** | API есть, на iOS функции нет. |
| **Blocked by API** | На сервере нет маршрута или модели. Без изменений бэкенда не сделать. |
| **Verified** | Проверено вручную на устройстве или симуляторе. |

Ни одна строка не помечена **Verified**. В этой работе код только собирался через
`xtool dev build`. Запуска на симуляторе или телефоне не было, тестов XCTest тоже.

## Навигация и оболочка

| Функция | Веб | iOS | Статус |
|---|---|---|---|
| 5 вкладок: Главная, Расписание, Чаты, Учёба, Сервисы | боковое меню `widgets/app-shell/model/nav.ts` | `AppTab`, `AppShellView`; свой `NavigationStack` у каждой вкладки | Implemented |
| Профиль из аватара в верхней панели | шапка | `ProfileToolbarButton` на корне каждой вкладки | Implemented |
| Бейдж непрочитанных чатов | счётчик в меню | `ChatBadgeModel` | Implemented |
| Бейджи уведомлений и заявок на вкладках | — | только колокольчик на главной | Needs redesign |
| Диплинки | маршруты веба | `DeepLink`: чаты, посты, профили, заявки, события, библиотека, `/consultations`, `/appointments`, `/portfolio`, `/campus` | Implemented |
| Сохранение пути и прокрутки вкладки | — | путь — в `AppRouter`; прокрутка — силами SwiftUI внутри сессии; после перезапуска не восстанавливается | Needs redesign |
| Liquid Glass (iOS 26) | — | системная панель вкладок, `tabBarMinimizeBehavior`, `floatingGlass` для плавающих контролов | Implemented |

## Главная, лента, публикации

| Функция | API | iOS | Статус |
|---|---|---|---|
| Лента с курсором и сводкой реакций | `GET /posts?reactions=summary` | `FeedModel`, `PostCardView` | Implemented |
| Порядок главной: истории → пара → «Что нового?» → лента | — | `HomeView` | Implemented |
| Создание поста с медиа | `POST /files/presign` → `/files/confirm` → `POST /posts` | `PostComposerView` | Implemented |
| Выбор аудитории поста | `POST /posts {audience}` | композер без выбора аудитории | Needs redesign |
| Правка и удаление своего поста | `PATCH`, `DELETE /posts/:id` | `PostActionsHost` | Implemented |
| Закрепление, черновики, отложенные посты | `PATCH /posts/:id/pin`, `POST /posts/:id/publish` | — | Missing |
| Реакции | `POST`, `DELETE /posts/:id/reactions` | Implemented | Implemented |
| Комментарии и ответы | `GET`, `POST`, `DELETE /posts/:id/comments` | `PostCommentsView` (лист) | Implemented |
| Правка комментария | маршрута нет | — | Blocked by API |
| Репост | `POST /posts/:id/repost` | Implemented | Implemented |
| Сохранить пост, список сохранённого | `POST /posts/:id/bookmark`, `GET /posts?filter=SAVED` | закладка в карточке; `SavedPostsView` из своего профиля | Implemented |
| Поделиться в чат | `POST /chats/:id/share-post` | — | Missing |
| Жалоба | `POST /complaints` | Implemented | Implemented |
| Просмотры | `POST /posts/:id/view` | Implemented | Implemented |
| Карусели, видео, HLS | `media[].sources`, `hls` | `PostMediaView`, `MediaViewer` | Implemented |
| Фильтры ленты (группа, вуз, преподаватели, важное) | `GET /posts?filter=` | — | Missing |
| Поиск людей и событий | `GET /search` | `SearchView` | Implemented |
| Статьи (чтение, лайк, комментарии) | `/profile/articles/*` | только карточки во вкладке профиля, без чтения | Missing |

## Истории

| Функция | API | iOS | Статус |
|---|---|---|---|
| Полоса историй, статусы просмотра | `GET /stories` | `StoriesRail` | Implemented |
| Просмотр: прогресс, пауза удержанием, переход, закрытие свайпом | `POST /stories/:id/view` | `StoryViewer` | Implemented |
| Реакции, ответ в личку, заглушить автора, удаление | `/stories/:id/reactions`, `POST /chats/story-reply`, `/stories/mutes/:userId` | Implemented | Implemented |
| Опрос в истории, ссылка, упоминания | `POST /stories/:id/vote`, интерактивные элементы | голосование и показ элементов есть, создание элементов в редакторе — нет | Needs redesign |
| Создание: фото или видео, текст, аудитория | `POST /stories` | `StoryComposerView` (PhotosPicker) | Implemented |
| Кто посмотрел | `GET /stories/:id/viewers` | — | Missing |
| Актуальное (highlights) | `/stories/highlights/*` | — | Missing |
| Предзагрузка соседних историй | — | — | Missing |

## Чаты

| Функция | API | iOS | Статус |
|---|---|---|---|
| Список: поиск, папки, закрепление, архив, заглушение | `/chats`, `/chats/folders`, pin, archive, mute | `ChatListView` | Implemented |
| Переписка: ответ, пересылка, реакции, правка, удаление, закрепление | `/chats/:id/messages` и др. | `ChatThreadView` | Implemented |
| Вложения, фото, видео, голосовые | `/chats/:id/attachments/presign`, `/messages/uploaded` | `MessageComposerView`, `VoiceRecorder` | Implemented |
| Опросы в чате | `/chats/polls/*` | `ChatPollView` | Implemented |
| Группы: участники, админы, ссылка-приглашение | `/chats/:id/members` и др. | `ChatInfoView` | Implemented |
| Реальное время, переподключение | socket.io | `RealtimeCoordinator` | Implemented |
| Поддержка — чат с командой | `POST /support` | открывается из «Настройки → Поддержка» | Implemented |

## Расписание

| Функция | API | iOS | Статус |
|---|---|---|---|
| День: полоса дней с датами, отметка «сегодня» | `GET /schedule`, `/schedule/changes` | `ScheduleView` | Implemented |
| Неделя | то же | режим «Неделя» | Implemented |
| Месяц | — | — | Missing (пары еженедельные, разовые изменения — на 14 дней вперёд) |
| Работа без сети | — | локальная база GRDB | Implemented |
| Карточка занятия: время, изменение, аудитория, преподаватель, дисциплина, задания | — | `LessonDetailView` | Implemented |
| Переход к аудитории на карте | `GET /campus/rooms/:roomId/location` | из карточки занятия | Implemented |
| Тип занятия (лекция или практика) | у пары нет поля | — | Blocked by API |
| Отметка посещаемости (преподаватель) | `GET /attendance/roster`, `PUT /attendance` | `AttendanceMarkingView` | Implemented |
| Правка своих пар преподавателем, разовые изменения | `POST`, `DELETE /schedule/changes` | — | Missing |

## Учёба

| Функция | API | iOS | Статус |
|---|---|---|---|
| Сводка: курс, специальность, статус, GPA, средний результат, посещаемость | `/users/me`, `/gradebook/me`, `/attendance/me` | `StudyView` + `AcademicSummary`, по правилу веба | Implemented |
| Ближайшие сроки | `GET /assignments` | `StudyView` | Implemented |
| Дисциплины: семестры, поиск, карточка с заданиями и материалами | `GET /courses` | `CoursesView`, `CourseDetailView` | Implemented |
| Оценки | `GET /gradebook/me` | `GradesView` | Implemented |
| Посещаемость | `GET /attendance/me` | `AttendanceView` | Implemented |
| Задания: список, карточка, черновик текста или ссылки, сдача | `/assignments/*` | `AssignmentsView` | Implemented |
| Файлы к сдаче задания | `/assignments/:id/submission/files` | — | Missing |
| Материалы, скачивание файлов | `/materials`, `.../files/:id/presigned` | список есть, скачивания нет | Needs redesign |
| Экзамены, учебный план | `/exams` | — | Missing |
| Отметка по QR (`/checkin`) | `POST /attendance/check-in` | — | Missing |
| «Мои задачи» | модели нет; веб собирает список из заявок, событий, заданий | — | Blocked by API (своих задач нет); производный список — Missing |
| Календарь | диапазона дат нет; веб собирает его из расписания, событий, заданий и экзаменов | события — `EventsView` | Needs redesign |
| Преподаватель: журнал, проверка работ, экзамены, материалы | `/gradebook/course/*`, `/submissions/*` | — | Missing |

## Профиль

| Функция | API | iOS | Статус |
|---|---|---|---|
| Шапка: обложка, аватар, ФИО, строка под именем, роль, курс, специальность, статус, о себе | `GET /users/me`, `/users/:id` | `ProfileView` | Implemented |
| Счётчики | `GET /profile/:id/counts`, `/friends/count` | Implemented | Implemented |
| Вкладки: посты, фото, видео, статьи, опросы | `/posts?authorId`, `/profile/:id/media`, `/profile/:id/articles`, `/polls/by-user/:id` | Implemented; голосование в опросе есть | Implemented |
| Сведения: контакты, учёба или работа, навыки, интересы | поля профиля | `ProfileDetailsView` | Implemented |
| Правка: аватар, обложка, ФИО, строка под именем, о себе, контакты, навыки, кабинет | `PATCH /users/me`, `/users/me/avatar`, `/users/me/cover` | `ProfileEditView` с учётом прав роли | Implemented |
| Отдельный «статус» | поля нет, ближайшее — `headline` | строка под именем | Blocked by API |
| Чужой профиль: «Написать», дружба | `POST /chats`, `/friends/*` | Implemented | Implemented |
| Закрытый профиль | `access: limited` | «Профиль закрыт» | Implemented |
| Друзья: список | `GET /friends` | только входящие заявки на главной | Missing |
| Загрузка фото и видео в профиль, альбомы | `/profile/media`, `/profile/albums` | — | Missing |
| Студенческий билет | `GET /student-id/me` | — | Missing |
| Логин (username) | `PATCH /users/me/username` | метод в `AccountAPI`, экрана нет | Missing |

## Настройки

| Функция | API | iOS | Статус |
|---|---|---|---|
| Личные данные | `PATCH /users/me` | `ProfileEditView` | Implemented |
| Пароль (выход на всех устройствах) | `PATCH /users/me/password` | `SecuritySettingsView` | Implemented |
| 2FA: включение по QR и ключу, резервные коды, отключение | `/auth/2fa/*` | Implemented | Implemented |
| Список сессий, завершить сессию | маршрута нет (и в вебе нет) | — | Blocked by API |
| Уведомления: каналы и 6 тем | `GET`, `PATCH /notifications/settings` | `NotificationSettingsView` | Implemented |
| Конфиденциальность: кто видит профиль, почта, телефон | `PATCH /users/me` | `PrivacySettingsView` | Implemented |
| Выгрузка персональных данных | `GET /me/export` | лист «Поделиться» с JSON | Implemented |
| Тема оформления | на сервере нет | на устройстве (`@AppStorage`), применяется к корню | Implemented |
| Язык | `locale` в `PATCH /users/me` | язык интерфейса — в настройках iOS; язык писем и пушей на сервере не меняется | Needs redesign |
| Вход на другом устройстве по QR | `/auth/qr/*` | Implemented | Implemented |
| Поддержка | `POST /support` | `SupportView` | Implemented |
| Удаление аккаунта (с проверкой долгов) | `GET /users/me/deletion-check`, `DELETE /users/me` | `DeleteAccountView` | Implemented |
| Привязка Telegram mini-app | `/mini/link-code` | — | Missing |

## Сервисы

| Функция | API | iOS | Статус |
|---|---|---|---|
| Каталог сервисов с группами, поиском и составом по роли | — | `ServicesView` | Implemented |
| Деканат: запись, мои записи, отмена | `/deanery-appointments` | `DeaneryView` | Implemented |
| Консультации: преподаватели, окна, запись, отмена | `/consultations/*` | `ConsultationsView` | Implemented |
| Консультации преподавателя: открыть и снять окно | `POST`, `DELETE /consultations/slots` | Implemented | Implemented |
| Карта кампуса: кампус, корпус, этаж, поиск, план, сведения о помещении | `/campus`, `/campus/:id/published`, `.../floors/:id`, `/campus/search` | `CampusMapView`, `FloorPlanCanvas` | Implemented |
| Маршрут по кампусу | граф есть (`/published/nav`), путь веб ищет у себя | — | Missing |
| 3D-вид кампуса | three.js в вебе | — | Missing |
| Заявки: каталог, черновик, отправка, отмена | `/application-categories`, `/applications` | `ApplicationsView`, `ApplicationFormView` | Implemented |
| Документы к заявке, файлы результата | `/applications/:id/documents`, `/results/:id/url` | — | Missing |
| Документы: просмотр и скачивание | `GET /documents`, `.../files/:id/url` | `DocumentsView` | Implemented |
| Документы: загрузка, доступ, запросы документов | `/documents/upload`, `/document-requests` | — | Missing |
| Библиотека: каталог, бронь, мои книги, справка | `/library/*` | Implemented | Implemented |
| Портфолио: записи по видам, добавление, удаление | `/portfolio` | `PortfolioView` | Implemented |
| Правка и порядок записей портфолио | `PATCH /portfolio/:id`, `PUT /portfolio/order` | — | Missing |
| События: список, запись | `/events` | `EventsView` | Implemented |
| События: создание, комментарии, онлайн-встреча | `POST /events`, `/events/:id/comments`, `/meeting` | — | Missing |
| Одногруппники (староста), группы преподавателя | `GET /groups/:id/members`, `GET /courses?mine` | `ClassmatesView`, `TeacherGroupsView` | Implemented |
| Староста: приглашения, сбор документов группы | `/invites`, `/document-requests/group-progress` | — | Missing |
| Карьера: вакансии, резюме, отклики | `/career/*` | — | Missing |
| Отключение разделов платформой | `GET /platform/state` (`disabledSections`) | не учитывается | Missing |
