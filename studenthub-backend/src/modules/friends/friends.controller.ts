import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SendFriendRequestDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Friends')
@ApiBearerAuth()
@Controller('friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post('requests')
  @ApiOperation({ summary: 'Send friend request' })
  @ApiResponse({ status: 201, description: 'Friend request sent' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async sendFriendRequest(@CurrentUser() user: User, @Body() dto: SendFriendRequestDto) {
    return this.friendsService.sendFriendRequest(user.id, dto);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Get incoming friend requests' })
  @ApiResponse({ status: 200, description: 'Requests retrieved' })
  async getIncomingRequests(@CurrentUser() user: User) {
    return this.friendsService.getIncomingRequests(user.id);
  }

  @Get('requests/sent')
  @ApiOperation({ summary: 'Get sent friend requests' })
  @ApiResponse({ status: 200, description: 'Requests retrieved' })
  async getSentRequests(@CurrentUser() user: User) {
    return this.friendsService.getSentRequests(user.id);
  }

  @Patch('requests/:id/accept')
  @ApiOperation({
    summary: 'Accept friend request',
    description:
      'Accepts a friend request. Updates request status to ACCEPTED and creates bidirectional friendship.',
  })
  @ApiParam({ name: 'id', description: 'Friend request ID', type: String })
  @ApiResponse({ status: 200, description: 'Friend request accepted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only accept requests sent to you' })
  @ApiResponse({ status: 404, description: 'Friend request not found' })
  async acceptRequest(@Param('id') id: string, @CurrentUser() user: User) {
    return this.friendsService.acceptRequest(id, user.id);
  }

  @Patch('requests/:id/reject')
  @ApiOperation({
    summary: 'Reject friend request',
    description: 'Rejects a friend request. Updates request status to REJECTED.',
  })
  @ApiParam({ name: 'id', description: 'Friend request ID', type: String })
  @ApiResponse({ status: 200, description: 'Friend request rejected successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only reject requests sent to you' })
  @ApiResponse({ status: 404, description: 'Friend request not found' })
  async rejectRequest(@Param('id') id: string, @CurrentUser() user: User) {
    return this.friendsService.rejectRequest(id, user.id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Remove friend',
    description: 'Removes a user from your friends list. Deletes bidirectional friendship.',
  })
  @ApiParam({ name: 'id', description: 'Friend user ID', type: String })
  @ApiResponse({ status: 200, description: 'Friend removed successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Users are not friends' })
  async removeFriend(@Param('id') id: string, @CurrentUser() user: User) {
    return this.friendsService.removeFriend(id, user.id);
  }

  @Get('users/:id/friends')
  @ApiOperation({
    summary: "Get user's friends",
    description: "Returns list of user's friends with their profile information.",
  })
  @ApiParam({ name: 'id', description: 'User ID', type: String })
  @ApiResponse({ status: 200, description: 'Friends retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserFriends(@Param('id') id: string) {
    return this.friendsService.getUserFriends(id);
  }
}
