import { Injectable, Logger } from '@nestjs/common'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { RealtimeGateway } from '../../common/realtime'
import { CareerAccessService } from './career-access.service'

// Живая карьера (docs/PROJECT.md §9.2d, `career.changed`). Витрина вакансий, «Мои отклики»,
// воронка кандидатов компании и очередь модерации вакансий обновлялись только по перезагрузке.
// Сигнал без содержимого: в data лишь сущность и вид изменения, клиент перечитывает данные
// своим запросом, а сервер отдаёт их по правам зрителя (витрина — по допуску и решению вуза).
//
// Вакансия адресуется комнатами `university:{id}` вузов, куда компания допущена прямо сейчас
// (тот же набор, что `CareerAccessService.allowedUniversityIds`, — из кэша, без лишнего
// запроса): в комнате и студенты витрины, и модераторы вакансий вуза. Комната шире тех, кому
// вакансия видна, но сигнал ничего не раскрывает — чужой вуз перечитает прежний список.
// Компания — личными комнатами своих участников: в вузовских комнатах её нет.

export type VacancyChangeKind =
  'created' | 'published' | 'updated' | 'paused' | 'closed' | 'deleted' | 'reviewed'
export type CareerApplicationChangeKind = 'submitted' | 'status' | 'withdrawn'

/** Участники компании — владелец и рекрутеры: единицы (как в CareerNotifier). */
const COMPANY_MEMBERS_LIMIT = 100
/** Потолок вузовских комнат одного сигнала: компания допущена в единицы вузов. */
const UNIVERSITY_ROOMS_LIMIT = 100

interface Audience {
  companyId: string
  /** Сигнал и вузам с действующим допуском компании. */
  universities?: boolean
  /** Конкретные вузы (решение модератора) — в дополнение к допущенным или вместо них. */
  universityIds?: string[]
  /** Конкретные люди (автор отклика). */
  userIds?: string[]
}

@Injectable()
export class CareerRealtime {
  private readonly logger = new Logger(CareerRealtime.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly access: CareerAccessService,
  ) {}

  /**
   * Вакансия изменилась только для компании: черновик создан, правлен или удалён, снятая с
   * публикации закрыта. Студенты и модераторы её не видят — им сигнал ни к чему.
   */
  async vacancyForCompany(
    vacancyId: string,
    companyId: string,
    kind: VacancyChangeKind,
  ): Promise<void> {
    await this.deliver(vacancyId, { entity: 'vacancy', kind }, { companyId })
  }

  /**
   * Вакансия на виду у вузов: опубликована (заявки на модерацию встали в очередь, а снятая с
   * паузы вернулась на витрину), правлена (текст на витрине или возврат на модерацию), снята
   * или закрыта (ушла и с витрины, и из очереди). Вузам с действующим допуском и компании.
   */
  async vacancyForUniversities(
    vacancyId: string,
    companyId: string,
    kind: VacancyChangeKind,
  ): Promise<void> {
    await this.deliver(vacancyId, { entity: 'vacancy', kind }, { companyId, universities: true })
  }

  /**
   * Модератор вуза одобрил или отклонил вакансию: витрина и очередь этого вуза (другие
   * модераторы видят решение сразу) и кабинет компании.
   */
  async vacancyReviewed(vacancyId: string, companyId: string, universityId: string): Promise<void> {
    await this.deliver(
      vacancyId,
      { entity: 'vacancy', kind: 'reviewed' },
      { companyId, universityIds: [universityId] },
    )
  }

  /** Новый отклик или отзыв отклика студентом — воронке компании. */
  async applicationForCompany(
    applicationId: string,
    companyId: string,
    kind: 'submitted' | 'withdrawn',
  ): Promise<void> {
    await this.deliver(applicationId, { entity: 'application', kind }, { companyId })
  }

  /**
   * Компания перевела отклик по воронке — его автору («Мои отклики») и коллегам по компании:
   * воронку ведут несколько рекрутеров, и чужой перевод должен быть виден у каждого.
   */
  async applicationStatusChanged(
    applicationId: string,
    companyId: string,
    studentId: string,
  ): Promise<void> {
    await this.deliver(
      applicationId,
      { entity: 'application', kind: 'status' },
      { companyId, userIds: [studentId] },
    )
  }

  /**
   * Одна отправка во все комнаты: socket.io объединяет их, и человек, попавший в несколько
   * (студент в вузе — он же автор отклика), получит сигнал один раз.
   *
   * Best-effort: действие уже записано. Ловится всё — и чтение адресатов, и сама рассылка,
   * — иначе сбой Redis или сокета превратил бы удачную публикацию в 500.
   */
  private async deliver(
    entityId: string,
    data:
      | { entity: 'vacancy'; kind: VacancyChangeKind }
      | {
          entity: 'application'
          kind: CareerApplicationChangeKind
        },
    audience: Audience,
  ): Promise<void> {
    try {
      const [members, admitted] = await Promise.all([
        this.prisma.companyMember.findMany({
          where: { companyId: audience.companyId },
          select: { userId: true },
          take: COMPANY_MEMBERS_LIMIT,
        }),
        audience.universities
          ? this.access.allowedUniversityIds(audience.companyId)
          : Promise.resolve<string[]>([]),
      ])
      const universities = [...new Set([...(audience.universityIds ?? []), ...admitted])].slice(
        0,
        UNIVERSITY_ROOMS_LIMIT,
      )
      const users = new Set([...members.map((m) => m.userId), ...(audience.userIds ?? [])])
      this.realtime.emitEventToRooms(
        [...universities.map((id) => `university:${id}`), ...[...users].map((id) => `user:${id}`)],
        REALTIME_EVENTS.careerChanged,
        entityId,
        data,
      )
    } catch (error) {
      this.logger.warn(
        `Карьера, ${data.entity} ${entityId} (${data.kind}): не удалось разослать сигнал — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
