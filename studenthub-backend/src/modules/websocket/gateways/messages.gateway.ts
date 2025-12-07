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
import { MessagesService } from '../../messages/messages.service';
import { PrismaService } from '../../../common/services/prisma.service';

@WebSocketGateway({
  namespace: '/messages',
  cors: {
    origin: process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',').map((url) => url.trim())
      : ['http://localhost:4000', 'http://localhost:3001'],
  },
})
@UseGuards(WsJwtGuard, WsRateLimitGuard)
@UsePipes(new ValidationPipe())
export class MessagesGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger: Logger = new Logger('MessagesGateway');
  private userRooms: Map<string, Set<string>> = new Map(); // userId -> Set<conversationId>

  constructor(
    private messagesService: MessagesService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }

    this.logger.log(`Client connected: ${user.sub} (${client.id})`);

    // Join user's personal room
    client.join(`user:${user.sub}`);

    // Join all user's conversation rooms
    const conversations = await this.prisma.conversation.findMany({
      where: {
        participants: {
          some: { id: user.sub },
        },
      },
      select: { id: true },
    });

    conversations.forEach((conv) => {
      const room = `conversation:${conv.id}`;
      client.join(room);
      if (!this.userRooms.has(user.sub)) {
        this.userRooms.set(user.sub, new Set());
      }
      this.userRooms.get(user.sub)?.add(conv.id);
    });
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user;
    if (user) {
      this.logger.log(`Client disconnected: ${user.sub} (${client.id})`);
      this.userRooms.delete(user.sub);
    }
  }

  @SubscribeMessage('join:conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody('conversationId') conversationId: string,
  ) {
    const user = client.data.user;
    if (!user) return;

    // Verify user is participant
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          select: { id: true },
        },
      },
    });

    if (
      conversation &&
      conversation.participants.some((p) => p.id === user.sub)
    ) {
      const room = `conversation:${conversationId}`;
      client.join(room);
      if (!this.userRooms.has(user.sub)) {
        this.userRooms.set(user.sub, new Set());
      }
      this.userRooms.get(user.sub)?.add(conversationId);
      this.logger.log(`User ${user.sub} joined conversation ${conversationId}`);
    }
  }

  @SubscribeMessage('leave:conversation')
  async handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody('conversationId') conversationId: string,
  ) {
    const user = client.data.user;
    if (!user) return;

    const room = `conversation:${conversationId}`;
    client.leave(room);
    this.userRooms.get(user.sub)?.delete(conversationId);
    this.logger.log(`User ${user.sub} left conversation ${conversationId}`);
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody('conversationId') conversationId: string,
  ) {
    const user = client.data.user;
    if (!user) return;

    const room = `conversation:${conversationId}`;
    client.to(room).emit('user:typing', {
      userId: user.sub,
      conversationId,
      isTyping: true,
    });
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody('conversationId') conversationId: string,
  ) {
    const user = client.data.user;
    if (!user) return;

    const room = `conversation:${conversationId}`;
    client.to(room).emit('user:typing', {
      userId: user.sub,
      conversationId,
      isTyping: false,
    });
  }

  // Method to emit new message (called from service)
  emitNewMessage(conversationId: string, message: any) {
    this.server.to(`conversation:${conversationId}`).emit('message:new', message);
  }

  // Method to emit message edit
  emitMessageEdit(conversationId: string, message: any) {
    this.server.to(`conversation:${conversationId}`).emit('message:edit', message);
  }

  // Method to emit message delete
  emitMessageDelete(conversationId: string, messageId: string) {
    this.server
      .to(`conversation:${conversationId}`)
      .emit('message:delete', { messageId });
  }
}

