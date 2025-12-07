import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { SendFriendRequestDto } from './dto';
import { FriendStatus } from '@prisma/client';

@Injectable()
export class FriendsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  /**
   * Send friend request
   */
  async sendFriendRequest(userId: string, dto: SendFriendRequestDto) {
    if (userId === dto.receiverId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }

    // Check if receiver exists
    const receiver = await this.prisma.user.findUnique({
      where: { id: dto.receiverId },
    });

    if (!receiver) {
      throw new NotFoundException('User not found');
    }

    // Check if request already exists
    const existing = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          {
            senderId: userId,
            receiverId: dto.receiverId,
          },
          {
            senderId: dto.receiverId,
            receiverId: userId,
          },
        ],
      },
    });

    if (existing) {
      if (existing.status === 'ACCEPTED') {
        throw new BadRequestException('Users are already friends');
      }
      if (existing.status === 'PENDING') {
        throw new BadRequestException('Friend request already pending');
      }
    }

    const request = await this.prisma.friendRequest.create({
      data: {
        senderId: userId,
        receiverId: dto.receiverId,
        status: FriendStatus.PENDING,
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        receiver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Create notification
    await this.createNotification(dto.receiverId, {
      type: 'FRIEND_REQUEST',
      title: 'Friend Request',
      message: 'You have a new friend request',
      data: {
        requestId: request.id,
        senderId: userId,
      },
    });

    return request;
  }

  /**
   * Get incoming friend requests
   */
  async getIncomingRequests(userId: string) {
    const requests = await this.prisma.friendRequest.findMany({
      where: {
        receiverId: userId,
        status: FriendStatus.PENDING,
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests;
  }

  /**
   * Get sent friend requests
   */
  async getSentRequests(userId: string) {
    const requests = await this.prisma.friendRequest.findMany({
      where: {
        senderId: userId,
        status: FriendStatus.PENDING,
      },
      include: {
        receiver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests;
  }

  /**
   * Accept friend request
   */
  async acceptRequest(requestId: string, userId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.receiverId !== userId) {
      throw new ForbiddenException('You can only accept requests sent to you');
    }

    if (request.status !== FriendStatus.PENDING) {
      throw new BadRequestException('Request is not pending');
    }

    // Transaction: Update request status and add friends
    await this.prisma.$transaction(async (tx) => {
      // Update request status
      await tx.friendRequest.update({
        where: { id: requestId },
        data: { status: FriendStatus.ACCEPTED },
      });

      // Add to friends (many-to-many)
      await tx.user.update({
        where: { id: request.senderId },
        data: {
          friends: {
            connect: { id: request.receiverId },
          },
        },
      });

      await tx.user.update({
        where: { id: request.receiverId },
        data: {
          friends: {
            connect: { id: request.senderId },
          },
        },
      });
    });

    // Create notification
    await this.createNotification(request.senderId, {
      type: 'FRIEND_ACCEPTED',
      title: 'Friend Request Accepted',
      message: 'Your friend request was accepted',
      data: {
        requestId,
        receiverId: userId,
      },
    });

    // Invalidate cache
    await this.cache.invalidateUserCache(userId);
    await this.cache.invalidateUserCache(request.senderId);

    return { message: 'Friend request accepted' };
  }

  /**
   * Reject friend request
   */
  async rejectRequest(requestId: string, userId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.receiverId !== userId) {
      throw new ForbiddenException('You can only reject requests sent to you');
    }

    await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: FriendStatus.REJECTED },
    });

    return { message: 'Friend request rejected' };
  }

  /**
   * Remove friend
   */
  async removeFriend(friendId: string, userId: string) {
    if (userId === friendId) {
      throw new BadRequestException('Cannot remove yourself');
    }

    // Check if users are friends
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        friends: {
          where: { id: friendId },
        },
      },
    });

    if (!user || user.friends.length === 0) {
      throw new BadRequestException('Users are not friends');
    }

    // Remove from friends (many-to-many)
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          friends: {
            disconnect: { id: friendId },
          },
        },
      });

      await tx.user.update({
        where: { id: friendId },
        data: {
          friends: {
            disconnect: { id: userId },
          },
        },
      });

      // Update friend request status if exists
      await tx.friendRequest.updateMany({
        where: {
          OR: [
            { senderId: userId, receiverId: friendId },
            { senderId: friendId, receiverId: userId },
          ],
          status: FriendStatus.ACCEPTED,
        },
        data: { status: FriendStatus.REJECTED },
      });
    });

    // Invalidate cache
    await this.cache.invalidateUserCache(userId);
    await this.cache.invalidateUserCache(friendId);

    return { message: 'Friend removed successfully' };
  }

  /**
   * Get user's friends
   */
  async getUserFriends(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        friends: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            bio: true,
            role: true,
            student: {
              select: {
                studentId: true,
                academicStatus: true,
              },
            },
            teacher: {
              select: {
                department: true,
                specialization: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.friends;
  }

  /**
   * Helper: Create notification
   */
  private async createNotification(
    recipientId: string,
    data: {
      type: string;
      title: string;
      message: string;
      data?: any;
    },
  ) {
    await this.prisma.notification.create({
      data: {
        recipientId,
        type: data.type as any,
        title: data.title,
        message: data.message,
        data: data.data || {},
      },
    });
  }
}





