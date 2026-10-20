import type { MoodleClient } from "./client.js";
import type {
  ActionEvent,
  Assignment,
  CalendarEvent,
  Conversation,
  Course,
  CourseSection,
  Forum,
  ForumDiscussion,
  ForumPost,
  GradeItem,
  Message,
  Notification,
  Page,
  Quiz,
  QuizAttempt,
  SiteInfo,
} from "./types.js";

/** Funciones tipadas sobre el cliente REST. Una por wsfunction que usamos. */

export const getSiteInfo = (c: MoodleClient) => c.call<SiteInfo>("core_webservice_get_site_info");

export async function getUserCourses(c: MoodleClient, userid: number): Promise<Course[]> {
  return c.call<Course[]>("core_enrol_get_users_courses", { userid, returnusercount: 0 });
}

export type Classification = "all" | "inprogress" | "past" | "future" | "favourites" | "hidden";

export async function getCoursesByClassification(
  c: MoodleClient,
  classification: Classification,
): Promise<Course[]> {
  const res = await c.call<{ courses: Course[] }>(
    "core_course_get_enrolled_courses_by_timeline_classification",
    { classification, limit: 0, offset: 0, sort: "fullname" },
  );
  return res.courses;
}

export async function getCourseContents(c: MoodleClient, courseid: number): Promise<CourseSection[]> {
  return c.call<CourseSection[]>("core_course_get_contents", { courseid });
}

export async function getCourseModule(c: MoodleClient, cmid: number) {
  const res = await c.call<{ cm: any }>("core_course_get_course_module", { cmid });
  return res.cm as {
    id: number;
    course: number;
    name: string;
    modname: string;
    instance: number;
    section: number;
    sectionnum: number;
    visible: number;
  };
}

export async function getActionEvents(
  c: MoodleClient,
  from: number,
  to: number,
  limit = 50,
): Promise<ActionEvent[]> {
  const out: ActionEvent[] = [];
  let aftereventid: number | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await c.call<{ events: ActionEvent[]; lastid?: number }>(
      "core_calendar_get_action_events_by_timesort",
      {
        timesortfrom: from,
        timesortto: to,
        limitnum: Math.min(limit, 50),
        limittononsuspendedevents: 1,
        ...(aftereventid ? { aftereventid } : {}),
      },
    );
    out.push(...res.events);
    if (res.events.length < Math.min(limit, 50) || !res.lastid) break;
    aftereventid = res.lastid;
    if (out.length >= limit) break;
  }
  return out;
}

export async function getCalendarEvents(
  c: MoodleClient,
  courseids: number[],
  from: number,
  to: number,
): Promise<CalendarEvent[]> {
  const res = await c.call<{ events: CalendarEvent[] }>("core_calendar_get_calendar_events", {
    events: { courseids },
    options: { userevents: 1, siteevents: 1, timestart: from, timeend: to, ignorehidden: 1 },
  });
  return res.events;
}

export async function getAssignments(c: MoodleClient, courseids: number[] = []) {
  const res = await c.call<{
    courses: { id: number; fullname: string; shortname: string; assignments: Assignment[] }[];
  }>("mod_assign_get_assignments", { courseids, includenotenrolledcourses: 0 });
  return res.courses;
}

export async function getSubmissionStatus(c: MoodleClient, assignid: number) {
  return c.call<any>("mod_assign_get_submission_status", { assignid });
}

export async function getOverviewGrades(c: MoodleClient, userid: number) {
  const res = await c.call<{ grades: { courseid: number; grade: string; rawgrade: string }[] }>(
    "gradereport_overview_get_course_grades",
    { userid },
  );
  return res.grades;
}

export async function getUserGradeItems(c: MoodleClient, courseid: number, userid: number) {
  const res = await c.call<{ usergrades: { courseid: number; gradeitems: GradeItem[] }[] }>(
    "gradereport_user_get_grade_items",
    { courseid, userid },
  );
  return res.usergrades[0]?.gradeitems ?? [];
}

export async function getForums(c: MoodleClient, courseids: number[]): Promise<Forum[]> {
  return c.call<Forum[]>("mod_forum_get_forums_by_courses", { courseids });
}

export async function getForumDiscussions(c: MoodleClient, forumid: number, page = 0, perpage = 20) {
  const res = await c.call<{ discussions: ForumDiscussion[] }>("mod_forum_get_forum_discussions", {
    forumid,
    sortorder: 1,
    page,
    perpage,
  });
  return res.discussions;
}

export async function getDiscussionPosts(c: MoodleClient, discussionid: number) {
  const res = await c.call<{ posts: ForumPost[] }>("mod_forum_get_discussion_posts", {
    discussionid,
    sortby: "created",
    sortdirection: "ASC",
  });
  return res.posts;
}

