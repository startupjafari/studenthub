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
    title: 'Being closed is the architecture, not a setting',
    subtitle:
      'A university answers for the personal data of thousands of students. So protection here is built into the architecture rather than bolted on as checks.',
    points: [
      {
        title: 'There is no public sign-up',
        text: 'Only a personal invitation link from a higher role creates an account. An outsider has nowhere to come from.',
      },
      {
        title: 'Permissions come from the token',
        text: 'The role and the data scope — university, faculty, group — come from the token, not the request. They can’t be swapped client-side.',
      },
      {
        title: 'Tokens never sit in the browser',
        text: 'Neither in localStorage nor in sessionStorage. A stray script on the page can’t steal the session.',
      },
      {
        title: 'Files live in private storage',
        text: 'Documents and attachments are served through one-time links and only after a permission check. A file has no public address.',
      },
      {
        title: 'Access to someone else’s data is logged',
        text: 'Who accessed what, and why, goes into the audit log. That includes platform administrators.',
      },
      {
        title: 'Two-factor authentication',
        text: 'Mandatory for university staff. And the data controller is the university itself, not the platform.',
      },
    ],
  },

  rollout: {
    title: 'How a university starts',
    subtitle:
      'The university unfolds top-down along the invitation chain. By lists, not person by person.',
    steps: [
      {
        title: 'We create the university',
        text: 'We set it up on the platform and issue an invitation to its administrator.',
      },
      {
        title: 'The admin uploads the structure',
        text: 'Faculties, departments, groups and staff — as a list from a CSV or XLSX file.',
      },
      {
        title: 'Deans invite teachers',
        text: 'Each dean invites their teachers and group leaders — within their faculty.',
      },
      {
        title: 'Group leaders invite students',
        text: 'A student opens the link and is straight inside — with their schedule and their group.',
      },
    ],
    note: 'No exports from legacy systems and no six-month integration project: the structure loads from a spreadsheet, and the platform takes it from there.',
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
