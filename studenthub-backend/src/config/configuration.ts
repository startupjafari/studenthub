export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  database: {
    url: process.env.DATABASE_URL,
    readUrl: process.env.DATABASE_READ_URL || process.env.DATABASE_URL, // Fallback to write URL if not set
  },

  // JWT
  jwt: {
    secret:
      process.env.JWT_SECRET ||
      (() => {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('JWT_SECRET is required in production');
        }
        return 'dev-secret-key-change-in-production';
      })(),
    expiration: process.env.JWT_EXPIRATION || '15m',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ||
      (() => {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('JWT_REFRESH_SECRET is required in production');
        }
        return 'dev-refresh-secret-key-change-in-production';
      })(),
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
  },

  // Email
  email: {
    sendGridApiKey: process.env.SENDGRID_API_KEY,
    fromEmail:
      process.env.SMTP_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'noreply@studenthub.com',
    // Universal SMTP configuration (supports Gmail, Mail.ru, Yandex, etc.)
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
    },
  },

  // Frontend
  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:4000',
  },

  // App
  app: {
    name: process.env.APP_NAME || 'StudentHub',
  },

  // AWS S3
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1',
    s3Bucket: process.env.AWS_S3_BUCKET || 'studenthub-media',
  },
});
