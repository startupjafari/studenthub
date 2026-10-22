import { Controller, Get, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { StudentIdService } from './student-id.service'
import { VerifyStudentIdDto } from './dto/verify-student-id.dto'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'

const STUDENT_ROLES = [Role.STUDENT, Role.STAROSTA] as const
// Кто может проверять карту студента: сотрудники вуза (включая охрану на входе) +
// платформенные роли.
const VERIFY_ROLES = [
  Role.TEACHER,
  Role.DEAN,
  Role.STAROSTA,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.SECURITY_GUARD,
  // Библиотекарь сверяет читателя при выдаче книги (Фаза 20.4).
  Role.LIBRARIAN,
] as const

@ApiTags('Студенческий билет')
@ApiBearerAuth()
@Controller('student-id')
export class StudentIdController {
  constructor(private readonly studentId: StudentIdService) {}

  @Get('me')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Мой цифровой студенческий (карта + QR)' })
  me(@CurrentUser() user: CurrentUserData) {
    return this.studentId.myCard(user)
  }

  @RestrictedAllowed(Role.SECURITY_GUARD, Role.LIBRARIAN)
  @Get('verify')
  @Roles(...VERIFY_ROLES)
  @ApiOperation({ summary: 'Проверить студенческий по QR (сотрудник)' })
  @ApiResponse({ status: 200, description: 'Карта студента с отметкой проверки' })
  @ApiResponse({
    status: 409,
    description: 'CONFLICT — этот код уже проверил другой сотрудник: студенту обновить карту',
  })
  verify(
    @CurrentUser() user: CurrentUserData,
    @Query() query: VerifyStudentIdDto,
    @Req() req: FastifyRequest,
  ) {
    return this.studentId.verify(user, query.token, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
