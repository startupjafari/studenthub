import { Injectable, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readClient: PrismaClient | null = null;

  constructor(
    @Optional() private readonly configService?: ConfigService,
  ) {
    const writeUrl = configService?.get<string>('database.url');
    
    super({
      datasources: {
        db: {
          url: writeUrl,
        },
      },
      // Отключаем prepared statements для работы с PgBouncer в режиме transaction pooling
      // PgBouncer не поддерживает prepared statements в transaction pooling режиме
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    // Создаем отдельный клиент для чтения, если указан DATABASE_READ_URL
    const readUrl = configService?.get<string>('database.readUrl');
    
    if (readUrl && readUrl !== writeUrl) {
      this.readClient = new PrismaClient({
        datasources: {
          db: {
            url: readUrl,
          },
        },
      });
    }
  }

  async onModuleInit() {
    await this.$connect();
    if (this.readClient) {
      await this.readClient.$connect();
      console.log('✅ PrismaService: Connected to Master (write) and Replica (read)');
    } else {
      console.log('✅ PrismaService: Connected to Master (write/read)');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    if (this.readClient) {
      await this.readClient.$disconnect();
    }
  }

  /**
   * Получить клиент для чтения (replica)
   * Если replica не настроена, возвращает основной клиент
   */
  get read(): PrismaClient {
    return this.readClient || this;
  }

  /**
   * Получить клиент для записи (master)
   */
  get write(): PrismaClient {
    return this;
  }
}

