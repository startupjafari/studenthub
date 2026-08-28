import { Global, Logger, Module, type DynamicModule, type Provider } from '@nestjs/common'
import { OPS_NOTIFIER } from '../../common/monitoring'
import { ApplicationServicesModule } from '../application-services/application-services.module'
import { CleanupModule } from '../cleanup/cleanup.module'
import { ComplaintsModule } from '../complaints/complaints.module'
import { FilesModule } from '../files/files.module'
import { HealthModule } from '../health/health.module'
import { InvitesModule } from '../invites/invites.module'
import { UsersModule } from '../users/users.module'
import { BranchDriftCheck } from './checks/branch-drift.check'
import { CronSilenceCheck } from './checks/cron-silence.check'
import { DigestCheck } from './checks/digest.check'
import { DependenciesCheck } from './checks/dependencies.check'
import { MigrationsCheck } from './checks/migrations.check'
import { PinnedStatusCheck } from './checks/pinned-status.check'
import { PublicPingCheck } from './checks/public-ping.check'
import { QueuesCheck } from './checks/queues.check'
import { SecurityCheck } from './checks/security.check'
import { DeployTrackerService } from './deploy-tracker.service'
import { GithubApiService } from './github-api.service'
import { NoopOpsNotifier } from './noop-ops.notifier'
import { OpsCommandService } from './ops-command.service'
import { OpsHooksController } from './ops-hooks.controller'
import { OpsMessageBuilder } from './ops-message.builder'
import { OpsNotifyProcessor } from './ops-notify.processor'
import { OpsPolicyService } from './ops-policy.service'
import { OpsScheduleService } from './ops-schedule.service'
import { OpsStatusService } from './ops-status.service'
import { TelegramOpsNotifier } from './telegram-ops.notifier'
import { TelegramOpsService } from './telegram-ops.service'

// Служебный Telegram-канал (docs/TELEGRAM_BOT.md §4).
//
// Модуль глобальный: порт `OpsNotifier` нужен доменным модулям (cron-монитор, health,
// процессоры очередей) без повторного импорта — тем же приёмом, что PushModule.
//
// Выключается одной переменной (§7.3.5): нет TELEGRAM_BOT_TOKEN — в контейнер не попадают
// ни воркер очереди, ни клиент Telegram, ни политика с её обращениями к Redis. Порт при
// этом остаётся: доменный код зависит от интерфейса всегда и не знает, настроен ли бот.
//
// Токен читается из `process.env`, а не из ConfigService: состав провайдеров решается на
// этапе сборки графа модулей, когда ConfigService ещё не существует. Тот же приём, что в
// `src/instrument.ts`; значения при этом всё равно провалидированы схемой env на старте.

@Global()
@Module({})
export class OpsNotifyModule {
  static register(): DynamicModule {
    const enabled = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim())
    const logger = new Logger('OpsNotify')

    if (!enabled) {
      logger.log('Telegram ops выключен: не задан TELEGRAM_BOT_TOKEN')
      const noop: Provider = { provide: OPS_NOTIFIER, useClass: NoopOpsNotifier }
      return { module: OpsNotifyModule, providers: [noop], exports: [OPS_NOTIFIER] }
    }

    return {
      module: OpsNotifyModule,
      // Импортируются ровно ради чисел суточной сводки и состояния зависимостей: каждое
      // число отдаёт владелец данных, а не читается из чужой таблицы (§7.3.6, §7.1.5).
      // PushService глобален, поэтому его модуля в списке нет.
      imports: [
        HealthModule,
        FilesModule,
        CleanupModule,
        ComplaintsModule,
        ApplicationServicesModule,
        InvitesModule,
        UsersModule,
      ],
      // Публичные маршруты приёма вебхуков (§5). Поднимаются только вместе с модулем:
      // без токена бота принимать события некуда, и открывать вход незачем.
      controllers: [OpsHooksController],
      providers: [
        TelegramOpsService,
        OpsMessageBuilder,
        OpsPolicyService,
        OpsStatusService,
        GithubApiService,
        DeployTrackerService,
        OpsCommandService,
        OpsNotifyProcessor,
        OpsScheduleService,
        MigrationsCheck,
        CronSilenceCheck,
        QueuesCheck,
        DependenciesCheck,
        PublicPingCheck,
        PinnedStatusCheck,
        SecurityCheck,
        DigestCheck,
        BranchDriftCheck,
        { provide: OPS_NOTIFIER, useClass: TelegramOpsNotifier },
      ],
      // Наружу торчит только порт. Транспорт, билдер и политика — внутреннее устройство
      // модуля: доменный код не должен уметь позвать `TelegramOpsService.send()` напрямую.
      exports: [OPS_NOTIFIER],
    }
  }
}
