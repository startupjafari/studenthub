import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../guards/ws-jwt.guard';
import { WsRateLimitGuard } from '../guards/ws-rate-limit.guard';
import { PresenceService } from '../../presence/presence.service';
import { PresenceStatus } from '@prisma/client';

@WebSocketGateway({
  namespace: '/presence',
  cors: {
    origin: process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',').map((url) => url.trim())
      : ['http://localhost:4000', 'http://localhost:3001'],
  },
})
@UseGuards(WsJwtGuard, WsRateLimitGuard)
export class PresenceGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger: Logger = new Logger('PresenceGateway');
  private onlineUsers = new Map<string, Socket[]>(); // userId -> sockets[]

  constructor(private presenceService: PresenceService) {}

  async handleConnection(client: Socket) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }

    const userId = user.sub;

    // Add socket to user's sockets
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, []);
    }
    this.onlineUsers.get(userId)!.push(client);

    // Set user as online
    await this.presenceService.setOnline(userId);

    // Join user's presence room
    client.join(`user:${userId}`);

    // Notify friends that user is online
    this.broadcastPresenceUpdate(userId, PresenceStatus.ONLINE);

    this.logger.log(`User ${userId} connected (${client.id})`);
  }

  async handleDisconnect(client: Socket) {
    const user = client.data.user;
    if (!user) return;

    const userId = user.sub;
    const userSockets = this.onlineUsers.get(userId);

    if (userSockets) {
      // Remove this socket
      const index = userSockets.indexOf(client);
      if (index > -1) {
        userSockets.splice(index, 1);
      }

      // If no more sockets, set user as offline
      if (userSockets.length === 0) {
        this.onlineUsers.delete(userId);
        await this.presenceService.setOffline(userId);
        this.broadcastPresenceUpdate(userId, PresenceStatus.OFFLINE);
      }
    }

    this.logger.log(`User ${userId} disconnected (${client.id})`);
  }

  @SubscribeMessage('presence:update')
  async handlePresenceUpdate(
    client: Socket,
    payload: { status: PresenceStatus },
  ) {
    const user = client.data.user;
    if (!user) return;

    const userId = user.sub;
    await this.presenceService.updatePresence(userId, payload.status);
    this.broadcastPresenceUpdate(userId, payload.status);
  }

  /**
   * Broadcast presence update to user's friends
   */
  private broadcastPresenceUpdate(userId: string, status: PresenceStatus) {
    // Emit to all clients in the user's presence room
    this.server.to(`user:${userId}`).emit('presence:update', {
      userId,
      status,
      timestamp: new Date(),
    });

    // Also broadcast to friends (you might want to implement friend rooms)
    this.server.emit('presence:changed', {
      userId,
      status,
      timestamp: new Date(),
    });
  }

  /**
   * Get online users count
   */
  getOnlineUsersCount(): number {
    return this.onlineUsers.size;
  }
}


