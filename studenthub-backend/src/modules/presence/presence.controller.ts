import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PresenceService } from './presence.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdatePresenceDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Presence')
@ApiBearerAuth()
@Controller('presence')
@UseGuards(JwtAuthGuard)
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user presence' })
  @ApiResponse({ status: 200, description: 'Presence retrieved' })
  async getPresence(@CurrentUser() user: User) {
    return this.presenceService.getPresence(user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Update user presence status' })
  @ApiResponse({ status: 200, description: 'Presence updated' })
  async updatePresence(
    @CurrentUser() user: User,
    @Body() dto: UpdatePresenceDto,
  ) {
    return this.presenceService.updatePresence(user.id, dto.status);
  }

  @Get('users/:userIds')
  @ApiOperation({ summary: 'Get multiple users presence' })
  @ApiResponse({ status: 200, description: 'Presences retrieved' })
  async getMultiplePresence(@Param('userIds') userIds: string) {
    const ids = userIds.split(',');
    return this.presenceService.getMultiplePresence(ids);
  }
}




