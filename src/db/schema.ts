import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const roleEnum = pgEnum("role", ["student", "parent", "counselor", "org_admin", "admin"]);

/** Every student belongs to a household; parent export/deletion works at this level. */
export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: roleEnum("role").notNull(),
    householdId: uuid("household_id").references(() => households.id, { onDelete: "set null" }),
    // Students under 13 sign in with a parent-chosen username and never give us an email.
    email: text("email"),
    username: text("username"),
    passwordHash: text("password_hash").notNull(),
    // First name or nickname only.
    displayName: text("display_name").notNull(),
    // Students only. Needed to know when COPPA protections stop applying.
    birthDate: date("birth_date", { mode: "string" }),
    grade: smallint("grade"),
    // The school year (named by its starting calendar year) that `grade` applied to; grades
    // advance each August from here. See currentGrade().
    gradeSchoolYear: smallint("grade_school_year"),
    remindersEnabled: boolean("reminders_enabled").notNull().default(true),
    // True when a parent created and controls this account (under-13 at creation).
    parentManaged: boolean("parent_managed").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
    uniqueIndex("users_username_uq").on(sql`lower(${t.username})`),
    index("users_household_idx").on(t.householdId),
  ],
);

export const parentStudentLinks = pgTable(
  "parent_student_links",
  {
    parentUserId: uuid("parent_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentUserId: uuid("student_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.parentUserId, t.studentUserId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the cookie token; the raw token is never stored.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Parental consent (COPPA)
// ---------------------------------------------------------------------------

/**
 * Created when an under-13 student hands off to a parent. Holds only the parent's email,
 * which is deleted if consent isn't completed before `expiresAt`.
 */
export const consentRequests = pgTable(
  "consent_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentEmail: text("parent_email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("consent_requests_token_uq").on(t.tokenHash)],
);

/** Proof of verifiable parental consent. Kept (without the child link) after a child is deleted. */
export const consentRecords = pgTable("consent_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentUserId: uuid("parent_user_id").references(() => users.id, { onDelete: "set null" }),
  studentUserId: uuid("student_user_id").references(() => users.id, { onDelete: "set null" }),
  method: text("method").notNull(),
  // Verifier's reference (e.g. a vendor transaction id); never raw card or ID data.
  verificationRef: text("verification_ref"),
  policyVersion: text("policy_version").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Organizations (schools / nonprofits) — unused until Phase 5
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    // Never put personal data here; it outlives account deletion.
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    // Millionths of a US dollar.
    costMicros: integer("cost_micros").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_user_created_idx").on(t.userId, t.createdAt)],
);

export const safetyCategoryEnum = pgEnum("safety_category", [
  "self_harm",
  "abuse",
  "violence",
  "sexual_content",
  "eating_disorder",
  "substance_use",
  "bullying",
  "distress",
]);

export const safetySeverityEnum = pgEnum("safety_severity", ["low", "medium", "high", "imminent"]);

/** Human review queue for concerning student messages. Deleted with the student. */
export const safetyEvents = pgTable(
  "safety_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: safetyCategoryEnum("category").notNull(),
    severity: safetySeverityEnum("severity").notNull(),
    // Which classifier tiers fired, e.g. ["rules", "model"].
    sources: jsonb("sources").$type<string[]>().notNull(),
    excerpt: text("excerpt").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: createdAt(),
  },
  (t) => [index("safety_events_unreviewed_idx").on(t.reviewedAt, t.createdAt)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

// ---------------------------------------------------------------------------
// Reference data (loaded from public sources, read-only at runtime)
// ---------------------------------------------------------------------------

export const riasecEnum = pgEnum("riasec", ["R", "I", "A", "S", "E", "C"]);

/** O*NET-SOC occupations, e.g. "15-1252.00" Software Developers. */
export const occupations = pgTable("occupations", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  // O*NET Job Zone 1–5 (amount of preparation needed).
  jobZone: smallint("job_zone"),
});

export const occupationInterests = pgTable(
  "occupation_interests",
  {
    occupationCode: text("occupation_code")
      .notNull()
      .references(() => occupations.code, { onDelete: "cascade" }),
    interest: riasecEnum("interest").notNull(),
    // O*NET occupational interest score, 1–7.
    score: real("score").notNull(),
  },
  (t) => [primaryKey({ columns: [t.occupationCode, t.interest] })],
);

/** CIP 2020 instructional programs (majors), e.g. "11.0701" Computer Science. */
export const majors = pgTable("majors", {
  cipCode: text("cip_code").primaryKey(),
  title: text("title").notNull(),
});

/** NCES CIP–SOC crosswalk. SOC codes are 6-digit ("15-1252"); O*NET codes add a suffix. */
export const cipSocLinks = pgTable(
  "cip_soc_links",
  {
    cipCode: text("cip_code")
      .notNull()
      .references(() => majors.cipCode, { onDelete: "cascade" }),
    socCode: text("soc_code").notNull(),
  },
  (t) => [primaryKey({ columns: [t.cipCode, t.socCode] }), index("cip_soc_soc_idx").on(t.socCode)],
);

export type NetPriceByIncome = {
  "0-30000"?: number;
  "30001-48000"?: number;
  "48001-75000"?: number;
  "75001-110000"?: number;
  "110001-plus"?: number;
};

/** College Scorecard institutions, keyed by IPEDS UNITID. */
export const colleges = pgTable(
  "colleges",
  {
    unitId: integer("unit_id").primaryKey(),
    name: text("name").notNull(),
    city: text("city"),
    state: text("state"),
    url: text("url"),
    // 1 public, 2 private nonprofit, 3 private for-profit.
    control: smallint("control"),
    admissionRate: real("admission_rate"),
    completionRate: real("completion_rate"),
    medianEarnings10yr: integer("median_earnings_10yr"),
    avgNetPrice: integer("avg_net_price"),
    netPriceByIncome: jsonb("net_price_by_income").$type<NetPriceByIncome>(),
  },
  (t) => [index("colleges_state_idx").on(t.state)],
);

/** O*NET work values extent scores (1–7), from O*NET 30.0 (the last release that includes them). */
export const occupationValues = pgTable(
  "occupation_values",
  {
    occupationCode: text("occupation_code")
      .notNull()
      .references(() => occupations.code, { onDelete: "cascade" }),
    value: text("value").notNull(),
    score: real("score").notNull(),
  },
  (t) => [primaryKey({ columns: [t.occupationCode, t.value] })],
);

// ---------------------------------------------------------------------------
// Assessments and career matching (student data — deleted with the student)
//
// Student tables store occupation codes without foreign keys to reference tables, so reloading
// reference data never deletes a student's matches or goals.
// ---------------------------------------------------------------------------

export const assessmentAttempts = pgTable(
  "assessment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instrument: text("instrument").notNull(),
    instrumentVersion: text("instrument_version").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("assessment_attempts_user_idx").on(t.userId, t.instrument, t.startedAt)],
);

export const assessmentResponses = pgTable(
  "assessment_responses",
  {
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => assessmentAttempts.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    value: smallint("value").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.itemId] })],
);

