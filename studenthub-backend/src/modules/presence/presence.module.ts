import { Module } from '@nestjs/common';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';
import { PrismaService } from '../../common/services/prisma.service';

@Module({
  controllers: [PresenceController],
  providers: [PresenceService, PrismaService],
  exports: [PresenceService],
})
export class PresenceModule {}
