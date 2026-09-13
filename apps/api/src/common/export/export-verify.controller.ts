import { Controller, Get, Param } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Public } from '../decorators/public.decorator'
import { AppException } from '../exceptions/app.exception'
import { ExportRegistryService } from './export-registry.service'

/**
 * Публичная проверка выданного документа по короткому коду из бланка.
 *
 * Единственный способ отличить настоящую справку от её подделки глазами: вёрстку
 * повторить легко, попасть в журнал выдач — нет. Для казахстанской ЭЦП это ещё важнее:
 * обычные читалки PDF ГОСТ-подпись проверить не умеют и показывают «подпись
 * недействительна», так что для человека с бумагой в руках эта страница — основной путь.
 *
 * Публичный по необходимости: справку предъявляют банку, работодателю, посольству — у них
 * нет аккаунта в StudentHub. Отсюда два ограничения: лимит запросов (код короткий и
 * подбираем) и скупая выдача (см. `findByShortId`).
 */
@ApiTags('Проверка документов')
@Controller('verify')
export class ExportVerifyController {
  constructor(private readonly exports: ExportRegistryService) {}

  @Get(':code')
  @Public()
  // Перебор восьмизначного кода из 31 символа бессмыслен и так, но лимит превращает его
  // из «бессмысленно» в «невозможно» и заодно бережёт базу.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Проверить документ по коду из бланка (публично)' })
  @ApiResponse({ status: 200, description: 'Документ найден: тип, номер, дата, статус' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — документа с таким кодом нет' })
  async verify(@Param('code') code: string) {
    const found = await this.exports.findByShortId(code.trim().toUpperCase())
    if (!found) {
      // Одинаковый ответ на «кода нет» и «код чужого вида выгрузки»: разница в сообщениях
      // подсказала бы перебирающему, что он на верном пути.
      throw new AppException('NOT_FOUND', 'Документ с таким кодом не найден')
    }
    return {
      code: found.shortId,
      kind: found.kind,
      number: found.documentNumber,
      issuer: found.issuerName,
      subject: found.subject,
      issuedAt: found.issuedAt,
      revokedAt: found.revokedAt,
      // Статус считаем на сервере: клиенту незачем знать правила, по которым документ
      // перестаёт быть действительным.
      status: found.revokedAt ? 'REVOKED' : 'VALID',
    }
  }
}
