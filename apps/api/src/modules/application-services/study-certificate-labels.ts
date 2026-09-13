import type { ExportLocale } from '../../common/export/export-branding.types'
import type { StudyCertificateLabels } from './study-certificate-pdf'

// Подписи бланка справки об обучении на трёх языках (ru обязателен, kk — требование вуза).
//
// ВНИМАНИЕ: формулировки — рабочий перевод, а не утверждённая форма. Перед выпуском
// официальных справок их обязана вычитать канцелярия: у справки об обучении есть принятая
// формулировка тела («выдана в том, что…»), и она может отличаться от написанного здесь.
//
// Живут в модуле, который выпускает документ, а не в общем словаре брендирования: там
// подписи про выгрузку файла, здесь — содержание бланка.
//
// ФИО стоит отдельной строкой таблицы, а не внутри фразы: русский требует склонения
// («выдана Оспановой»), казахский — своих окончаний, и подставлять имя в предложение
// значило бы писать склонятор на три языка. Строка «Выдана: ФИО» верна всегда.

const RU: StudyCertificateLabels = {
  title: 'СПРАВКА ОБ ОБУЧЕНИИ',
  issuedTo: 'Выдана',
  body: 'Настоящая справка подтверждает, что указанное лицо является обучающимся университета.',
  faculty: 'Факультет',
  specialty: 'Специальность',
  course: 'Курс',
  studyForm: 'Форма обучения',
  educationLevel: 'Уровень образования',
  funding: 'Основа обучения',
  group: 'Группа',
  period: 'Период обучения',
  studentCard: 'Студенческий билет',
  purpose: 'Справка выдана для предъявления по месту требования.',
  number: '№',
  issuedAt: 'от',
  verification: 'Проверка подлинности документа',
}

const KK: StudyCertificateLabels = {
  title: 'ОҚУ ТУРАЛЫ АНЫҚТАМА',
  issuedTo: 'Берілді',
  body: 'Осы анықтама көрсетілген тұлғаның университет білім алушысы болып табылатынын растайды.',
  faculty: 'Факультет',
  specialty: 'Мамандық',
  course: 'Курс',
  studyForm: 'Оқу нысаны',
  educationLevel: 'Білім деңгейі',
  funding: 'Оқу негізі',
  group: 'Топ',
  period: 'Оқу кезеңі',
  studentCard: 'Студенттік билет',
  purpose: 'Анықтама талап етілетін жерге ұсыну үшін берілді.',
  number: '№',
  issuedAt: 'күні',
  verification: 'Құжаттың түпнұсқалығын тексеру',
}

const EN: StudyCertificateLabels = {
  title: 'CERTIFICATE OF ENROLMENT',
  issuedTo: 'Issued to',
  body: 'This certificate confirms that the person named above is a student of the university.',
  faculty: 'Faculty',
  specialty: 'Programme',
  course: 'Year',
  studyForm: 'Mode of study',
  educationLevel: 'Level of study',
  funding: 'Funding',
  group: 'Group',
  period: 'Period of study',
  studentCard: 'Student ID',
  purpose: 'Issued for presentation upon request.',
  number: 'No.',
  issuedAt: 'dated',
  verification: 'Verify this document',
}

export const STUDY_CERTIFICATE_LABELS: Record<ExportLocale, StudyCertificateLabels> = {
  ru: RU,
  kk: KK,
  en: EN,
}
