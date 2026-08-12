import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { StudentIdService } from './student-id.service'
import { VerifyStudentIdDto } from './dto/verify-student-id.dto'

const STUDENT_ROLES = [Role.STUDENT, Role.STAROSTA] as const
// Кто может проверять карту студента: сотрудники вуза + платформенные роли.
const VERIFY_ROLES = [
  Role.TEACHER,
  Role.DEAN,
  Role.STAROSTA,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
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

  @Get('verify')
  @Roles(...VERIFY_ROLES)
  @ApiOperation({ summary: 'Проверить студенческий по QR (сотрудник)' })
  verify(@CurrentUser() user: CurrentUserData, @Query() query: VerifyStudentIdDto) {
    return this.studentId.verify(user, query.token)
  }
}
