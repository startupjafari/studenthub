import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
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
import { GroupsService } from './groups.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GroupMemberGuard } from '../../common/guards/group-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateGroupDto,
  UpdateGroupDto,
  AddMemberDto,
  UpdateMemberRoleDto,
  GetMembersDto,
} from './dto';
import { User } from '@prisma/client';

@ApiTags('Groups')
@ApiBearerAuth()
@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  @ApiOperation({ summary: 'Create group (only TEACHER)' })
  @ApiResponse({ status: 201, description: 'Group created' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async createGroup(
    @CurrentUser() user: User,
    @Body() dto: CreateGroupDto,
  ) {
    return this.groupsService.createGroup(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get my groups' })
  @ApiResponse({ status: 200, description: 'Groups retrieved' })
  async getMyGroups(@CurrentUser() user: User) {
    return this.groupsService.getMyGroups(user.id);
  }

  @Get(':id')
  @UseGuards(GroupMemberGuard)
  @ApiOperation({
    summary: 'Get group details (only members)',
    description: 'Returns group details including members, teachers, and statistics. Only accessible to group members.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', type: String })
  @ApiResponse({ status: 200, description: 'Group retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You are not a member of this group' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async getGroupById(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.groupsService.getGroupById(id, user.id);
  }

  @Put(':id')
  @UseGuards(GroupMemberGuard)
  @ApiOperation({
    summary: 'Update group (only ADMIN)',
    description: 'Updates group name and description. Only group admins can update group details.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', type: String })
  @ApiResponse({ status: 200, description: 'Group updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only group admins can update the group' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async updateGroup(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.updateGroup(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete group (only creator)',
    description: 'Permanently deletes a group. Only the group creator can delete the group.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', type: String })
  @ApiResponse({ status: 200, description: 'Group deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only the creator can delete the group' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async deleteGroup(@Param('id') id: string, @CurrentUser() user: User) {
    return this.groupsService.deleteGroup(id, user.id);
  }

  @Post(':id/members')
  @UseGuards(GroupMemberGuard)
  @ApiOperation({
    summary: 'Add member to group (only ADMIN/TEACHER)',
    description: 'Adds a user to the group. Only group admins, moderators, and teachers can add members.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', type: String })
  @ApiResponse({ status: 201, description: 'Member added successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - User is already a member' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only admins, moderators, and teachers can add members' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async addMember(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: AddMemberDto,
  ) {
    return this.groupsService.addMember(id, user.id, dto);
  }

  @Get(':id/members')
  @UseGuards(GroupMemberGuard)
  @ApiOperation({
    summary: 'Get group members',
    description: 'Returns paginated list of group members with their roles.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', type: String })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiResponse({ status: 200, description: 'Members retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You are not a member of this group' })
  async getMembers(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Query() dto: GetMembersDto,
  ) {
    return this.groupsService.getMembers(id, user.id, dto);
  }

  @Delete(':id/members/:userId')
  @UseGuards(GroupMemberGuard)
  @ApiOperation({
    summary: 'Remove member from group (only ADMIN)',
    description: 'Removes a member from the group. Only group admins can remove members.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', type: String })
  @ApiParam({ name: 'userId', description: 'User ID to remove', type: String })
  @ApiResponse({ status: 200, description: 'Member removed successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only group admins can remove members' })
  @ApiResponse({ status: 404, description: 'Member not found' })
  async removeMember(
    @Param('id') id: string,
    @Param('userId') memberUserId: string,
    @CurrentUser() user: User,
  ) {
    return this.groupsService.removeMember(id, memberUserId, user.id);
  }

  @Patch(':id/members/:userId/role')
  @UseGuards(GroupMemberGuard)
  @ApiOperation({
    summary: 'Update member role (only ADMIN)',
    description: 'Updates a member\'s role in the group (ADMIN, MODERATOR, MEMBER). Only group admins can update roles.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', type: String })
  @ApiParam({ name: 'userId', description: 'User ID', type: String })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only group admins can update member roles' })
  @ApiResponse({ status: 404, description: 'Member not found' })
  async updateMemberRole(
    @Param('id') id: string,
    @Param('userId') memberUserId: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.groupsService.updateMemberRole(id, memberUserId, user.id, dto);
  }
}

