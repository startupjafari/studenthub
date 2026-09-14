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
    titleLines: ['The whole university', 'in one app'],
    subtitle:
      'Schedules, dean’s office requests, documents, coursework and communication. There is no sign-up: you get in by university invitation only.',
    ctaDemo: 'Request a demo',
    ctaProduct: 'See the platform',
    inviteHint: 'Got an invitation? Open the link from the email — it creates the account for you.',
  },

  scenes: {
    appName: 'StudentHub',
    notification: {
      title: 'Schedule change',
      text: 'Class moved to a different room',
      scheduleTitle: 'Today, Tuesday',
      pairName: 'Databases',
      pairTeacher: 'A. Asanova',
      roomBefore: 'Room 214',
      roomAfter: 'Room 312',
      changedLabel: 'Changed',
      nextPair: 'Algorithms and Data Structures',
      nextPairTime: '10:45',
    },
    schedule: {
      title: 'Tuesday, 16 September',
      nowLabel: 'Now',
      pairs: [
        { name: 'Databases', time: '09:00', room: 'Room 312' },
        { name: 'Algorithms and Data Structures', time: '10:45', room: 'Room 204' },
        { name: 'English', time: '13:00', room: 'Room 118' },
        { name: 'Physical Education', time: '14:45', room: 'Gym' },
      ],
    },
    request: {
      screenTitle: 'My requests',
      title: 'Request SH-2026-004182',
      service: 'Proof of enrolment',
      steps: ['Submitted', 'In review', 'Preparing', 'Ready'],
      etaLabel: 'Deadline by policy',
      eta: '2 working days',
      attachments: ['ID document', 'Family composition certificate'],
    },
    room: {
      scanHint: 'Point the camera at the sticker by the door',
      roomName: 'Room 312',
      statusBusy: 'Busy',
      busyUntil: 'until 15:50',
      pairName: 'Databases',
      group: 'IS-21-3',
      nextFree: 'Free from 15:50',
    },
    studentId: {
      screenTitle: 'My documents',
      cardLabel: 'Student ID',
      name: 'Aigerim Nurlanova',
      faculty: 'Information Technology',
      group: 'IS-21-3',
      validLabel: 'Valid until',
      valid: '2027',
      passHint: 'Show it at the front desk or to a teacher',
      offlineBadge: 'Works offline',
    },
  },

  doors: {
    title: 'You’ve reached the platform’s front page',
    subtitle: 'Pick what you need — all three doors lead to working sections.',
    action: 'Open',
    student: {
      title: 'I study or work at a university',
      text: 'Sign in with your email or username. Forgot the password — reset it on the same page.',
    },
    company: {
      title: 'We’re a company looking for students',
      text: 'Register your company and request access to a university. The only role that signs up on its own.',
    },
    verify: {
      title: 'I have a document with a verification code',
      text: 'Enter the code from the certificate — the platform confirms the university issued it.',
    },
  },

  day: {
    title: 'A student’s day',
    subtitle:
      'The platform isn’t a set of modules — it’s a day where nothing gets lost. Five moments, from the morning notification to the pass at the front desk.',
    timelineLabel: 'Moments of the day',
    frames: [
      {
        time: '07:40',
        label: 'Notification',
        scene: 'notification',
        title: 'Room change',
        text: 'The notification arrives on its own. Not a rumour in a group chat, not a note on a board: moving a class is an event in the system, and everyone it concerns sees it.',
      },
      {
        time: '09:00',
        label: 'Class',
        scene: 'schedule',
        title: 'Today’s schedule',
        text: 'Classes, rooms, teachers, gaps between them. Opens without internet too — the schedule is stored on the device.',
      },
      {
        time: '12:15',
        label: 'Certificate',
        scene: 'request',
        title: 'A certificate in two days',
        text: 'A catalogue of dean’s office services: deadline, required documents, request status. The student comes in once — to collect the result.',
      },
      {
        time: '14:30',
        label: 'Room',
        scene: 'room',
        title: 'Door 312',
        text: 'Every room has a printed QR sticker. Point the camera and see it at once: free, or busy until 15:50 — which class, and whose.',
      },
      {
        time: '18:00',
        label: 'Pass',
        scene: 'studentId',
        title: 'Student ID in the phone',
        text: 'A digital student card with holographic protection. Shows offline, verified by staff in a second.',
      },
    ],
  },

  roles: {
    title: 'Eight roles — one platform',
    subtitle:
      'Everyone sees their own view: not because the rest is hidden in the interface, but because the data scope is set by the role and read from the token.',
    tabs: [
      {
        id: 'student',
        title: 'Student',
        text: 'Own schedule, dean’s office requests, documents, assignments and grades, the university feed and group chats.',
        nav: ['Today', 'Schedule', 'Requests', 'Grades'],
        highlight: 'Upcoming classes',
        rights: [
          'Sees their own schedule and grades',
          'Submits requests to the dean’s office',
          'Classmates’ data stays closed to them',
        ],
        scope: 'scope: group.own · schedule.own',
        rows: [
          { title: 'Databases', meta: 'A. Asanova · Room 312', value: '09:00' },
          {
            title: 'Algorithms and Data Structures',
            meta: 'D. Yerlanov · Room 204',
            value: '10:45',
          },
          { title: 'English', meta: 'O. Kim · Room 118', value: '13:00' },
        ],
      },
      {
        id: 'starosta',
        title: 'Group leader',
        text: 'Everything a student has, plus coordinating the group: attendance, group requests, announcements to classmates.',
        nav: ['Attendance', 'Group', 'Group requests', 'Announcements'],
        highlight: 'Attendance · IS-21-3',
        rights: [
          'Marks attendance for their group',
          'Files group requests to the dean’s office',
          'Classmates’ grades stay closed to them',
        ],
        scope: 'scope: group.own',
        rows: [
          { title: 'Aigerim Nurlanova', meta: 'IS-21-3', value: 'Present' },
          { title: 'Damir Seitkali', meta: 'IS-21-3', value: 'Late' },
          { title: 'Anna Volkova', meta: 'IS-21-3', value: 'Absent' },
        ],
      },
      {
        id: 'teacher',
        title: 'Teacher',
        text: 'Own classes and groups, course materials, assignments and grade sheets, consultations, subject chats.',
        nav: ['Grade sheets', 'My classes', 'Assignments', 'Consultations'],
        highlight: 'Grade sheet · Databases',
        rights: [
          'Grades their own groups',
          'Sees only their own subjects',
          'Reviews assignments and holds consultations',
        ],
        scope: 'scope: courses.own · groups.assigned',
        rows: [
          { title: 'Aigerim Nurlanova', meta: 'IS-21-3', value: '92' },
          { title: 'Damir Seitkali', meta: 'IS-21-3', value: '78' },
          { title: 'Anna Volkova', meta: 'IS-21-3', value: '85' },
        ],
      },
      {
        id: 'dean',
        title: 'Dean',
        text: 'The whole faculty: schedule, the request queue with deadlines, academic performance, faculty announcements.',
        nav: ['Requests', 'Faculty', 'Schedule', 'Performance'],
        highlight: 'Requests in review',
        rights: [
          'Handles requests from their faculty',
          'Edits the faculty schedule',
          'Invites teachers and group leaders',
        ],
        scope: 'scope: faculty.own',
        rows: [
          { title: 'Proof of enrolment', meta: 'A. Nurlanova · SH-2026-004182', value: '2 days' },
          { title: 'Academic leave', meta: 'D. Seitkali · SH-2026-004179', value: '5 days' },
          { title: 'Transfer to a grant', meta: 'A. Volkova · SH-2026-004174', value: 'Overdue' },
        ],
      },
      {
        id: 'universityModerator',
        title: 'University moderator',
        text: 'Complaints and disputed content within their university: handling reports, hiding violations, checking documents.',
        nav: ['Complaints', 'Moderation', 'Document requests', 'Announcements'],
        highlight: 'Complaints in review',
        rights: [
          'Handles complaints from their university',
          'Hides content that breaks the rules',
          'Does not change the university structure',
        ],
        scope: 'scope: university.own · content',
        rows: [
          { title: 'Insult in a group chat', meta: 'Report on a message', value: 'New' },
          { title: 'Spam in the faculty feed', meta: 'Report on a post', value: 'In progress' },
          { title: 'Photo without consent', meta: 'Report on a profile', value: 'Closed' },
        ],
      },
      {
        id: 'universityAdmin',
        title: 'University admin',
        text: 'University structure, faculties and groups, staff invitations, service catalogue, analytics.',
        nav: ['Faculties', 'Groups', 'Invitations', 'Analytics'],
        highlight: 'University structure',
        rights: [
          'Creates faculties, departments and groups',
          'Invites deans and staff',
          'Configures the dean’s office service catalogue',
        ],
        scope: 'scope: university.own',
        rows: [
          { title: 'Information Technology', meta: '12 departments · 48 groups', value: '1,240' },
          { title: 'Economics and Business', meta: '8 departments · 31 groups', value: '870' },
          { title: 'Engineering', meta: '10 departments · 39 groups', value: '1,050' },
        ],
      },
      {
        id: 'platformModerator',
        title: 'Platform moderator',
        text: 'Global moderation: complaints from every university, disputed content, the audit log.',
        nav: ['Complaints', 'Moderation', 'Audit log', 'Universities'],
        highlight: 'Moderation queue',
        rights: [
          'Moderates content across all universities',
          'Sees the platform audit log',
          'Does not manage users',
        ],
        scope: 'scope: platform · content',
        rows: [
          { title: 'KazNU · post report', meta: 'Escalated by the university', value: 'New' },
          { title: 'ENU · chat report', meta: 'Repeated', value: 'In progress' },
          { title: 'KBTU · profile report', meta: 'From the feed', value: 'Closed' },
        ],
      },
      {
        id: 'platformAdmin',
        title: 'Platform admin',
        text: 'All universities, global settings, invitations for university admins and the audit log.',
        nav: ['Universities', 'Users', 'Audit log', 'Settings'],
        highlight: 'Universities on the platform',
        rights: [
          'Creates universities on the platform',
          'Issues invitations to university admins',
          'Sees the entire audit log',
        ],
        scope: 'scope: platform',
        rows: [
          { title: 'Al-Farabi KazNU', meta: 'Almaty · 18 faculties', value: 'Active' },
          { title: 'Gumilyov ENU', meta: 'Astana · 14 faculties', value: 'Active' },
          { title: 'KBTU', meta: 'Almaty · 6 faculties', value: 'Onboarding' },
        ],
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
        question: 'Can I sign up myself?',
        answer:
          'No. The university issues the account through a personal invitation link. The one exception is employer companies: they register themselves, but see no students until a university approves them.',
      },
      {
        question: 'Where is student data stored?',
        answer:
          'The university itself is the data controller. The platform processes data on its instructions and only to the extent the service requires — this is fixed in the documents.',
      },
      {
        question: 'Is there a mobile app?',
        answer:
          'The platform installs on the phone straight from the browser and behaves like a normal app, notifications and offline mode included. No separate store install required.',
      },
      {
        question: 'We already have our own system. What then?',
        answer:
          'We discuss it on the demo: what to keep, what to replace, how to migrate the data. The platform takes the university structure as a spreadsheet, so a move usually takes days rather than months.',
      },
      {
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
