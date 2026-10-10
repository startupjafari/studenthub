import { Controller, Get, Query, Req, Res } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import { DataExportService } from './data-export.service'

@ApiTags('Мои данные')
@ApiBearerAuth()
@Controller('me')
export class DataExportController {
  constructor(
    private readonly dataExport: DataExportService,
    private readonly branding: ExportBrandingService,
  ) {}

  @Get('export')
  // Два десятка запросов и файл на несколько мегабайт — это не та ручка, которую дёргают
  // в цикле. Три выгрузки в час с пользователя покрывают и повтор после сбоя скачивания,
  // и смену языка файла, но делают бессмысленной попытку греть ими базу.
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @ApiOperation({ summary: 'Скачать машинную выгрузку своих персональных данных (JSON)' })
  @ApiResponse({ status: 200, description: 'Файл выгрузки' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT — не чаще трёх раз в час' })
  async exportMine(
    @CurrentUser() user: CurrentUserData,
    @Query('locale') locale: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { body, filename } = await this.dataExport.exportPersonalData(
      user,
      this.branding.resolveLocale(locale),
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    )
    await reply
      .header('content-type', this.branding.contentType('json'))
      .header('content-disposition', this.branding.disposition(filename))
      .send(body)
  }
}
