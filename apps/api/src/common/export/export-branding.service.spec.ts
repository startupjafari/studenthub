import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import { ExportBrandingService } from './export-branding.service'
import { EXPORT_LOCALES, exportLabels } from './export-labels'
import type { ExportContext } from './export-branding.types'

// Конфиг подменяем словарём: сервис читает только три ключа, поднимать ради этого
// ConfigModule дороже и медленнее.
function makeService(env: Partial<Record<keyof EnvVars, unknown>> = {}) {
  const values: Record<string, unknown> = {
    BRAND_NAME: 'StudentHub',
    APP_PUBLIC_URL: 'https://studenthub.kz',
    CORS_ORIGIN: 'http://localhost:3000',
    ...env,
  }
  const config = { get: jest.fn((key: string) => values[key]) }
  return new ExportBrandingService(config as unknown as ConfigService<EnvVars, true>)
}

// 12 сентября 2026, 21:30 UTC — в Алматы это уже 13 сентября, 03:30 следующего дня.
// Специально: на таком моменте видно, что дата считается в таймзоне вуза, а не сервера.
const AT = new Date('2026-09-12T21:30:00Z')

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    kind: 'users',
    actor: { id: 'u-1', fullName: 'Асанов Асан' },
    locale: 'ru',
    timezone: 'Asia/Almaty',
    generatedAt: AT,
    ...over,
  }
}

