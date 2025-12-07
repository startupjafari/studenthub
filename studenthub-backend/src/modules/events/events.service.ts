import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CreateEventDto, GetEventsDto } from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async createEvent(userId: string, dto: CreateEventDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user || (user.role !== UserRole.UNIVERSITY_ADMIN && user.role !== UserRole.TEACHER)) {
      throw new ForbiddenException('Only admins and teachers can create events');
    }

    if (dto.endDate && new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        location: dto.location,
        isOnline: dto.isOnline || false,
        eventType: dto.eventType || 'ANNOUNCEMENT',
        universityId: dto.universityId,
        groupId: dto.groupId,
      },
      include: {
        university: {
          select: {
            id: true,
            name: true,
            shortName: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return event;
  }

  async getEvents(dto: GetEventsDto) {
    const now = new Date();
    const where: any = {
      startDate: { gte: now },
    };

    if (dto.universityId) where.universityId = dto.universityId;
    if (dto.groupId) where.groupId = dto.groupId;
    if (dto.eventType) where.eventType = dto.eventType;

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        include: {
          university: {
            select: {
              id: true,
              name: true,
              shortName: true,
            },
          },
          group: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        skip: dto.skip,
        take: dto.take,
        orderBy: { startDate: 'asc' },
      }),
      this.prisma.event.count({ where }),
    ]);

    return new PaginatedResponse(events, total, dto);
  }

  async getEventById(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        university: {
          select: {
            id: true,
            name: true,
            shortName: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }

  async updateEvent(id: string, userId: string, dto: Partial<CreateEventDto>) {
    const event = await this.prisma.event.findUnique({
      where: { id },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    // Check if user is admin of the university
    const admin = await this.prisma.universityAdmin.findFirst({
      where: {
        userId,
        universityId: event.universityId,
      },
    });

    if (!admin) {
      throw new ForbiddenException('Only university admins can update events');
    }

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        ...(dto.title && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.startDate && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate && { endDate: new Date(dto.endDate) }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.isOnline !== undefined && { isOnline: dto.isOnline }),
        ...(dto.eventType && { eventType: dto.eventType }),
      },
      include: {
        university: {
          select: {
            id: true,
            name: true,
            shortName: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return updated;
  }

  async deleteEvent(id: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    // Check if user is admin of the university
    const admin = await this.prisma.universityAdmin.findFirst({
      where: {
        userId,
        universityId: event.universityId,
      },
    });

    if (!admin) {
      throw new ForbiddenException('Only university admins can delete events');
    }

    await this.prisma.event.delete({
      where: { id },
    });

    return { message: 'Event deleted successfully' };
  }
}





