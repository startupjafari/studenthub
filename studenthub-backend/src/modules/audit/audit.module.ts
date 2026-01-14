import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { PrismaService } from '../../common/services/prisma.service';
import { RedisModule } from '../../common/modules/redis.module';

@Global()
@Module({
  imports: [RedisModule],
  providers: [AuditService, AuditInterceptor, PrismaService],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}





