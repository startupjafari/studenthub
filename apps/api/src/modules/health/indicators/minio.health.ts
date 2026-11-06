import { Inject, Injectable, Logger } from '@nestjs/common'
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'
import type { Client as MinioClient } from 'minio'
import { MINIO_CLIENT } from '../../../common/minio/minio.module'
import { probe } from './probe'

@Injectable()
export class MinioHealthIndicator {
  private readonly logger = new Logger(MinioHealthIndicator.name)

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
  ) {}

  // listBuckets требует валидных креды и живого соединения — годится как проба.
  isHealthy(key: string): Promise<HealthIndicatorResult> {
    return probe(this.healthIndicatorService, key, this.logger, () => this.minio.listBuckets())
  }
}
