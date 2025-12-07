import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { CreateStoryDto } from './dto';

@Injectable()
export class StoriesService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  /**
   * Create story
   */
  async createStory(userId: string, dto: CreateStoryDto) {
    // Validate media exists
    const media = await this.prisma.media.findUnique({
      where: { id: dto.mediaId },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    // Check if media is an image or video
    if (media.type !== 'IMAGE' && media.type !== 'VIDEO') {
      throw new BadRequestException('Story media must be an image or video');
    }

    // Set expiration to 24 hours from now
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const story = await this.prisma.story.create({
      data: {
        authorId: userId,
        content: dto.content,
        mediaId: dto.mediaId,
        expiresAt,
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        media: true,
        _count: {
          select: {
            viewedBy: true,
          },
        },
      },
    });

    return story;
  }

  /**
   * Get active stories (grouped by author)
   */
  async getActiveStories(userId: string) {
    const now = new Date();

    // Get user's friends
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        friends: {
          select: { id: true },
        },
      },
    });

    const friendIds = user?.friends.map((f) => f.id) || [];

    // Get active stories from user and friends
    const stories = await this.prisma.story.findMany({
      where: {
        expiresAt: { gt: now },
        authorId: { in: [userId, ...friendIds] },
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        media: true,
        _count: {
          select: {
            viewedBy: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by author
    const grouped = stories.reduce((acc, story) => {
      const authorId = story.authorId;
      if (!acc[authorId]) {
        acc[authorId] = {
          author: story.author,
          stories: [],
        };
      }
      acc[authorId].stories.push(story);
      return acc;
    }, {} as Record<string, any>);

    return Object.values(grouped);
  }

  /**
   * Get story by ID and create view
   */
  async getStoryById(storyId: string, userId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        media: true,
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    // Check if story is expired
    if (story.expiresAt < new Date()) {
      throw new BadRequestException('Story has expired');
    }

    // Check if already viewed
    const existingView = await this.prisma.storyView.findUnique({
      where: {
        storyId_viewerId: {
          storyId,
          viewerId: userId,
        },
      },
    });

    // Create view if not exists
    if (!existingView) {
      await this.prisma.storyView.create({
        data: {
          storyId,
          viewerId: userId,
        },
      });

      // Create notification for story author (if not own story)
      if (story.authorId !== userId) {
        await this.createNotification(story.authorId, {
          type: 'STORY_VIEW',
          title: 'Story Viewed',
          message: 'Someone viewed your story',
          data: {
            storyId,
            viewerId: userId,
          },
        });
      }
    }

    return story;
  }

  /**
   * Delete story
   */
  async deleteStory(storyId: string, userId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    if (story.authorId !== userId) {
      throw new ForbiddenException('You can only delete your own stories');
    }

    await this.prisma.story.delete({
      where: { id: storyId },
    });

    return { message: 'Story deleted successfully' };
  }

  /**
   * Get story views (only author)
   */
  async getStoryViews(storyId: string, userId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    if (story.authorId !== userId) {
      throw new ForbiddenException('You can only view your own story views');
    }

    const views = await this.prisma.storyView.findMany({
      where: { storyId },
      include: {
        viewer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
      orderBy: { viewedAt: 'desc' },
    });

    return views;
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





