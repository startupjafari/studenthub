import { Inject, Injectable } from '@nestjs/common'
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'
import type { Client as MinioClient } from 'minio'
import { MINIO_CLIENT } from '../../../common/minio/minio.module'

@Injectable()
export class MinioHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key)
    try {
      // listBuckets требует валидных креды и живого соединения — годится как проба.
      await this.minio.listBuckets()
      return indicator.up()
    } catch (error) {
      return indicator.down({ message: (error as Error).message })
    }
  }
}
