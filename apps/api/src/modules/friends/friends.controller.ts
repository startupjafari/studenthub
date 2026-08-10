import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { FriendsService } from './friends.service'
import { SendFriendRequestDto } from './dto/send-friend-request.dto'
import { FriendsListQueryDto } from './dto/friends-list-query.dto'
import { FriendRequestsQueryDto } from './dto/friend-requests-query.dto'

// Друзья (Social-зона) — доступно всем авторизованным ролям (без @Roles).
@ApiTags('Друзья')
@ApiBearerAuth()
@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  @ApiOperation({ summary: 'Список друзей (принятые), cursor-пагинация' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: FriendsListQueryDto) {
    return this.friends.listFriends(user, query)
  }

  @Get('requests')
  @ApiOperation({ summary: 'Заявки в друзья: incoming (мне) или outgoing (мои)' })
  requests(@CurrentUser() user: CurrentUserData, @Query() query: FriendRequestsQueryDto) {
    return this.friends.listRequests(user, query)
  }

  @Get('count')
  @ApiOperation({ summary: 'Счётчики: друзей всего + входящих заявок' })
  count(@CurrentUser() user: CurrentUserData) {
    return this.friends.counts(user)
  }

  @Get('status/:userId')
  @ApiOperation({ summary: 'Статус дружбы с пользователем (для кнопки в профиле)' })
  status(@CurrentUser() user: CurrentUserData, @Param('userId') userId: string) {
    return this.friends.statusFor(user.sub, userId)
  }

  @Post('requests')
  @ApiOperation({ summary: 'Отправить заявку в друзья (или принять встречную)' })
  sendRequest(@CurrentUser() user: CurrentUserData, @Body() dto: SendFriendRequestDto) {
    return this.friends.sendRequest(user, dto.userId)
  }

  @Post('requests/:id/accept')
  @ApiOperation({ summary: 'Принять входящую заявку' })
  async accept(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<null> {
    await this.friends.accept(user, id)
    return null
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Отменить/отклонить заявку или удалить из друзей' })
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<null> {
    await this.friends.remove(user, id)
    return null
  }
}