export async function getConversations(c: MoodleClient, userid: number, limit = 20, offset = 0) {
  const res = await c.call<{ conversations: Conversation[] }>("core_message_get_conversations", {
    userid,
    limitfrom: offset,
    limitnum: limit,
  });
  return res.conversations;
}

export async function getConversationMessages(
  c: MoodleClient,
  userid: number,
  convid: number,
  limit = 50,
) {
  return c.call<{ id: number; members: { id: number; fullname: string }[]; messages: Message[] }>(
    "core_message_get_conversation_messages",
    { currentuserid: userid, convid, limitfrom: 0, limitnum: limit, newest: 1 },
  );
}

export async function getNotifications(c: MoodleClient, userid: number, limit = 20, offset = 0) {
  return c.call<{ notifications: Notification[]; unreadcount: number }>(
    "message_popup_get_popup_notifications",
    { useridto: userid, newestfirst: 1, limit, offset },
  );
}

export async function getQuizzes(c: MoodleClient, courseids: number[]): Promise<Quiz[]> {
  const res = await c.call<{ quizzes: Quiz[] }>("mod_quiz_get_quizzes_by_courses", { courseids });
  return res.quizzes;
}

export async function getQuizAttempts(c: MoodleClient, quizid: number): Promise<QuizAttempt[]> {
  const res = await c.call<{ attempts: QuizAttempt[] }>("mod_quiz_get_user_attempts", {
    quizid,
    status: "all",
    includepreviews: 0,
  });
  return res.attempts;
}

export async function getQuizBestGrade(c: MoodleClient, quizid: number) {
  return c.call<{ hasgrade: boolean; grade?: number }>("mod_quiz_get_user_best_grade", { quizid });
}

export async function getPages(c: MoodleClient, courseids: number[]): Promise<Page[]> {
  const res = await c.call<{ pages: Page[] }>("mod_page_get_pages_by_courses", { courseids });
  return res.pages;
}

export async function getUrls(c: MoodleClient, courseids: number[]) {
  const res = await c.call<{ urls: { id: number; coursemodule: number; name: string; intro?: string; externalurl: string }[] }>(
    "mod_url_get_urls_by_courses",
    { courseids },
  );
  return res.urls;
}

/* ----------------------------- escritura ----------------------------- */

export async function uploadDraftFile(
  c: MoodleClient,
  userid: number,
  filename: string,
  base64: string,
  itemid = 0,
) {
  return c.call<{ itemid: number; filename: string; url: string }>("core_files_upload", {
    contextlevel: "user",
    instanceid: userid,
    component: "user",
    filearea: "draft",
    itemid,
    filepath: "/",
    filename,
    filecontent: base64,
  });
}

export async function saveSubmission(
  c: MoodleClient,
  assignmentid: number,
  plugindata: Record<string, unknown>,
) {
  return c.call<{ item?: string; warningcode?: string; message?: string }[]>("mod_assign_save_submission", {
    assignmentid,
    plugindata,
  });
}

export async function submitForGrading(c: MoodleClient, assignmentid: number) {
  return c.call<any[]>("mod_assign_submit_for_grading", {
    assignmentid,
    acceptsubmissionstatement: 1,
  });
}

export async function sendInstantMessage(c: MoodleClient, touserid: number, text: string) {
  return c.call<{ msgid: number; errormessage?: string }[]>("core_message_send_instant_messages", {
    messages: [{ touserid, text, textformat: 0 }],
  });
}

export async function sendToConversation(c: MoodleClient, conversationid: number, text: string) {
  return c.call<Message[]>("core_message_send_messages_to_conversation", {
    conversationid,
    messages: [{ text, textformat: 0 }],
  });
}

export async function markAllNotificationsRead(c: MoodleClient, userid: number) {
  return c.call<boolean>("core_message_mark_all_notifications_as_read", { useridto: userid });
}

export async function addDiscussionPost(c: MoodleClient, postid: number, subject: string, message: string) {
  return c.call<{ postid: number }>("mod_forum_add_discussion_post", {
    postid,
    subject,
    message,
    messageformat: 1,
  });
}

export async function addDiscussion(c: MoodleClient, forumid: number, subject: string, message: string) {
  return c.call<{ discussionid: number }>("mod_forum_add_discussion", { forumid, subject, message });
}

export async function searchUsers(c: MoodleClient, userid: number, search: string, limit = 10) {
  return c.call<{ contacts: any[]; noncontacts: any[] }>("core_message_message_search_users", {
    userid,
    search,
    limitfrom: 0,
    limitnum: limit,
  });
}
