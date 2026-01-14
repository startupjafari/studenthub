import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GetMentionsDto } from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

@Injectable()
export class MentionsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Extract mentions from text (e.g., @username)
   */
  extractMentions(text: string): string[] {
    const mentionRegex = /@(\w+)/g;
    const matches = text.match(mentionRegex);
    if (!matches) return [];

    return matches.map((match) => match.substring(1).toLowerCase());
  }

  /**
   * Create mentions for a post
   */
  async createPostMentions(postId: string, content: string, authorId: string) {
    const usernames = this.extractMentions(content);
    if (usernames.length === 0) return [];

    // Find users by username (firstName + lastName or email prefix)
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          {
            firstName: {
              in: usernames,
              mode: 'insensitive',
            },
          },
          {
            lastName: {
              in: usernames,
              mode: 'insensitive',
            },
          },
          {
            email: {
              startsWith: usernames[0],
              mode: 'insensitive',
            },
          },
        ],
        NOT: {
          id: authorId, // Don't mention the author
        },
      },
    });

    if (users.length === 0) return [];

    // Create mentions
    const mentions = await Promise.all(
      users.map((user) =>
        this.prisma.mention.create({
          data: {
            userId: user.id,
            postId,
          },
        }),
      ),
    );

    // Send notifications
    await Promise.all(
      users.map((user) =>
        this.notificationsService.createNotification({
          recipientId: user.id,
          type: 'MENTION',
          title: 'Вас упомянули в посте',
          message: `Вас упомянули в посте`,
          data: {
            postId,
            authorId,
          },
        }),
      ),
    );

    return mentions;
  }

  /**
   * Create mentions for a comment
   */
  async createCommentMentions(commentId: string, content: string, authorId: string) {
    const usernames = this.extractMentions(content);
    if (usernames.length === 0) return [];

    // Find users
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          {
            firstName: {
              in: usernames,
              mode: 'insensitive',
            },
          },
          {
            lastName: {
              in: usernames,
              mode: 'insensitive',
            },
          },
        ],
        NOT: {
          id: authorId,
        },
      },
    });

    if (users.length === 0) return [];

    // Create mentions
    const mentions = await Promise.all(
      users.map((user) =>
        this.prisma.mention.create({
          data: {
            userId: user.id,
            commentId,
          },
        }),
      ),
    );

    // Send notifications
    await Promise.all(
      users.map((user) =>
        this.notificationsService.createNotification({
          recipientId: user.id,
          type: 'MENTION',
          title: 'Вас упомянули в комментарии',
          message: `Вас упомянули в комментарии`,
          data: {
            commentId,
            authorId,
          },
        }),
      ),
    );

    return mentions;
  }

  /**
   * Get user mentions
   */
  async getUserMentions(userId: string, dto: GetMentionsDto) {
    const where: any = {
      userId,
    };

    if (dto.isRead !== undefined) {
      where.isRead = dto.isRead;
    }

    const [mentions, total] = await Promise.all([
      this.prisma.mention.findMany({
        where,
        include: {
          post: {
            include: {
              author: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
            },
          },
          comment: {
            include: {
              author: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
              post: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.take,
      }),
      this.prisma.mention.count({ where }),
    ]);

    return new PaginatedResponse(mentions, total, dto);
  }

  /**
   * Mark mention as read
   */
  async markAsRead(mentionId: string, userId: string) {
    const mention = await this.prisma.mention.findUnique({
      where: { id: mentionId },
    });

    if (!mention) {
      throw new NotFoundException('Mention not found');
    }

    if (mention.userId !== userId) {
      throw new NotFoundException('Mention not found');
    }

    return this.prisma.mention.update({
      where: { id: mentionId },
      data: { isRead: true },
    });
  }

  /**
   * Get unread mentions count
   */
  async getUnreadCount(userId: string) {
    const count = await this.prisma.mention.count({
      where: {
        userId,
        isRead: false,
      },
    });

    return { count };
  }
}




