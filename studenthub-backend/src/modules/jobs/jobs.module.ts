import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { StoriesCleanupService } from './services/stories-cleanup.service';
import { PrismaService } from '../../common/services/prisma.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [StoriesCleanupService, PrismaService],
})
export class JobsModule {}





