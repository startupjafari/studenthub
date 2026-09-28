import type { Dictionary } from './types'

/** English — for international partners and accreditation bodies. */
export const en: Dictionary = {
  meta: {
    title: 'StudentHub — the whole university in one app',
    description:
      'A closed university platform: schedules, dean’s office requests, documents, coursework and communication. Access by university invitation only.',
    languageName: 'English',
  },

  nav: {
    product: 'What’s inside',
    security: 'Security',
    rollout: 'Rollout',
    faq: 'Questions',
    login: 'Sign in',
    demo: 'Request a demo',
    menu: 'Menu',
    close: 'Close',
  },

  hero: {
    eyebrow: 'A closed university platform',
    titleLines: ['Students visit the dean’s office', 'only to collect the result'],
    subtitle:
      'Timetables, requests and certificates, documents, chats and university news — in one closed app. Access is by invitation only.',
    ctaDemo: 'Discuss a rollout',
    ctaLogin: 'Sign in',
  },

  doors: {
    title: 'Why you are here',
    subtitle:
      'Different people land on this domain. Universities start a conversation, members sign in, companies register separately.',
    university: {
      title: 'For universities',
      text: 'Shorter queues at the dean’s office: timetable changes reach students at once, and university data stays under the university’s control.',
      action: 'Discuss a rollout',
    },
    people: {
      title: 'For students and staff',
      text: 'You cannot sign up on your own — the dean’s office or your group leader issues the invitation. Point your camera at the QR sticker by a classroom door to see whether the room is free and which class is running.',
      action: 'Sign in',
      actionAccess: 'How to get access',
    },
    company: {
      title: 'For companies',
      text: 'Employers register themselves but only see students from universities that approved their access. Contact details and grade average are shared only with the student’s consent.',
      action: 'Register a company',
    },
  },

  roles: {
    title: 'What each person sees',
    subtitle:
      'A role defines more than a set of sections: it defines the data boundary, so a request never reaches beyond your own group, faculty or university.',
    appName: 'StudentHub',
    tabs: [
      {
        id: 'student',
        title: 'Student',
        points: [
          'A moved class arrives as a notification, with the timetable already updated',
          'Enrolment certificates are ordered from the phone, with status and due date visible',
          'A personal document vault',
        ],
        nav: ['Timetable', 'Requests', 'Documents', 'Grades', 'Chats'],
        highlight: 'Timetable for the week',
      },
      {
        id: 'starosta',
        title: 'Group leader',
        points: [
          'Announcements and group coordination',
          'Invitations for classmates',
          'No access to classmates’ grades, requests or documents',
        ],
        nav: ['My group', 'Announcements', 'Invitations', 'Timetable', 'Chats'],
        highlight: 'My group',
      },
      {
        id: 'teacher',
        title: 'Lecturer',
        points: [
          'Grade book and attendance marked by QR',
          'Assignments and submission review',
          'Office hours by appointment',
        ],
        nav: ['Grade book', 'Attendance', 'Assignments', 'Office hours', 'Timetable'],
        highlight: 'Group grade book',
      },
      {
        id: 'dean',
        title: 'Dean’s office',
        points: [
          'A request queue with due dates',
          'The faculty timetable',
          'Students at risk with the reason stated — absences, debts, low grades',
        ],
        nav: ['Requests', 'Faculty timetable', 'Students', 'At risk', 'Reports'],
        highlight: 'Request queue',
      },
      {
        id: 'universityAdmin',
        title: 'University administration',
        points: [
          'University structure and invitations',
          'Analytics on attendance, room load and the flow of requests',
          'Moderation',
        ],
        nav: ['Structure', 'Invitations', 'Analytics', 'Moderation', 'Settings'],
        highlight: 'University structure',
      },
    ],
  },

  security: {
    title: 'What protects the university',
    subtitle:
      'Every point below is verifiable during the demo: this is how the platform works today, not what is planned.',
    points: [
      {
        title: 'A closed platform',
        text: 'There is no public sign-up. An account starts from a personal invitation with the role set in advance.',
      },
      {
        title: 'Everyone sees their own',
        text: 'Access is bounded by the role and by your own group, faculty or university. A request never crosses that boundary.',
      },
      {
        title: 'Two-factor sign-in',
        text: 'Required for university administration, moderators and the dean’s office — everyone who handles other people’s data.',
      },
      {
        title: 'Documents stay protected',
        text: 'A document number is shown masked. The file opens through a temporary link and only after the rights are checked.',
      },
      {
        title: 'An access log',
        text: 'Private messages can be opened only on a complaint, and every such access is recorded.',
      },
      {
        title: 'Verifiable certificates',
        text: 'A bank or an embassy verifies a certificate issued through the platform by the code printed on it. A revoked one shows as revoked.',
      },
    ],
  },

  rollout: {
    title: 'How a rollout goes',
    subtitle:
      'The order of the steps is set by the platform itself: it will not let you invite a student before their dean exists.',
    steps: [
      {
        title: 'A conversation and a demo',
        text: 'We show the platform on a test environment and go through how your university is organised.',
      },
      {
        title: 'University structure',
        text: 'Faculties, groups, rooms and the timetable — the base everything else stands on.',
      },
      {
        title: 'Invitations',
        text: 'Student lists are imported from CSV or Excel, up to 500 rows at a time. Then down the chain: dean → group leaders → students.',
      },
      {
        title: 'Go live',
        text: 'QR stickers on classroom doors, and the first week runs with our support.',
      },
    ],
  },

  scale: {
    title: 'Tested at a real scale',
    text: 'We don’t claim how many universities “trust us”. Instead — the environment the platform is tested against every release.',
    stats: [
      { value: 100, label: 'universities in the test environment' },
      { value: 130000, label: 'users' },
      { value: 21, unit: 'M', label: 'rows of data' },
      { value: 8, label: 'roles in one platform' },
    ],
    facts: [
      {
        title: 'A real volume',
        text: 'Lists, search and the feed work against that environment, not a demo database of twenty students.',
      },
      {
        title: 'Three languages',
        text: 'Russian, Kazakh and English — in full, including error and notification texts.',
      },
      {
        title: 'Works offline',
        text: 'Installs on the phone as an app. The schedule and the student card open without a network.',
      },
    ],
  },

  faq: {
    title: 'The questions people ask first',
    items: [
      {
        id: 'access',
        question: 'Can I sign up myself?',
        answer:
          'No. The university issues the account through a personal invitation link. The one exception is employer companies: they register themselves, but see no students until a university approves them.',
      },
      {
        id: 'data',
        question: 'Where is student data stored?',
        answer:
          'The university itself is the data controller. The platform processes data on its instructions and only to the extent the service requires — this is fixed in the documents.',
      },
      {
        id: 'app',
        question: 'Is there a mobile app?',
        answer:
          'The platform installs on the phone straight from the browser and behaves like a normal app, notifications and offline mode included. No separate store install required.',
      },
      {
        id: 'integrations',
        question: 'We already have our own system. What then?',
        answer:
          'We discuss it on the demo: what to keep, what to replace, how to migrate the data. The platform takes the university structure as a spreadsheet, so a move usually takes days rather than months.',
      },
      {
        id: 'price',
        question: 'How much does it cost?',
        answer:
          'It depends on the number of students and the set of modules. We’ll give you the figure on the call, once we understand what you actually need.',
      },
    ],
  },

  cta: {
    title: 'Let’s show the platform to your university',
    text: 'A forty-minute call: we walk through the roles, show the dean’s office and the schedule on your scenarios, and answer questions about data and security.',
    button: 'Write to us',
    mailSubject: 'StudentHub demo for a university',
  },

  footer: {
    tagline: 'A closed multi-role education platform for universities.',
    rights: 'All rights reserved.',
    language: 'Language',
  },
}
