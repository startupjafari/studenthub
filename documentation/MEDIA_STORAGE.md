# Настройка хранилища медиа файлов

## Обзор

StudentHub поддерживает хранение медиа файлов (изображения, видео, документы) через AWS S3. Система автоматически оптимизирует изображения и сохраняет метаданные в базе данных.

## Вариант 1: AWS S3 (Рекомендуется для production)

### Требования

- AWS аккаунт
- S3 bucket
- IAM пользователь с правами доступа к S3

### Настройка AWS S3

#### 1. Создание S3 Bucket

1. Войдите в AWS Console
2. Перейдите в S3
3. Создайте новый bucket:
   - Имя: `studenthub-media` (или другое уникальное имя)
   - Регион: выберите ближайший регион
   - Блокировка публичного доступа: отключите (если нужен публичный доступ)
   - Версионирование: опционально
   - Шифрование: рекомендуется включить

#### 2. Настройка CORS

В настройках bucket добавьте CORS конфигурацию:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

#### 3. Создание IAM пользователя

1. Перейдите в IAM → Users → Add user
2. Имя пользователя: `studenthub-s3-user`
3. Тип доступа: Programmatic access
4. Прикрепите политику (Policy):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::studenthub-media",
        "arn:aws:s3:::studenthub-media/*"
      ]
    }
  ]
}
```

5. Сохраните Access Key ID и Secret Access Key

#### 4. Настройка Bucket Policy (для публичного доступа)

Если нужен публичный доступ к файлам, добавьте Bucket Policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::studenthub-media/*"
    }
  ]
}
```

### Настройка переменных окружения

Добавьте в файл `.env`:

```env
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=studenthub-media
```

### Структура папок в S3

Файлы автоматически сохраняются в следующие папки:

- `images/` - Изображения (автоматически оптимизируются в WebP)
- `videos/` - Видео файлы
- `audio/` - Аудио файлы
- `documents/` - Документы (PDF, DOC, DOCX)
- `files/` - Прочие файлы

## Вариант 2: Локальное хранилище (Для разработки)

Если нужно использовать локальное хранилище вместо S3, можно модифицировать `FileUploadService`.

### Создание локальной версии

Создайте файл `src/common/services/local-file-upload.service.ts`:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LocalFileUploadService {
  private uploadDir: string;

  constructor(private configService: ConfigService) {
    this.uploadDir = path.join(process.cwd(), 'uploads');
    // Создать директорию если не существует
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${uuidv4()}.${fileExtension}`;
    const folderPath = path.join(this.uploadDir, folder);
    const filePath = path.join(folderPath, fileName);

    // Создать папку если не существует
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    // Сохранить файл
    fs.writeFileSync(filePath, file.buffer);

    // Вернуть относительный URL
    const baseUrl = this.configService.get<string>('APP_URL') || 'http://localhost:3000';
    return `${baseUrl}/uploads/${folder}/${fileName}`;
  }

  async deleteFile(url: string): Promise<void> {
    try {
      const relativePath = url.replace(/^.*\/uploads\//, '');
      const filePath = path.join(this.uploadDir, relativePath);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error(`Failed to delete file: ${error.message}`);
    }
  }

  async processImage(
    file: Express.Multer.File,
    options: { width?: number; height?: number; quality?: number; format?: string } = {},
  ): Promise<Buffer> {
    const {
      width = 500,
      height = 500,
      quality = 80,
      format = 'webp',
    } = options;

    try {
      let image = sharp(file.buffer);
      image = image.resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true,
      });

      switch (format) {
        case 'jpeg':
          image = image.jpeg({ quality });
          break;
        case 'png':
          image = image.png({ quality });
          break;
        case 'webp':
          image = image.webp({ quality });
          break;
      }

      return await image.toBuffer();
    } catch (error) {
      throw new BadRequestException(`Failed to process image: ${error.message}`);
    }
  }

  validateFileType(file: Express.Multer.File, allowedTypes: string[]): boolean {
    return allowedTypes.includes(file.mimetype);
  }

  validateFileSize(file: Express.Multer.File, maxSize: number): boolean {
    return file.size <= maxSize;
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    // Для локального хранилища просто возвращаем URL
    return key;
  }
}
```

### Настройка статических файлов

В `main.ts` добавьте:

```typescript
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // Настройка статических файлов
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads',
  });
  
  // ... остальной код
}
```

### Обновление MediaModule

В `src/modules/media/media.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { FileUploadService } from '../../common/services/file-upload.service';
// Или для локального хранилища:
// import { LocalFileUploadService } from '../../common/services/local-file-upload.service';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    FileUploadService, // или LocalFileUploadService
  ],
})
export class MediaModule {}
```

## Использование API

### Загрузка файла

**POST /api/media/upload**

Headers:
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

Body (form-data):
- `file`: файл для загрузки
- `type`: тип медиа (IMAGE, VIDEO, AUDIO, DOCUMENT, FILE)

Пример ответа:
```json
{
  "id": "media_id",
  "url": "https://studenthub-media.s3.amazonaws.com/images/uuid.webp",
  "type": "IMAGE",
  "size": 123456,
  "mimeType": "image/webp",
  "uploadedAt": "2024-01-01T00:00:00.000Z"
}
```

### Получение файла

**GET /api/media/:id?expiresIn=3600**

Возвращает информацию о файле и signed URL для временного доступа.

### Удаление файла

**DELETE /api/media/:id**

Требует авторизации. Только владелец или администратор может удалить файл.

## Ограничения файлов

- **Изображения**: максимум 10MB, форматы: JPEG, PNG, WebP, GIF
- **Видео**: максимум 100MB, форматы: MP4, WebM, QuickTime
- **Аудио**: максимум 50MB, форматы: MPEG, WAV, OGG
- **Документы**: максимум 20MB, форматы: PDF, DOC, DOCX
- **Файлы**: максимум 50MB

## Оптимизация изображений

Все загруженные изображения автоматически:
- Конвертируются в WebP формат
- Оптимизируются до качества 85%
- Изменяются до максимального размера 1920x1920px с сохранением пропорций

## Безопасность

1. Все файлы валидируются по типу и размеру
2. Доступ к файлам контролируется через signed URLs
3. Только владелец или администратор может удалить файл
4. Рекомендуется использовать AWS S3 с правильными IAM политиками

## Мониторинг и обслуживание

### Просмотр файлов в S3

Используйте AWS Console для просмотра загруженных файлов.

### Очистка неиспользуемых файлов

Создайте cron job или scheduled task для удаления файлов, которые не связаны с постами, комментариями или сообщениями.

### Резервное копирование

Настройте автоматическое резервное копирование S3 bucket через AWS Backup или Lifecycle policies.

## Troubleshooting

### Ошибка "Access Denied"

- Проверьте AWS credentials в `.env`
- Убедитесь, что IAM пользователь имеет правильные права
- Проверьте Bucket Policy

### Ошибка "Bucket not found"

- Проверьте имя bucket в `AWS_S3_BUCKET`
- Убедитесь, что bucket существует в указанном регионе

### Файлы не загружаются

- Проверьте размер файла (не превышает лимит)
- Проверьте тип файла (разрешен ли формат)
- Проверьте CORS настройки bucket

### Медленная загрузка

- Используйте CloudFront CDN для ускорения доступа
- Оптимизируйте размер файлов перед загрузкой
- Используйте multipart upload для больших файлов





