import {
  Controller,
  Get,
  Post,
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
  ApiQuery,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AssignTeacherDto,
  AdminSearchUsersDto,
  SearchTeachersDto,
  SearchStudentsDto,
} from './dto';
import { User } from '@prisma/client';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('UNIVERSITY_ADMIN')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users/search')
  @ApiOperation({
    summary: 'Search users for role assignment',
    description: 'Searches users in the same university for role assignment. Only accessible to university admins.',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Search by email or name' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiResponse({ status: 200, description: 'Users found successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only university admins can access this' })
  async searchUsers(
    @Query() dto: AdminSearchUsersDto,
    @CurrentUser() user: User,
  ) {
    return this.adminService.searchUsersForAssignment(dto, user.id);
  }

  @Post('users/:id/assign-teacher')
  @ApiOperation({
    summary: 'Assign teacher role to user',
    description: 'Assigns TEACHER role to a user. Creates Teacher record, updates User role, and removes Student record if exists.',
  })
  @ApiParam({ name: 'id', description: 'User ID', type: String })
  @ApiResponse({ status: 201, description: 'Teacher role assigned successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - User is already a teacher or employee ID exists' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only university admins can assign teachers' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async assignTeacher(
    @Param('id') userId: string,
    @Body() dto: AssignTeacherDto,
    @CurrentUser() user: User,
  ) {
    return this.adminService.assignTeacher(userId, dto, user.id);
  }

  @Delete('teachers/:id')
  @ApiOperation({
    summary: 'Remove teacher role',
    description: 'Removes TEACHER role from a user. Changes role back to STUDENT, deletes Teacher record, and creates Student record.',
  })
  @ApiParam({ name: 'id', description: 'Teacher ID', type: String })
  @ApiResponse({ status: 200, description: 'Teacher role removed successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only university admins can remove teachers' })
  @ApiResponse({ status: 404, description: 'Teacher not found' })
  async removeTeacher(
    @Param('id') teacherId: string,
    @CurrentUser() user: User,
  ) {
    return this.adminService.removeTeacher(teacherId, user.id);
  }

  @Get('teachers')
  @ApiOperation({
    summary: 'Get list of teachers',
    description: 'Returns paginated list of approved teachers in the university. Supports filtering by department and search.',
  })
  @ApiQuery({ name: 'search', required: false, description: 'Search query' })
  @ApiQuery({ name: 'department', required: false, description: 'Filter by department' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiResponse({ status: 200, description: 'Teachers retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only university admins can access this' })
  async getTeachers(
    @Query() dto: SearchTeachersDto,
    @CurrentUser() user: User,
  ) {
    return this.adminService.getTeachers(dto, user.id);
  }

  @Get('students')
  @ApiOperation({
    summary: 'Get list of students',
    description: 'Returns paginated list of students in the university. Supports filtering by academic status and search.',
  })
  @ApiQuery({ name: 'search', required: false, description: 'Search query' })
  @ApiQuery({ name: 'academicStatus', required: false, enum: ['ACTIVE', 'INACTIVE', 'GRADUATED', 'EXPELLED', 'ON_LEAVE'], description: 'Filter by academic status' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiResponse({ status: 200, description: 'Students retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only university admins can access this' })
  async getStudents(
    @Query() dto: SearchStudentsDto,
    @CurrentUser() user: User,
  ) {
    return this.adminService.getStudents(dto, user.id);
  }

  @Get('analytics')
  @ApiOperation({
    summary: 'Get university analytics',
    description: 'Returns statistics about the university: total students, teachers, groups, active students, and graduated students.',
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        totalStudents: { type: 'number' },
        totalTeachers: { type: 'number' },
        totalGroups: { type: 'number' },
        activeStudents: { type: 'number' },
        graduatedStudents: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Only university admins can access this' })
  async getAnalytics(@CurrentUser() user: User) {
    return this.adminService.getAnalytics(user.id);
  }
}