describe('ExportBrandingService', () => {
  describe('имя файла', () => {
    it('собирается по шаблону studenthub_{вид}_{дата}.{ext}', () => {
      expect(makeService().filename(ctx(), 'xlsx')).toBe('studenthub_users_2026-09-13.xlsx')
    })

    it('дата берётся в таймзоне вуза, а не сервера', () => {
      const service = makeService()
      // Тот же момент времени в двух таймзонах даёт разные календарные даты.
      expect(service.filename(ctx({ timezone: 'UTC' }), 'pdf')).toContain('2026-09-12')
      expect(service.filename(ctx({ timezone: 'Asia/Almaty' }), 'pdf')).toContain('2026-09-13')
    })

    it('название платформы приводится к латинице нижнего регистра', () => {
      expect(makeService({ BRAND_NAME: 'Student Hub KZ' }).filename(ctx(), 'csv')).toBe(
        'studenthubkz_users_2026-09-13.csv',
      )
    })

    it('название без латиницы не оставляет имя пустым', () => {
      expect(makeService({ BRAND_NAME: 'Студент' }).filename(ctx(), 'csv')).toBe(
        'export_users_2026-09-13.csv',
      )
    })
  })

  describe('заголовки ответа', () => {
    it('Content-Disposition несёт обе формы имени', () => {
      const header = makeService().disposition('studenthub_users_2026-09-13.xlsx')
      expect(header).toContain('filename="studenthub_users_2026-09-13.xlsx"')
      expect(header).toContain("filename*=UTF-8''studenthub_users_2026-09-13.xlsx")
    })

    it('кириллица уходит в filename* и не портит ASCII-форму', () => {
      const header = makeService().disposition('справка.pdf')
      // ASCII-форма — по одному подчёркиванию на нелатинский символ; сверяем форму, а не длину.
      expect(header).toMatch(/filename="_+\.pdf"/)
      expect(header).toContain("filename*=UTF-8''%D1%81%D0%BF%D1%80%D0%B0%D0%B2%D0%BA%D0%B0.pdf")
    })

    it('Content-Type задан для каждого формата', () => {
      const service = makeService()
      expect(service.contentType('pdf')).toBe('application/pdf')
      expect(service.contentType('xlsx')).toContain('spreadsheetml')
      expect(service.contentType('csv')).toContain('charset=utf-8')
    })
  })

  describe('метаданные', () => {
    it('PDF: автор — платформа, версия и домен из конфигурации', () => {
      const meta = makeService().pdfMetadata(ctx({ kind: 'resume' }))
      expect(meta.author).toBe('StudentHub')
      expect(meta.title).toBe('Резюме — StudentHub')
      expect(meta.creator).toMatch(/^StudentHub v/)
      expect(meta.producer).toBe('StudentHub — studenthub.kz')
      expect(meta.keywords).toContain('export')
      expect(meta.creationDate).toBe(AT)
    })

    it('PDF: персональных данных в свойствах документа нет', () => {
      const meta = makeService().pdfMetadata(ctx())
      const all = Object.values(meta).join(' ')
      expect(all).not.toContain('Асанов')
    })

    it('XLSX: свойства книги заполнены платформой', () => {
      const meta = makeService().sheetMetadata(ctx())
      expect(meta.Company).toBe('StudentHub')
      expect(meta.Category).toBe('Список пользователей')
      expect(meta.CreatedDate).toBe(AT)
    })

    it('дата выгрузки в теме письма-свойства указана с таймзоной', () => {
      expect(makeService().pdfMetadata(ctx()).subject).toContain('(Asia/Almaty)')
    })
  })

  describe('видимые строки', () => {
    it('шапка называет время с таймзоной и автора выгрузки', () => {
      const line = makeService().generatedLine(ctx())
      expect(line).toContain('Сформировано')
      expect(line).toContain('(Asia/Almaty)')
      expect(line).toContain('Асанов Асан')
    })

    it('колонтитул несёт платформу, домен и нумерацию страниц', () => {
      expect(makeService().footerLine(ctx(), 2, 5)).toBe('StudentHub · studenthub.kz · стр. 2 из 5')
    })

    it('нумерация подставляется на каждом языке', () => {
      const service = makeService()
      expect(service.footerLine(ctx({ locale: 'kk' }), 1, 3)).toContain('1 / 3 бет')
      expect(service.footerLine(ctx({ locale: 'en' }), 1, 3)).toContain('page 1 of 3')
    })
  })

  describe('происхождение выгрузки', () => {
    it('для листа «Инфо» — подписи на языке выгрузки', () => {
      const rows = makeService().infoRows(ctx({ params: { role: 'STUDENT', search: '' } }))
      expect(rows).toContainEqual(['Система', 'StudentHub — studenthub.kz'])
      expect(rows).toContainEqual(['Отчёт', 'Список пользователей'])
      // Пустой фильтр не попадает: строка «поиск=» ничего не сообщает.
      expect(rows).toContainEqual(['Фильтры', 'role=STUDENT'])
    })

    it('для JSON — машинные ключи и ISO, независимо от языка', () => {
      const service = makeService()
      const ru = service.provenance(ctx())
      const kk = service.provenance(ctx({ locale: 'kk' }))

      expect(Object.keys(ru)).toEqual(Object.keys(kk))
      expect(ru.report).toBe('users')
      expect(ru.exportedAt).toBe(AT.toISOString())
      expect(ru.timezone).toBe('Asia/Almaty')
    })
  })

  describe('язык документа', () => {
    it('неизвестное значение ?locale= откатывается на русский', () => {
      const service = makeService()
      expect(service.resolveLocale('kk')).toBe('kk')
      expect(service.resolveLocale('KK')).toBe('kk')
      expect(service.resolveLocale('de')).toBe('ru')
      expect(service.resolveLocale(undefined)).toBe('ru')
    })

    it('словарь заполнен для всех языков и всех видов выгрузки', () => {
      for (const locale of EXPORT_LOCALES) {
        const labels = exportLabels(locale)
        for (const value of Object.values({ ...labels, ...labels.kind })) {
          if (typeof value === 'string') expect(value.trim().length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('адрес платформы', () => {
    it('без APP_PUBLIC_URL берётся первый origin CORS_ORIGIN', () => {
      const service = makeService({
        APP_PUBLIC_URL: undefined,
        CORS_ORIGIN: 'https://app.studenthub.kz,https://admin.studenthub.kz',
      })
      expect(service.publicUrl).toBe('https://app.studenthub.kz')
      expect(service.domain).toBe('app.studenthub.kz')
    })

    it('хвостовой слэш не попадает в ссылки документов', () => {
      expect(makeService({ APP_PUBLIC_URL: 'https://studenthub.kz/' }).publicUrl).toBe(
        'https://studenthub.kz',
      )
    })
  })
})
