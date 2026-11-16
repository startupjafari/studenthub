import { Role } from '@studenthub/shared-types'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AppException } from '../../common/exceptions/app.exception'
import { DocumentTemplatesController } from './document-templates.controller'
import { DOCX_MIME } from './document-templates.service'

const user = {
  sub: 'admin-1',
  role: Role.UNIVERSITY_ADMIN,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function reply() {
  const headers: Record<string, string> = {}
  const r: { header: jest.Mock; send: jest.Mock } = {
    header: jest.fn((k: string, v: string): unknown => {
      headers[k] = v
      return r
    }),
    send: jest.fn().mockResolvedValue(undefined),
  }
  return { r, headers }
}

const req = { ip: '10.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as FastifyRequest

describe('DocumentTemplatesController — скачивание DOCX', () => {
  it('отдаёт сформированный документ файлом с кириллическим именем и без кэша', async () => {
    const buffer = Buffer.from('docx')
    const templates = {
      generateForStudent: jest.fn().mockResolvedValue({ buffer, filename: 'Справка.docx' }),
    }
    const controller = new DocumentTemplatesController(templates as never)
    const { r, headers } = reply()

    await controller.generate(
      user,
      't-1',
      { studentId: 'stu-1' },
      req,
      r as unknown as FastifyReply,
    )

    expect(templates.generateForStudent).toHaveBeenCalledWith(user, 't-1', 'stu-1', {
      ip: '10.0.0.1',
      userAgent: 'jest',
    })
    expect(headers['content-type']).toBe(DOCX_MIME)
    expect(headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('Справка.docx')}`,
    )
    expect(headers['cache-control']).toBe('no-store')
    expect(r.send).toHaveBeenCalledWith(buffer)
  })

  it('файл больше порога буферной загрузки — FILE_TOO_LARGE, а не presigned', async () => {
    const controller = new DocumentTemplatesController({} as never)
    const tooBig = {
      ...req,
      file: jest.fn().mockResolvedValue({
        filename: 'a.docx',
        toBuffer: jest.fn().mockRejectedValue({ code: 'FST_REQ_FILE_TOO_LARGE' }),
      }),
    } as unknown as FastifyRequest
    const error = await controller.upload(user, 't-1', tooBig).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppException)
    expect((error as AppException).code).toBe('FILE_TOO_LARGE')
  })
})
