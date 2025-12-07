import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../common/services/prisma.service';

@Injectable()
export class StoriesCleanupService {
  private readonly logger = new Logger(StoriesCleanupService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Delete expired stories every 5 minutes
   */
  @Cron('*/5 * * * *', {
    name: 'cleanup-expired-stories',
    timeZone: 'UTC',
  })
  async handleExpiredStoriesCleanup() {
    this.logger.log('Starting expired stories cleanup...');

    const now = new Date();

    try {
      // Find expired stories
      const expiredStories = await this.prisma.story.findMany({
        where: {
          expiresAt: {
            lt: now,
          },
        },
        select: {
          id: true,
          mediaId: true,
        },
      });

      if (expiredStories.length === 0) {
        this.logger.log('No expired stories to delete');
        return;
      }

      // Delete stories and their views
      const storyIds = expiredStories.map((s) => s.id);

      await this.prisma.$transaction(async (tx) => {
        // Delete story views
        await tx.storyView.deleteMany({
          where: {
            storyId: { in: storyIds },
          },
        });

        // Delete stories
        await tx.story.deleteMany({
          where: {
            id: { in: storyIds },
          },
        });
      });

      this.logger.log(
        `Successfully deleted ${expiredStories.length} expired stories`,
      );
    } catch (error) {
      this.logger.error('Error cleaning up expired stories:', error);
    }
  }
}





