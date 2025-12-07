import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { CreateReactionDto } from './dto';
import { ReactionType } from '@prisma/client';

@Injectable()
export class ReactionsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  /**
   * Add reaction to post
   */
  async addPostReaction(
    postId: string,
    userId: string,
    dto: CreateReactionDto,
  ) {
    // Check if post exists
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Check if reaction already exists
    const existing = await this.prisma.reaction.findUnique({
      where: {
        userId_postId_type: {
          userId,
          postId,
          type: dto.type,
        },
      },
    });

    if (existing) {
      throw new BadRequestException('Reaction already exists');
    }

    const reaction = await this.prisma.reaction.create({
      data: {
        userId,
        postId,
        type: dto.type,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Create notification for post author
    if (post.authorId !== userId) {
      await this.createNotification(post.authorId, {
        type: 'POST_REACTION',
        title: 'New Reaction',
        message: 'Someone reacted to your post',
        data: {
          postId,
          reactionId: reaction.id,
          type: dto.type,
          userId,
        },
      });
    }

    // Invalidate cache
    await this.cache.deletePattern(`post:${postId}*`);

    return reaction;
  }

  /**
   * Remove reaction from post
   */
  async removePostReaction(postId: string, userId: string, type: ReactionType) {
    const reaction = await this.prisma.reaction.findUnique({
      where: {
        userId_postId_type: {
          userId,
          postId,
          type,
        },
      },
    });

    if (!reaction) {
      throw new NotFoundException('Reaction not found');
    }

    await this.prisma.reaction.delete({
      where: {
        userId_postId_type: {
          userId,
          postId,
          type,
        },
      },
    });

    // Invalidate cache
    await this.cache.deletePattern(`post:${postId}*`);

    return { message: 'Reaction removed successfully' };
  }

  /**
   * Get reactions for post
   */
  async getPostReactions(postId: string) {
    const reactions = await this.prisma.reaction.findMany({
      where: { postId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Group by type
    const grouped = reactions.reduce(
      (acc, reaction) => {
        if (!acc[reaction.type]) {
          acc[reaction.type] = [];
        }
        acc[reaction.type].push(reaction.user);
        return acc;
      },
      {} as Record<ReactionType, any[]>,
    );

    // Count by type
    const counts = Object.keys(ReactionType).reduce(
      (acc, type) => {
        acc[type as ReactionType] = grouped[type as ReactionType]?.length || 0;
        return acc;
      },
      {} as Record<ReactionType, number>,
    );

    return {
      ...counts,
      users: reactions.map((r) => r.user),
    };
  }

  /**
   * Add reaction to comment
   */
  async addCommentReaction(
    commentId: string,
    userId: string,
    dto: CreateReactionDto,
  ) {
    // Check if comment exists
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    // Check if reaction already exists
    const existing = await this.prisma.reaction.findUnique({
      where: {
        userId_commentId_type: {
          userId,
          commentId,
          type: dto.type,
        },
      },
    });

    if (existing) {
      throw new BadRequestException('Reaction already exists');
    }

    const reaction = await this.prisma.reaction.create({
      data: {
        userId,
        commentId,
        type: dto.type,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Invalidate cache
    await this.cache.deletePattern(`post:*`);

    return reaction;
  }

  /**
   * Remove reaction from comment
   */
  async removeCommentReaction(
    commentId: string,
    userId: string,
    type: ReactionType,
  ) {
    const reaction = await this.prisma.reaction.findUnique({
      where: {
        userId_commentId_type: {
          userId,
          commentId,
          type,
        },
      },
    });

    if (!reaction) {
      throw new NotFoundException('Reaction not found');
    }

    await this.prisma.reaction.delete({
      where: {
        userId_commentId_type: {
          userId,
          commentId,
          type,
        },
      },
    });

    // Invalidate cache
    await this.cache.deletePattern(`post:*`);

    return { message: 'Reaction removed successfully' };
  }

  /**
   * Get reactions for comment
   */
  async getCommentReactions(commentId: string) {
    const reactions = await this.prisma.reaction.findMany({
      where: { commentId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Group by type
    const grouped = reactions.reduce(
      (acc, reaction) => {
        if (!acc[reaction.type]) {
          acc[reaction.type] = [];
        }
        acc[reaction.type].push(reaction.user);
        return acc;
      },
      {} as Record<ReactionType, any[]>,
    );

    // Count by type
    const counts = Object.keys(ReactionType).reduce(
      (acc, type) => {
        acc[type as ReactionType] = grouped[type as ReactionType]?.length || 0;
        return acc;
      },
      {} as Record<ReactionType, number>,
    );

    return {
      ...counts,
      users: reactions.map((r) => r.user),
    };
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





