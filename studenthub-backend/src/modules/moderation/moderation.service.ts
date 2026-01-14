import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateReportDto,
  GetReportsDto,
  ModerateReportDto,
} from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import {
  ReportResourceType,
  ReportStatus,
  ModerationAction,
} from '@prisma/client';

@Injectable()
export class ModerationService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Create a content report
   */
  async createReport(userId: string, dto: CreateReportDto) {
    // Verify resource exists
    let resourceExists = false;
    if (dto.resourceType === ReportResourceType.POST) {
      const post = await this.prisma.post.findUnique({
        where: { id: dto.resourceId },
      });
      resourceExists = !!post;
    } else if (dto.resourceType === ReportResourceType.COMMENT) {
      const comment = await this.prisma.comment.findUnique({
        where: { id: dto.resourceId },
      });
      resourceExists = !!comment;
    }

    if (!resourceExists) {
      throw new NotFoundException('Resource not found');
    }

    // Check if user already reported this resource
    const existingReport = await this.prisma.contentReport.findFirst({
      where: {
        reporterId: userId,
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        status: {
          in: [ReportStatus.PENDING, ReportStatus.REVIEWING],
        },
      },
    });

    if (existingReport) {
      throw new BadRequestException('You have already reported this content');
    }

    // Create report
    const reportData: any = {
      reporterId: userId,
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      reason: dto.reason,
      description: dto.description,
      status: ReportStatus.PENDING,
    };

    if (dto.resourceType === ReportResourceType.POST) {
      reportData.postId = dto.resourceId;
    } else if (dto.resourceType === ReportResourceType.COMMENT) {
      reportData.commentId = dto.resourceId;
    }

    const report = await this.prisma.contentReport.create({
      data: reportData,
      include: {
        reporter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Notify moderators (you might want to get university admins)
    // This is a simplified version
    return report;
  }

  /**
   * Get reports (for moderators/admins)
   */
  async getReports(dto: GetReportsDto, userId: string) {
    // Check if user is moderator/admin
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        universityAdmin: true,
      },
    });

    if (!user || (user.role !== 'SUPER_ADMIN' && !user.universityAdmin)) {
      throw new ForbiddenException('Access denied. Moderator access required.');
    }

    const where: any = {};

    if (dto.status) {
      where.status = dto.status;
    }

    const [reports, total] = await Promise.all([
      this.prisma.contentReport.findMany({
        where,
        include: {
          reporter: {
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
              content: true,
              authorId: true,
            },
          },
          comment: {
            select: {
              id: true,
              content: true,
              authorId: true,
            },
          },
          moderator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.take,
      }),
      this.prisma.contentReport.count({ where }),
    ]);

    return new PaginatedResponse(reports, total, dto);
  }

  /**
   * Moderate a report
   */
  async moderateReport(
    reportId: string,
    dto: ModerateReportDto,
    moderatorId: string,
  ) {
    const report = await this.prisma.contentReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    // Check if user is moderator
    const user = await this.prisma.user.findUnique({
      where: { id: moderatorId },
      include: {
        universityAdmin: true,
      },
    });

    if (!user || (user.role !== 'SUPER_ADMIN' && !user.universityAdmin)) {
      throw new ForbiddenException('Access denied. Moderator access required.');
    }

    // Perform moderation action
    if (dto.action === ModerationAction.DELETE_CONTENT) {
      if (report.resourceType === ReportResourceType.POST) {
        await this.prisma.post.delete({
          where: { id: report.resourceId },
        });
      } else if (report.resourceType === ReportResourceType.COMMENT) {
        await this.prisma.comment.delete({
          where: { id: report.resourceId },
        });
      }
    } else if (dto.action === ModerationAction.HIDE_CONTENT) {
      // You might want to add an isHidden field to Post/Comment
      // For now, we'll just mark the report as resolved
    }

    // Update report
    const updatedReport = await this.prisma.contentReport.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.RESOLVED,
        moderatorId,
        moderationAction: dto.action,
        moderationNote: dto.note,
        moderatedAt: new Date(),
      },
    });

    // Notify reporter
    await this.notificationsService.createNotification({
      recipientId: report.reporterId,
      type: 'CONTENT_REPORTED',
      title: 'Жалоба рассмотрена',
      message: `Ваша жалоба была рассмотрена. Действие: ${dto.action}`,
      data: {
        reportId,
        action: dto.action,
      },
    });

    return updatedReport;
  }

  /**
   * Get user's reports
   */
  async getUserReports(userId: string, dto: GetReportsDto) {
    const where: any = {
      reporterId: userId,
    };

    if (dto.status) {
      where.status = dto.status;
    }

    const [reports, total] = await Promise.all([
      this.prisma.contentReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.take,
      }),
      this.prisma.contentReport.count({ where }),
    ]);

    return new PaginatedResponse(reports, total, dto);
  }
}




