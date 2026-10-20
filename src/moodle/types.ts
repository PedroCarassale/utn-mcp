/** Tipos mínimos de las respuestas de Moodle que usa el servidor. */

export interface SiteInfo {
  sitename: string;
  username: string;
  firstname: string;
  lastname: string;
  fullname: string;
  lang: string;
  userid: number;
  siteurl: string;
  userpictureurl?: string;
  release?: string;
  version?: string;
  functions: { name: string; version: string }[];
  advancedfeatures?: { name: string; value: number }[];
}

export interface Course {
  id: number;
  shortname: string;
  fullname: string;
  displayname?: string;
  idnumber?: string;
  visible?: number;
  hidden?: boolean;
  summary?: string;
  startdate?: number;
  enddate?: number;
  lastaccess?: number;
  progress?: number | null;
  category?: number;
  coursecategory?: string;
  viewurl?: string;
}

export interface ModuleContent {
  type: string;
  filename: string;
  filepath: string | null;
  filesize: number;
  fileurl?: string;
  timecreated?: number | null;
  timemodified?: number | null;
  mimetype?: string;
  author?: string | null;
  content?: string;
}

export interface ModuleDate {
  label: string;
  timestamp: number;
  dataid?: string;
}

export interface CourseModule {
  id: number;
  url?: string;
  name: string;
  instance: number;
  contextid?: number;
  visible?: number;
  uservisible?: boolean;
  visibleoncoursepage?: number;
  modname: string;
  modplural?: string;
  description?: string;
  availabilityinfo?: string;
  dates?: ModuleDate[];
  contents?: ModuleContent[];
  contentsinfo?: { filescount: number; filessize: number; mimetypes: string[] };
  completiondata?: { state: number };
}

export interface CourseSection {
  id: number;
  name: string;
  visible?: number;
  summary?: string;
  section?: number;
  uservisible?: boolean;
  modules: CourseModule[];
}

export interface ActionEvent {
  id: number;
  name: string;
  description?: string;
  modulename?: string;
  activityname?: string;
  course?: { id: number; fullname: string; shortname: string };
  timestart: number;
  timeduration: number;
  timesort: number;
  url?: string;
  eventtype?: string;
  action?: { name: string; url: string; actionable: boolean };
  overdue?: boolean;
}

export interface CalendarEvent {
  id: number;
  name: string;
  description?: string;
  courseid?: number;
  modulename?: string;
  instance?: number;
  eventtype?: string;
  timestart: number;
  timeduration: number;
  visible?: number;
}

export interface Assignment {
  id: number;
  cmid: number;
  course: number;
  name: string;
  duedate: number;
  allowsubmissionsfromdate: number;
  cutoffdate: number;
  gradingduedate?: number;
  grade?: number;
  nosubmissions?: number;
  submissiondrafts?: number;
  requiresubmissionstatement?: number;
  teamsubmission?: number;
  maxattempts?: number;
  intro?: string;
  introattachments?: ModuleContent[];
  configs?: { plugin: string; subtype: string; name: string; value: string }[];
}

export interface Forum {
  id: number;
  course: number;
  type: string;
  name: string;
  intro?: string;
  cmid: number;
  numdiscussions?: number;
}

export interface ForumDiscussion {
  id: number;
  discussion: number;
  name: string;
  subject: string;
  message: string;
  userfullname?: string;
  created: number;
  modified: number;
  timemodified: number;
  numreplies: number;
  numunread?: number;
  pinned?: boolean;
  attachments?: { filename: string; fileurl: string; filesize: number; mimetype?: string }[];
}

export interface ForumPost {
  id: number;
  subject: string;
  message: string;
  author?: { id: number; fullname: string };
  parentid?: number | null;
  hasparent?: boolean;
  timecreated: number;
  attachments?: { filename: string; fileurl: string; filesize: number; mimetype?: string }[];
}

export interface Conversation {
  id: number;
  name?: string | null;
  type: number;
  membercount: number;
  unreadcount?: number | null;
  isread?: boolean;
  members: { id: number; fullname: string }[];
  messages: Message[];
}

export interface Message {
  id: number;
  useridfrom: number;
  text: string;
  timecreated: number;
}

export interface Notification {
  id: number;
  useridfrom: number;
  subject: string;
  text?: string;
  fullmessage?: string;
  fullmessagehtml?: string;
  smallmessage?: string;
  contexturl?: string | null;
  contexturlname?: string | null;
  timecreated: number;
  timeread?: number | null;
  read: boolean;
  component?: string;
  eventtype?: string;
}

export interface Quiz {
  id: number;
  coursemodule: number;
  course: number;
  name: string;
  intro?: string;
  timeopen?: number;
  timeclose?: number;
  timelimit?: number;
  attempts?: number;
  grade?: number;
  sumgrades?: number;
}

export interface QuizAttempt {
  id: number;
  quiz: number;
  attempt: number;
  state: string;
  timestart: number;
  timefinish: number;
  sumgrades?: number | null;
}

export interface GradeItem {
  id: number;
  itemname: string | null;
  itemtype: string;
  itemmodule?: string | null;
  cmid?: number;
  graderaw?: number | null;
  gradeformatted?: string;
  grademin?: number;
  grademax?: number;
  percentageformatted?: string;
  feedback?: string;
  gradedategraded?: number | null;
  weightformatted?: string;
  rangeformatted?: string;
}

export interface Page {
  id: number;
  coursemodule: number;
  course: number;
  name: string;
  intro?: string;
  content?: string;
  contentfiles?: ModuleContent[];
}
