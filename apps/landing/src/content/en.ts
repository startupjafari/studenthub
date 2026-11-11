import type { Dictionary } from './types'

/** English — for international partners and accreditation bodies. */
export const en: Dictionary = {
  meta: {
    title: 'StudentHub — the whole university in one app',
    description:
      'A closed university platform: schedules, dean’s office requests, documents, coursework and communication. Access by university invitation only.',
  },

  nav: {
    product: 'What’s inside',
    modules: 'Modules',
    security: 'Security',
    rollout: 'Rollout',
    faq: 'Questions',
    login: 'Sign in',
    demo: 'Request a demo',
    menu: 'Menu',
    close: 'Close',
    sections: 'Page sections',
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
      {
        id: 'librarian',
        title: 'Librarian',
        points: [
          'Lending by scanning the digital student ID, returns by the QR sticker on the book',
          'No new loans for readers who are overdue or no longer study at the university',
          'Holds with a queue, collection reports and shelf inventory by scanning',
        ],
        nav: ['Library', 'Checkout', 'Check-in', 'Holds', 'Catalogue'],
        highlight: 'Overdue loans',
      },
      {
        id: 'securityGuard',
        title: 'Security',
        points: [
          'Student ID check at the entrance: the answer shows at once whether to let them in, and why not',
          'Visitor log: only the document type and its last four digits are stored',
          'Live university cameras — no audio, no recording',
        ],
        nav: ['Security post', 'Cameras', 'Rooms', 'Campus map'],
        highlight: 'Student passes',
      },
      {
        id: 'employer',
        title: 'Employer',
        points: [
          'Access to students is requested from each university separately',
          'A job post reaches students only after their university approves it',
          'An application pipeline — from viewed to interview and offer',
        ],
        nav: ['Overview', 'Jobs', 'Candidates', 'Universities', 'Team'],
        highlight: 'Company overview',
      },
    ],
  },

  modules: {
    title: 'What else the platform covers',
    subtitle:
      'Beyond studies and requests, there are sections for the whole campus. The library and cameras are switched on by the university itself: both are off by default.',
    items: [
      {
        id: 'campus',
        title: 'Campus map',
        text: 'The administration draws the floor plans, and a 3D model of the buildings is generated from them. A room can be found by search or straight from the timetable, and the route to it accounts for stairs and lifts.',
      },
      {
        id: 'library',
        title: 'Library',
        text: 'Students browse the catalogue with live availability and place holds. The librarian lends a book by scanning the digital student ID and sees who is overdue, and students get a no-debt certificate with a verification code on their own.',
      },
      {
        id: 'security',
        title: 'Security post and cameras',
        text: 'Security checks student IDs at the entrance and keeps the visitor log. Live camera feeds are visible only to security and the university administration — no audio, and the video is never recorded.',
      },
      {
        id: 'communication',
        title: 'Communication',
        text: 'Chats with voice messages and files, the university feed, 24-hour stories and articles on profiles. Writing to a stranger starts with a message request: until it is accepted, no more than five messages go through.',
      },
      {
        id: 'career',
        title: 'Careers',
        text: 'A company has its own page and job posts, but students see a post only after their university approves it. An application moves through to interview and offer, and a student’s profile is hidden from companies by default.',
      },
      {
        id: 'templates',
        title: 'Documents on the university’s letterhead',
        text: 'The university uploads its own Word template and places fields in it: full name, group, faculty. The platform fills them from the student’s record and will not issue the document if a required field is empty.',
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
    title: 'What the platform is made of',
    text: 'These numbers describe the product itself, not its customers: how many roles and languages it has, and the volume it holds on the test rig.',
    stats: [
      { value: 11, label: 'roles — from student to administration' },
      { value: 3, label: 'interface languages: Kazakh, Russian, English' },
      { value: 0, label: 'open sign-ups' },
      { value: 100, label: 'universities on the load rig', note: 'verified on a test environment' },
    ],
  },

  faq: {
    title: 'The questions asked first',
    verifyLink: 'Verification page',
    items: [
      {
        id: 'install',
        question: 'Do we need to install an app?',
        answer:
          'No. The platform runs in the browser and installs on a phone from the home screen — straight from the browser, with no app store involved. Native apps for iPhone and Android are being prepared for release.',
      },
      {
        id: 'access',
        question: 'How does a student get access?',
        answer:
          'By invitation from the dean’s office or the group leader. There is no self sign-up: an account starts from a personal link with the role already set.',
      },
      {
        id: 'languages',
        question: 'Which languages does the platform support?',
        answer: 'Kazakh, Russian and English — including error messages and notifications.',
      },
      {
        id: 'data',
        question: 'Where is the data stored?',
        answer:
          'Data residency — on the university’s own servers or in Kazakhstan — is agreed during the rollout.',
      },
      {
        id: 'employers',
        question: 'What do employers see?',
        answer:
          'Only students from universities that approved the company’s access. Contact details and grade average are shared with the student’s own consent.',
      },
      {
        id: 'verify',
        question: 'How is a certificate verified?',
        answer:
          'By the code on the form, on the verification page. It answers one question: the document is genuine and valid. A revoked certificate shows as revoked.',
      },
      {
        id: 'integrations',
        question: 'Are there integrations with university systems?',
        answer:
          'There are no ready-made connectors to university record systems yet — data moves as files. Student lists and the library collection are imported from CSV or Excel, user lists and analytics reports export to Excel and CSV, and documents are produced on the university’s own Word letterhead. For online events the organiser pastes a Zoom, Google Meet or Teams link; creating the meeting from inside the platform is not available yet. Anything else we discuss during the rollout.',
      },
      {
        id: 'price',
        question: 'How much does it cost?',
        answer:
          'The price depends on the university and is discussed in conversation. There are no tariffs on this page: selling to a university is a conversation, not a checkout.',
      },
    ],
  },

  cta: {
    title: 'Let’s discuss a pilot for your university',
    button: 'Request a pilot',
    mailSubject: 'StudentHub — university pilot',
  },

  footer: {
    tagline:
      'A closed platform for universities: studies, documents and communication in one place.',
    rights: 'All rights reserved.',
    language: 'Language',
    company: 'For companies',
    links: 'Platform and contact',
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    legal: 'Legal',
  },
}
