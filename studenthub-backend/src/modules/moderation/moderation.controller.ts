import { Controller, Get, Post, Put, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ModerationService } from './moderation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateReportDto, GetReportsDto, ModerateReportDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Moderation')
@ApiBearerAuth()
@Controller('moderation')
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post('reports')
  @ApiOperation({ summary: 'Create a content report' })
  @ApiResponse({ status: 201, description: 'Report created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async createReport(@CurrentUser() user: User, @Body() dto: CreateReportDto) {
    return this.moderationService.createReport(user.id, dto);
  }

  @Get('reports')
  @ApiOperation({ summary: 'Get reports (moderators only)' })
  @ApiResponse({ status: 200, description: 'Reports retrieved' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'UNIVERSITY_ADMIN')
  async getReports(@CurrentUser() user: User, @Query() dto: GetReportsDto) {
    return this.moderationService.getReports(dto, user.id);
  }

  @Get('reports/my')
  @ApiOperation({ summary: "Get user's own reports" })
  @ApiResponse({ status: 200, description: 'Reports retrieved' })
  async getUserReports(@CurrentUser() user: User, @Query() dto: GetReportsDto) {
    return this.moderationService.getUserReports(user.id, dto);
  }

  @Put('reports/:id/moderate')
  @ApiOperation({ summary: 'Moderate a report (moderators only)' })
  @ApiParam({ name: 'id', description: 'Report ID' })
  @ApiResponse({ status: 200, description: 'Report moderated' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'UNIVERSITY_ADMIN')
  async moderateReport(
    @Param('id') reportId: string,
    @CurrentUser() user: User,
    @Body() dto: ModerateReportDto,
  ) {
    return this.moderationService.moderateReport(reportId, dto, user.id);
  }
}
