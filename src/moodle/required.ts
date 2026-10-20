/**
 * Qué wsfunctions necesita cada tool. Sirve para el script de descubrimiento
 * y para que `campus_functions` diga qué tools van a funcionar en esta instancia.
 */
export const REQUIRED_FUNCTIONS: Record<string, string[]> = {
  campus_whoami: ["core_webservice_get_site_info"],
  campus_list_courses: ["core_enrol_get_users_courses", "core_course_get_enrolled_courses_by_timeline_classification"],
  campus_course_contents: ["core_course_get_contents"],
  campus_module: ["core_course_get_course_module", "mod_page_get_pages_by_courses", "mod_url_get_urls_by_courses"],
  campus_get_file: ["core_course_get_contents"],
  campus_search_files: ["core_course_get_contents"],
  campus_index_course: ["core_course_get_contents"],
  campus_upcoming: ["core_calendar_get_action_events_by_timesort", "core_calendar_get_calendar_events"],
  campus_assignments: ["mod_assign_get_assignments", "mod_assign_get_submission_status"],
  campus_grades: ["gradereport_overview_get_course_grades", "gradereport_user_get_grade_items"],
  campus_announcements: ["mod_forum_get_forums_by_courses", "mod_forum_get_forum_discussions"],
  campus_forum_discussion: ["mod_forum_get_discussion_posts"],
  campus_messages: ["core_message_get_conversations", "core_message_get_conversation_messages"],
  campus_notifications: ["message_popup_get_popup_notifications"],
  campus_quizzes: ["mod_quiz_get_quizzes_by_courses", "mod_quiz_get_user_attempts", "mod_quiz_get_user_best_grade"],
  campus_scheduler: ["mod_scheduler_get_my_appointments"],
  campus_search_users: ["core_message_message_search_users"],
  // escritura
  campus_submit_assignment: ["core_files_upload", "mod_assign_save_submission", "mod_assign_submit_for_grading"],
  campus_send_message: ["core_message_send_instant_messages", "core_message_send_messages_to_conversation"],
  campus_mark_notifications_read: ["core_message_mark_all_notifications_as_read"],
  campus_forum_post: ["mod_forum_add_discussion_post", "mod_forum_add_discussion"],
};

/** Funciones opcionales: si faltan, la tool degrada pero no se rompe. */
export const OPTIONAL_FUNCTIONS = new Set<string>([
  "core_course_get_enrolled_courses_by_timeline_classification",
  "mod_assign_get_submission_status",
  "mod_quiz_get_user_best_grade",
  "mod_scheduler_get_my_appointments",
  "core_message_send_messages_to_conversation",
  "mod_forum_add_discussion",
  "mod_url_get_urls_by_courses",
]);

export function checkFunctions(available: Set<string>) {
  const report: { tool: string; ok: boolean; missing: string[]; missingOptional: string[] }[] = [];
  for (const [tool, fns] of Object.entries(REQUIRED_FUNCTIONS)) {
    const missing = fns.filter((f) => !available.has(f) && !OPTIONAL_FUNCTIONS.has(f));
    const missingOptional = fns.filter((f) => !available.has(f) && OPTIONAL_FUNCTIONS.has(f));
    report.push({ tool, ok: missing.length === 0, missing, missingOptional });
  }
  return report;
}
