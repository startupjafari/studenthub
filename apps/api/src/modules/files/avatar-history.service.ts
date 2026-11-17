import type { AvatarPhotoDto } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileService } from './file.service'

/**
 * Потолок истории фото (аватаров) человека или группы (§8.3). Telegram хранит всё, но здесь
 * каждое фото — объект в публичном бакете, и пятидесятое фото в шапке никто не долистает.
 */
export const AVATAR_HISTORY_MAX = 50

/** Чья история: человека или группы. */
export type AvatarOwner = { userId: string } | { chatId: string }

/**
 * История фото профиля и группы (AvatarPhoto, §8.3) — общая для UsersService и ChatsService.
 * Лежит рядом с FileService, потому что строка истории живёт и умирает вместе с файлом, а
 * модули людей и чатов друг от друга не зависят. Не провайдер DI, а помощник поверх уже
 * внедрённых PrismaService и FileService: сервисам не пришлось менять конструкторы (их
 * собирают руками в unit-тестах).
 */
export class AvatarHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
  ) {}

  /** Новое фото — свежая строка истории; сверх потолка самые старые уходят с файлами. */
  async add(owner: AvatarOwner, fileId: string, url: string): Promise<void> {
    await this.prisma.avatarPhoto.create({ data: { ...owner, fileId, url } })
    await this.trim(owner)
  }

  /** Фото свежими первыми, текущее (совпадает URL) — первым. */
  async list(owner: AvatarOwner, currentUrl: string | null): Promise<AvatarPhotoDto[]> {
    const rows = await this.prisma.avatarPhoto.findMany({
      where: owner,
      select: { id: true, url: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: AVATAR_HISTORY_MAX,
    })
    const list = rows.map((r) => ({
      id: r.id,
      url: r.url,
      createdAt: r.createdAt.toISOString(),
      current: currentUrl != null && r.url === currentUrl,
    }))
    const at = list.findIndex((p) => p.current)
    if (at > 0) list.unshift(...list.splice(at, 1))
    // Аватар старше истории (строки нет): показываем его первым, без id для удаления нечего.
    if (currentUrl && at === -1) {
      list.unshift({ id: '', url: currentUrl, createdAt: new Date(0).toISOString(), current: true })
    }
    return list
  }

  /** Строка истории по id у этого владельца, иначе null. */
  find(owner: AvatarOwner, id: string): Promise<{ id: string; url: string } | null> {
    return this.prisma.avatarPhoto.findFirst({
      where: { id, ...owner },
      select: { id: true, url: true },
    })
  }

  /** Строка текущего фото по его URL. */
  findByUrl(owner: AvatarOwner, url: string): Promise<{ id: string; url: string } | null> {
    return this.prisma.avatarPhoto.findFirst({
      where: { url, ...owner },
      select: { id: true, url: true },
    })
  }

  /** Самое свежее фото истории — оно становится текущим, когда текущее удалили. */
  latest(owner: AvatarOwner): Promise<{ url: string; fileId: string | null } | null> {
    return this.prisma.avatarPhoto.findFirst({
      where: owner,
      select: { url: true, fileId: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  }

  /** Id файлов, которые держит история (их нельзя сносить вместе с «прежними аватарами»). */
  async heldFileIds(fileIds: string[]): Promise<Set<string>> {
    if (fileIds.length === 0) return new Set()
    const rows = await this.prisma.avatarPhoto.findMany({
      where: { fileId: { in: fileIds } },
      select: { fileId: true },
      take: fileIds.length,
    })
    return new Set(rows.flatMap((r) => (r.fileId ? [r.fileId] : [])))
  }

  /** Строка истории — вместе с файлом (строка уходит каскадом), либо одна, без файла. */
  async remove(id: string): Promise<void> {
    const row = await this.prisma.avatarPhoto.findUnique({
      where: { id },
      select: { fileId: true },
    })
    if (!row) return
    // Файл уже снят мимо истории — строку всё равно убираем, иначе фото висело бы битым.
    if (row.fileId) {
      try {
        await this.files.delete(row.fileId)
      } catch {
        // Объект подберёт ночная чистка сирот; строку истории держать незачем.
      }
    }
    await this.prisma.avatarPhoto.deleteMany({ where: { id } })
  }

  /** Вся история владельца — вместе с файлами (удаление аккаунта). */
  async removeAll(owner: AvatarOwner): Promise<void> {
    for (;;) {
      const batch = await this.prisma.avatarPhoto.findMany({
        where: owner,
        select: { id: true },
        take: AVATAR_HISTORY_MAX,
      })
      if (batch.length === 0) return
      for (const row of batch) await this.remove(row.id)
    }
  }

  private async trim(owner: AvatarOwner): Promise<void> {
    const stale = await this.prisma.avatarPhoto.findMany({
      where: owner,
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: AVATAR_HISTORY_MAX,
      take: AVATAR_HISTORY_MAX,
    })
    for (const row of stale) await this.remove(row.id)
  }
}