export const assessmentResults = pgTable("assessment_results", {
  attemptId: uuid("attempt_id")
    .primaryKey()
    .references(() => assessmentAttempts.id, { onDelete: "cascade" }),
  scores: jsonb("scores").$type<Record<string, unknown>>().notNull(),
  scoringVersion: text("scoring_version").notNull(),
  createdAt: createdAt(),
});

export type MatchExplanation = {
  overview: string;
  careers: { code: string; why: string }[];
  /** "ai" when written by the model, "template" when generated without it. */
  source: "ai" | "template";
};

export const matchRuns = pgTable(
  "match_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    interestsAttemptId: uuid("interests_attempt_id")
      .notNull()
      .references(() => assessmentAttempts.id, { onDelete: "cascade" }),
    valuesAttemptId: uuid("values_attempt_id").references(() => assessmentAttempts.id, { onDelete: "set null" }),
    personalityAttemptId: uuid("personality_attempt_id").references(() => assessmentAttempts.id, { onDelete: "set null" }),
    scoringVersion: text("scoring_version").notNull(),
    explanation: jsonb("explanation").$type<MatchExplanation>(),
    createdAt: createdAt(),
  },
  (t) => [index("match_runs_user_idx").on(t.userId, t.createdAt)],
);

export const careerMatches = pgTable(
  "career_matches",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => matchRuns.id, { onDelete: "cascade" }),
    rank: smallint("rank").notNull(),
    occupationCode: text("occupation_code").notNull(),
    title: text("title").notNull(),
    jobZone: smallint("job_zone"),
    // 0–100.
    score: smallint("score").notNull(),
    interestFit: smallint("interest_fit").notNull(),
    valuesFit: smallint("values_fit"),
  },
  (t) => [primaryKey({ columns: [t.runId, t.rank] })],
);

