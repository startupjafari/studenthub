import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
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
import { UniversitiesService } from './universities.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateUniversityDto,
  UpdateUniversityDto,
  AssignAdminDto,
  SearchUniversitiesDto,
} from './dto';
import { User } from '@prisma/client';

@ApiTags('Universities')
@Controller('universities')
export class UniversitiesController {
  constructor(private readonly universitiesService: UniversitiesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create university (SUPER_ADMIN only)',
    description: 'Creates a new university. Only super admins can create universities.',
  })
  @ApiResponse({ status: 201, description: 'University created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - University with this name already exists' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only super admins can create universities' })
  async createUniversity(
    @Body() dto: CreateUniversityDto,
    @CurrentUser() user: User,
  ) {
    return this.universitiesService.createUniversity(dto, user.id);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Get list of universities (public)',
    description: 'Returns paginated list of universities. Supports filtering by country and city.',
  })
  @ApiQuery({ name: 'country', required: false, description: 'Filter by country' })
  @ApiQuery({ name: 'city', required: false, description: 'Filter by city' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiResponse({ status: 200, description: 'Universities retrieved successfully' })
  async getUniversities(@Query() dto: SearchUniversitiesDto) {
    return this.universitiesService.getUniversities(dto);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Get university details (public)',
    description: 'Returns university details with statistics (total students, teachers, groups).',
  })
  @ApiParam({ name: 'id', description: 'University ID', type: String })
  @ApiResponse({ status: 200, description: 'University details retrieved successfully' })
  @ApiResponse({ status: 404, description: 'University not found' })
  async getUniversityById(@Param('id') id: string) {
    return this.universitiesService.getUniversityById(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update university (SUPER_ADMIN only)',
    description: 'Updates university details (name, country, city, address). Only super admins can update universities.',
  })
  @ApiParam({ name: 'id', description: 'University ID', type: String })
  @ApiResponse({ status: 200, description: 'University updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only super admins can update universities' })
  @ApiResponse({ status: 404, description: 'University not found' })
  async updateUniversity(
    @Param('id') id: string,
    @Body() dto: UpdateUniversityDto,
    @CurrentUser() user: User,
  ) {
    return this.universitiesService.updateUniversity(id, dto, user.id);
  }

  @Post(':id/admins')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Assign admin to university (SUPER_ADMIN only)',
    description: 'Assigns UNIVERSITY_ADMIN role to a user for a specific university. Creates UniversityAdmin record and updates User role.',
  })
  @ApiParam({ name: 'id', description: 'University ID', type: String })
  @ApiResponse({ status: 201, description: 'Admin assigned successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - User is already an admin of this university' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only super admins can assign university admins' })
  @ApiResponse({ status: 404, description: 'University or user not found' })
  async assignAdmin(
    @Param('id') universityId: string,
    @Body() dto: AssignAdminDto,
    @CurrentUser() user: User,
  ) {
    return this.universitiesService.assignAdmin(universityId, dto, user.id);
  }
}

