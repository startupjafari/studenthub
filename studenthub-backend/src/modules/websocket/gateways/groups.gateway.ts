import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UsePipes, ValidationPipe, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../guards/ws-jwt.guard';
import { WsRateLimitGuard } from '../guards/ws-rate-limit.guard';
import { PrismaService } from '../../../common/services/prisma.service';

@WebSocketGateway({
  namespace: '/groups',
  cors: {
    origin: process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',').map((url) => url.trim())
      : ['http://localhost:4000', 'http://localhost:3001'],
  },
})
@UseGuards(WsJwtGuard, WsRateLimitGuard)
@UsePipes(new ValidationPipe())
export class GroupsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger: Logger = new Logger('GroupsGateway');
  private userRooms: Map<string, Set<string>> = new Map(); // userId -> Set<groupId>

  constructor(private prisma: PrismaService) {}

  async handleConnection(client: Socket) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }

    this.logger.log(`Client connected: ${user.sub} (${client.id})`);

    // Join user's personal room
    client.join(`user:${user.sub}`);

    // Join all user's group rooms
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId: user.sub },
      select: { groupId: true },
    });

    memberships.forEach((membership) => {
      const room = `group:${membership.groupId}`;
      client.join(room);
      if (!this.userRooms.has(user.sub)) {
        this.userRooms.set(user.sub, new Set());
      }
      this.userRooms.get(user.sub)?.add(membership.groupId);
    });
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user;
    if (user) {
      this.logger.log(`Client disconnected: ${user.sub} (${client.id})`);
      this.userRooms.delete(user.sub);
    }
  }

  @SubscribeMessage('join:group')
  async handleJoinGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody('groupId') groupId: string,
  ) {
    const user = client.data.user;
    if (!user) return;

    // Verify user is member
    const membership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: user.sub,
        },
      },
    });

    if (membership) {
      const room = `group:${groupId}`;
      client.join(room);
      if (!this.userRooms.has(user.sub)) {
        this.userRooms.set(user.sub, new Set());
      }
      this.userRooms.get(user.sub)?.add(groupId);
      this.logger.log(`User ${user.sub} joined group ${groupId}`);
    }
  }

  @SubscribeMessage('leave:group')
  async handleLeaveGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody('groupId') groupId: string,
  ) {
    const user = client.data.user;
    if (!user) return;

    const room = `group:${groupId}`;
    client.leave(room);
    this.userRooms.get(user.sub)?.delete(groupId);
    this.logger.log(`User ${user.sub} left group ${groupId}`);
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody('groupId') groupId: string,
  ) {
    const user = client.data.user;
    if (!user) return;

    const room = `group:${groupId}`;
    client.to(room).emit('user:typing', {
      userId: user.sub,
      groupId,
      isTyping: true,
    });
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody('groupId') groupId: string,
  ) {
    const user = client.data.user;
    if (!user) return;

    const room = `group:${groupId}`;
    client.to(room).emit('user:typing', {
      userId: user.sub,
      groupId,
      isTyping: false,
    });
  }

  // Method to emit new group message (called from service)
  emitNewMessage(groupId: string, message: any) {
    this.server.to(`group:${groupId}`).emit('group:message', message);
  }

  // Method to emit message edit
  emitMessageEdit(groupId: string, message: any) {
    this.server.to(`group:${groupId}`).emit('group:message:edit', message);
  }

  // Method to emit message delete
  emitMessageDelete(groupId: string, messageId: string) {
    this.server.to(`group:${groupId}`).emit('group:message:delete', { messageId });
  }
}

