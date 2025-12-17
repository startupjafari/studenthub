import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { PresenceStatus } from '@prisma/client';

@Injectable()
export class PresenceService {
  constructor(private prisma: PrismaService) {}

  /**
   * Update user presence status
   */
  async updatePresence(userId: string, status: PresenceStatus) {
    // Update or create presence
    const presence = await this.prisma.userPresence.upsert({
      where: { userId },
      update: {
        status,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        status,
        lastSeenAt: new Date(),
      },
    });

    // Update user's lastSeenAt
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    });

    return presence;
  }

  /**
   * Get user presence
   */
  async getPresence(userId: string) {
    const presence = await this.prisma.userPresence.findUnique({
      where: { userId },
    });

    if (!presence) {
      // Return default offline status
      return {
        userId,
        status: PresenceStatus.OFFLINE,
        lastSeenAt: null,
      };
    }

    return presence;
  }

  /**
   * Get multiple users presence
   */
  async getMultiplePresence(userIds: string[]) {
    const presences = await this.prisma.userPresence.findMany({
      where: {
        userId: { in: userIds },
      },
    });

    // Create a map for quick lookup
    const presenceMap = new Map(
      presences.map((p) => [p.userId, p]),
    );

    // Return presence for all requested users
    return userIds.map((userId) => {
      const presence = presenceMap.get(userId);
      return presence || {
        userId,
        status: PresenceStatus.OFFLINE,
        lastSeenAt: null,
      };
    });
  }

  /**
   * Set user as offline (called on disconnect)
   */
  async setOffline(userId: string) {
    await this.updatePresence(userId, PresenceStatus.OFFLINE);
  }

  /**
   * Set user as online (called on connect)
   */
  async setOnline(userId: string) {
    await this.updatePresence(userId, PresenceStatus.ONLINE);
  }
}


