import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Настройка приложения для тестов
 * Применяет те же настройки, что и в main.ts
 */
export function setupTestApp(app: INestApplication): void {
  // Устанавливаем глобальный префикс (как в main.ts)
  app.setGlobalPrefix('api');

  // Настраиваем глобальный ValidationPipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Можно также добавить CORS, если нужно
  // app.enableCors({
  //   origin: '*',
  //   credentials: true,
  // });
}

