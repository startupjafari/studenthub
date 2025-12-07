import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  // CORS origins - support multiple frontend URLs
  const allowedOrigins = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((url) => url.trim())
    : ['http://localhost:4000', 'http://localhost:3001'];

  const app = await NestFactory.create(AppModule);

  // CORS - must be configured before Helmet
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      // Security: Never allow wildcard in production
      if (allowedOrigins.includes('*')) {
        if (process.env.NODE_ENV === 'production') {
          callback(new Error('Wildcard CORS not allowed in production'));
          return;
        }
        // Only allow wildcard in development
        callback(null, true);
        return;
      }
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    exposedHeaders: ['Authorization'],
  });

  // Cookie parser for CSRF tokens
  app.use(cookieParser());

  // Security - Helmet configured to work with CORS
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // WebSocket adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  // Global prefix
  app.setGlobalPrefix('api');

  // Global validation pipe
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

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('StudentHub API')
    .setDescription(
      'StudentHub - Educational Platform API Documentation\n\n' +
        'Complete REST API for managing students, teachers, universities, groups, posts, messages, and more.\n\n' +
        '**Authentication:** Most endpoints require JWT Bearer token. Use `/api/auth/login` to get your token.',
    )
    .setVersion('1.0')
    .setContact('StudentHub Team', 'https://studenthub.com', 'support@studenthub.com')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token (get it from /api/auth/login)',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Health', 'Health check endpoints')
    .addTag('Authentication', 'User authentication and authorization')
    .addTag('Users', 'User profiles, search, and management')
    .addTag('Admin', 'University administration (UNIVERSITY_ADMIN only)')
    .addTag('Universities', 'University management (SUPER_ADMIN for creation)')
    .addTag('Media', 'File upload and media management')
    .addTag('Posts', 'Social posts and feed')
    .addTag('Comments', 'Post comments')
    .addTag('Reactions', 'Post and comment reactions')
    .addTag('Stories', '24-hour stories')
    .addTag('Friends', 'Friend requests and management')
    .addTag('Groups', 'Study groups management')
    .addTag('Group Messages', 'Group chat messages')
    .addTag('Documents', 'Document upload and verification')
    .addTag('Events', 'University and group events')
    .addTag('Conversations', 'Private conversations')
    .addTag('Messages', 'Private messages')
    .addTag('Notifications', 'User notifications')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  
  // Security: Disable Swagger in production or protect it
  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`📚 Swagger documentation: http://localhost:${port}/api/docs`);
}

bootstrap();

