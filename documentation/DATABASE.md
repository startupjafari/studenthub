# База данных - Документация

## Обзор

StudentHub использует PostgreSQL в качестве основной базы данных и Prisma ORM для работы с данными.

## Схема базы данных

### Основные модели

#### User

Основная модель пользователя.

Поля:
- `id` - Уникальный идентификатор (CUID)
- `email` - Email адрес (уникальный)
- `phoneNumber` - Номер телефона (опционально, уникальный)
- `passwordHash` - Хеш пароля
- `firstName` - Имя
- `lastName` - Фамилия
- `avatar` - URL аватара
- `bio` - Биография
- `birthDate` - Дата рождения
- `role` - Роль (STUDENT, TEACHER, UNIVERSITY_ADMIN, SUPER_ADMIN)
- `status` - Статус (ACTIVE, INACTIVE, SUSPENDED, DELETED)
- `emailVerified` - Email верифицирован
- `phoneVerified` - Телефон верифицирован
- `twoFactorEnabled` - Включена 2FA
- `twoFactorSecret` - Секрет для 2FA
- `universityId` - ID университета
- `createdAt` - Дата создания
- `updatedAt` - Дата обновления
- `deletedAt` - Дата удаления (soft delete)

Связи:
- Один User может иметь один Student профиль
- Один User может иметь один Teacher профиль
- Один User может иметь один UniversityAdmin профиль
- Много постов (Post)
- Много сообщений (Message)
- Много друзей (self-referencing many-to-many)

#### Student

Профиль студента.

Поля:
- `id` - Уникальный идентификатор
- `userId` - ID пользователя (уникальный)
- `studentId` - Студенческий билет (уникальный)
- `enrollmentDate` - Дата поступления
- `expectedGraduation` - Ожидаемая дата выпуска
- `academicStatus` - Статус (ACTIVE, INACTIVE, GRADUATED, EXPELLED, ON_LEAVE)
- `gpa` - Средний балл

#### Teacher

Профиль преподавателя.

Поля:
- `id` - Уникальный идентификатор
- `userId` - ID пользователя (уникальный)
- `employeeId` - ID сотрудника (уникальный)
- `department` - Кафедра
- `title` - Должность
- `hireDate` - Дата найма

#### University

Университет.

Поля:
- `id` - Уникальный идентификатор
- `name` - Название
- `code` - Код (уникальный)
- `address` - Адрес
- `website` - Веб-сайт
- `logo` - URL логотипа
- `description` - Описание

#### Post

Пост пользователя.

Поля:
- `id` - Уникальный идентификатор
- `authorId` - ID автора
- `content` - Текст поста
- `media` - Массив URL медиа файлов
- `visibility` - Видимость (PUBLIC, FRIENDS, PRIVATE)
- `createdAt` - Дата создания
- `updatedAt` - Дата обновления

Связи:
- Много комментариев (Comment)
- Много реакций (Reaction)

#### Comment

Комментарий к посту.

Поля:
- `id` - Уникальный идентификатор
- `postId` - ID поста
- `authorId` - ID автора
- `content` - Текст комментария
- `parentId` - ID родительского комментария (для вложенных)
- `createdAt` - Дата создания

#### Reaction

Реакция на пост или комментарий.

Поля:
- `id` - Уникальный идентификатор
- `userId` - ID пользователя
- `targetType` - Тип цели (POST, COMMENT)
- `targetId` - ID цели
- `type` - Тип реакции (LIKE, LOVE, HAHA, WOW, SAD, ANGRY)
- `createdAt` - Дата создания

#### Group

Учебная группа.

Поля:
- `id` - Уникальный идентификатор
- `name` - Название
- `description` - Описание
- `creatorId` - ID создателя
- `universityId` - ID университета
- `avatar` - URL аватара группы
- `createdAt` - Дата создания

Связи:
- Много участников (GroupMember)
- Много сообщений (GroupMessage)

#### GroupMember

Участник группы.

Поля:
- `id` - Уникальный идентификатор
- `groupId` - ID группы
- `userId` - ID пользователя
- `role` - Роль (MEMBER, ADMIN)
- `joinedAt` - Дата присоединения

#### Message

Приватное сообщение.

Поля:
- `id` - Уникальный идентификатор
- `conversationId` - ID беседы
- `senderId` - ID отправителя
- `content` - Текст сообщения
- `media` - Массив URL медиа файлов
- `readAt` - Дата прочтения
- `createdAt` - Дата создания

#### Conversation

Беседа между пользователями.

Поля:
- `id` - Уникальный идентификатор
- `participants` - Массив ID участников
- `lastMessageId` - ID последнего сообщения
- `lastMessageAt` - Дата последнего сообщения
- `createdAt` - Дата создания

#### Notification

Уведомление пользователя.

Поля:
- `id` - Уникальный идентификатор
- `userId` - ID пользователя
- `type` - Тип уведомления
- `title` - Заголовок
- `message` - Текст
- `data` - Дополнительные данные (JSON)
- `read` - Прочитано
- `createdAt` - Дата создания

#### Document

Документ пользователя.

Поля:
- `id` - Уникальный идентификатор
- `userId` - ID пользователя
- `title` - Название
- `fileUrl` - URL файла
- `type` - Тип документа
- `status` - Статус верификации
- `verifiedBy` - ID верификатора
- `verifiedAt` - Дата верификации
- `createdAt` - Дата создания

#### Event

Событие университета или группы.

Поля:
- `id` - Уникальный идентификатор
- `title` - Название
- `description` - Описание
- `image` - URL изображения
- `universityId` - ID университета
- `groupId` - ID группы (опционально)
- `startDate` - Дата начала
- `endDate` - Дата окончания
- `location` - Место проведения
- `isOnline` - Онлайн событие
- `eventType` - Тип события
- `createdAt` - Дата создания

#### Story

История пользователя (24 часа).

Поля:
- `id` - Уникальный идентификатор
- `authorId` - ID автора
- `media` - URL медиа файла
- `expiresAt` - Дата истечения
- `createdAt` - Дата создания

## Индексы

Для оптимизации запросов созданы индексы на:

- User: `universityId`, `role`, `status`
- Post: `authorId`, `createdAt`
- Message: `conversationId`, `createdAt`
- GroupMember: `groupId`, `userId`
- Notification: `userId`, `read`, `createdAt`

## Миграции

Миграции Prisma находятся в `prisma/migrations/`.

### Создание миграции

```bash
npm run db:migrate
```

### Применение миграций в production

```bash
npm run db:migrate:prod
```

### Откат миграции

```bash
npx prisma migrate resolve --rolled-back <migration_name>
```

## Seed данные

Для заполнения базы тестовыми данными используйте:

```bash
npm run db:seed
```

## Prisma Studio

Визуальный редактор базы данных:

```bash
npm run db:studio
```

Откроется на http://localhost:5555

## Резервное копирование

### PostgreSQL

```bash
# Создать бэкап
pg_dump -U postgres studenthub > backup.sql

# Восстановить
psql -U postgres studenthub < backup.sql
```

### Через Docker

```bash
# Бэкап
docker compose exec postgres pg_dump -U postgres studenthub > backup.sql

# Восстановление
docker compose exec -T postgres psql -U postgres studenthub < backup.sql
```

## Производительность

### Рекомендации

1. Используйте индексы для часто запрашиваемых полей
2. Используйте пагинацию для больших списков
3. Используйте Redis для кэширования
4. Оптимизируйте запросы через Prisma (select только нужные поля)
5. Используйте DataLoader для решения проблемы N+1

### Мониторинг

Используйте Prisma Studio или pgAdmin для мониторинга производительности запросов.





