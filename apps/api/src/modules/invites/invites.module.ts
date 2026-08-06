import { Module } from '@nestjs/common'
import { InviteService } from './invites.service'
import { InvitesController } from './invites.controller'

@Module({
  controllers: [InvitesController],
  providers: [InviteService],
  exports: [InviteService],
})
export class InvitesModule {}
