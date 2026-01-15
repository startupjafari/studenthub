import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateEventDto, GetEventsDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create event (ADMIN or TEACHER)',
    description:
      'Creates a new university or group event. Only university admins and teachers can create events.',
  })
  @ApiResponse({ status: 201, description: 'Event created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - End date must be after start date' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Only admins and teachers can create events',
  })
  async createEvent(@CurrentUser() user: User, @Body() dto: CreateEventDto) {
    return this.eventsService.createEvent(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get events (future only)',
    description:
      'Returns paginated list of future events. Supports filtering by university, group, and event type.',
  })
  @ApiQuery({
    name: 'universityId',
    required: false,
    type: String,
    description: 'Filter by university ID',
  })
  @ApiQuery({ name: 'groupId', required: false, type: String, description: 'Filter by group ID' })
  @ApiQuery({
    name: 'eventType',
    required: false,
    enum: ['LECTURE', 'SEMINAR', 'WORKSHOP', 'CONFERENCE', 'ANNOUNCEMENT', 'DEADLINE', 'OTHER'],
    description: 'Filter by event type',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiResponse({ status: 200, description: 'Events retrieved successfully' })
  async getEvents(@Query() dto: GetEventsDto) {
    return this.eventsService.getEvents(dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get event by ID',
    description: 'Returns event details including university and group information.',
  })
  @ApiParam({ name: 'id', description: 'Event ID', type: String })
  @ApiResponse({ status: 200, description: 'Event retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async getEventById(@Param('id') id: string) {
    return this.eventsService.getEventById(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update event (only creator)',
    description: 'Updates event details. Only university admins can update events.',
  })
  @ApiParam({ name: 'id', description: 'Event ID', type: String })
  @ApiResponse({ status: 200, description: 'Event updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only university admins can update events' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async updateEvent(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: Partial<CreateEventDto>,
  ) {
    return this.eventsService.updateEvent(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete event (only creator)',
    description: 'Deletes an event. Only university admins can delete events.',
  })
  @ApiParam({ name: 'id', description: 'Event ID', type: String })
  @ApiResponse({ status: 200, description: 'Event deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only university admins can delete events' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async deleteEvent(@Param('id') id: string, @CurrentUser() user: User) {
    return this.eventsService.deleteEvent(id, user.id);
  }
}