/** A student's chosen target careers ("for now"). At most two at a time. */
export const northStarGoals = pgTable(
  "north_star_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    occupationCode: text("occupation_code").notNull(),
    title: text("title").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("north_star_user_occupation_uq").on(t.userId, t.occupationCode)],
);

// ---------------------------------------------------------------------------
// Planning (Phase 2) — student data, deleted with the student
// ---------------------------------------------------------------------------

export type CourseSubject =
  | "english" | "math" | "science" | "social_studies" | "world_language" | "arts"
  | "computer_science" | "career_technical" | "health_pe" | "other";
export type CourseLevel = "regular" | "honors" | "ap" | "ib" | "dual_enrollment";
export type CourseTerm = "full_year" | "fall" | "spring" | "summer";
export type CourseStatus = "planned" | "in_progress" | "completed";

/** Courses a student has taken or plans to take, entered from their own school's catalog. */
export const studentCourses = pgTable(
  "student_courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    subject: text("subject").$type<CourseSubject>().notNull(),
    level: text("level").$type<CourseLevel>().notNull().default("regular"),
    gradeLevel: smallint("grade_level").notNull(),
    term: text("term").$type<CourseTerm>().notNull().default("full_year"),
    credits: real("credits").notNull().default(1),
    status: text("status").$type<CourseStatus>().notNull().default("planned"),
    // Letter grade, e.g. "A-", once completed. "P"/"W"/"I" don't count toward GPA.
    finalGrade: text("final_grade"),
    // Middle-school courses usually don't count toward the high school GPA unless the school
    // gives high school credit (e.g. Algebra I in 8th grade).
    highSchoolCredit: boolean("high_school_credit").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("student_courses_user_idx").on(t.userId, t.gradeLevel)],
);

/** A student's progress on roadmap milestones (the milestone library lives in code). */
export const studentMilestones = pgTable(
  "student_milestones",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    milestoneId: text("milestone_id").notNull(),
    status: text("status").$type<"done" | "skipped">().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.milestoneId] })],
);

/** One to three small actions a student commits to for a week. */
export const weeklySteps = pgTable(
  "weekly_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Monday of the week, YYYY-MM-DD.
    weekStart: date("week_start", { mode: "string" }).notNull(),
    text: text("text").notNull(),
    milestoneId: text("milestone_id"),
    status: text("status").$type<"open" | "done">().notNull().default("open"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("weekly_steps_user_week_idx").on(t.userId, t.weekStart)],
);

// ---------------------------------------------------------------------------
// AI counselor — student data, deleted with the student
// ---------------------------------------------------------------------------

export const counselorConversations = pgTable(
  "counselor_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    // Set when a high-risk message was intercepted; the counselor stays in support mode.
    concernFlagged: boolean("concern_flagged").notNull().default(false),
    // Number of messages already folded into the student's memory notes.
    memoryProcessedCount: integer("memory_processed_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("counselor_conversations_user_idx").on(t.userId, t.updatedAt)],
);

export const counselorMessages = pgTable(
  "counselor_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => counselorConversations.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    // "support" = crisis resources shown instead of a counselor reply; "notice" = system notices
    // like the monthly AI limit.
    kind: text("kind").$type<"chat" | "support" | "notice">().notNull().default("chat"),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("counselor_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/** Short notes the counselor keeps about a student across conversations (never sensitive details). */
export const counselorMemory = pgTable("counselor_memory", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  notes: jsonb("notes").$type<string[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Which weekly reminder emails were sent, so the cron job is idempotent. */
export const reminderSends = pgTable(
  "reminder_sends",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekStart] })],
);
