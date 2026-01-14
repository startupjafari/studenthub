import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SchedulesService } from './schedules.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  GetSchedulesDto,
} from './dto';
import { User } from '@prisma/client';

@ApiTags('Schedules')
@ApiBearerAuth()
@Controller('schedules')
@UseGuards(JwtAuthGuard)
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new schedule for a group' })
  @ApiResponse({ status: 201, description: 'Schedule created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async createSchedule(
    @CurrentUser() user: User,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.schedulesService.createSchedule(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get schedules' })
  @ApiResponse({ status: 200, description: 'Schedules retrieved' })
  async getSchedules(
    @CurrentUser() user: User,
    @Query() dto: GetSchedulesDto,
  ) {
    return this.schedulesService.getSchedules(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get schedule by ID' })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({ status: 200, description: 'Schedule retrieved' })
  @ApiResponse({ status: 404, description: 'Schedule not found' })
  async getScheduleById(
    @Param('id') scheduleId: string,
    @CurrentUser() user: User,
  ) {
    return this.schedulesService.getScheduleById(scheduleId, user.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update schedule' })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({ status: 200, description: 'Schedule updated' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async updateSchedule(
    @Param('id') scheduleId: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.schedulesService.updateSchedule(scheduleId, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete schedule' })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({ status: 200, description: 'Schedule deleted' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async deleteSchedule(
    @Param('id') scheduleId: string,
    @CurrentUser() user: User,
  ) {
    return this.schedulesService.deleteSchedule(scheduleId, user.id);
  }
}




