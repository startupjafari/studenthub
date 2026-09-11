import { Global, Module } from '@nestjs/common'
import { ExportBrandingService } from './export-branding.service'
import { ExportRegistryService } from './export-registry.service'
import { ExportVerifyController } from './export-verify.controller'

/**
 * Брендирование выгружаемых файлов. Глобальный — как PrismaModule и AuditModule: сервис
 * нужен любому модулю, который что-то отдаёт файлом (career, users, chats), и тащить
 * импорт в каждый значило бы повторять инфраструктурную связь двадцать раз.
 */
@Global()
@Module({
  controllers: [ExportVerifyController],
  providers: [ExportBrandingService, ExportRegistryService],
  exports: [ExportBrandingService, ExportRegistryService],
})
export class ExportBrandingModule {}
