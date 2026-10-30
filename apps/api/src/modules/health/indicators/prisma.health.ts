import { Injectable, Logger } from '@nestjs/common'
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'
import { PrismaService } from '../../../common/prisma/prisma.service'
import { probe } from './probe'

@Injectable()
export class PrismaHealthIndicator {
  private readonly logger = new Logger(PrismaHealthIndicator.name)

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  isHealthy(key: string): Promise<HealthIndicatorResult> {
    return probe(
      this.healthIndicatorService,
      key,
      this.logger,
      () => this.prisma.$queryRaw`SELECT 1`,
    )
  }
}
