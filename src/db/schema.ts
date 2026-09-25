import { sql } from "drizzle-orm";
import {
  bigint,
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
  // By action: the admin's safety review numbers read the review entries of deleted accounts.
  (t) => [index("audit_log_created_idx").on(t.createdAt), index("audit_log_action_idx").on(t.action)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Kept, unlinked, when the student is deleted: the row holds no content, and spend history for
    // past months shouldn't change.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
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

export type SafetyReviewOutcome = "no_action" | "followed_up" | "escalated";

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
    // The counselor conversation the message was in, when there is one (for staff review).
    conversationId: uuid("conversation_id").references(() => counselorConversations.id, { onDelete: "set null" }),
    excerpt: text("excerpt").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    // What the reviewer did. Notes stay with the event and are deleted with the student.
    reviewOutcome: text("review_outcome").$type<SafetyReviewOutcome>(),
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

/**
 * Anonymous daily totals for the staff overview: how many people finished the free quiz, signed up,
 * and so on (see src/lib/admin/counts.ts). One number per UTC day and metric, and nothing else: no
 * user ids, no addresses, nothing about any one person. Not personal data, so it isn't in any
 * export and isn't deleted with an account.
 */
export const dailyCounts = pgTable(
  "daily_counts",
  {
    day: date("day").notNull(),
    metric: text("metric").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.metric] })],
);

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
    // The occupation's highest-scored area (each of them when tied), for occupations with all six
    // scores. Set by `npm run data:load` (withLeadInterests); /careers?area= browses by it.
    leads: boolean("leads").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.occupationCode, t.interest] }),
    index("occupation_interests_leads_idx").on(t.interest).where(sql`${t.leads}`),
  ],
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
    zip: text("zip"),
    // Undergraduate enrollment.
    enrollment: integer("enrollment"),
    // 1 certificate, 2 associate, 3 bachelor's, 4 graduate (the degree most students earn here).
    predominantDegree: smallint("predominant_degree"),
    highestDegree: smallint("highest_degree"),
    // Each college's own net price calculator (required by federal law).
    netPriceCalculatorUrl: text("net_price_calculator_url"),
    // Total cost of attendance per year (academic-year or program-year schools).
    costOfAttendance: integer("cost_of_attendance"),
    tuitionInState: integer("tuition_in_state"),
    tuitionOutOfState: integer("tuition_out_of_state"),
    // Share of undergraduates receiving a Pell Grant (0–1).
    pellShare: real("pell_share"),
    // Median federal debt of completers.
    medianDebt: integer("median_debt"),
    hbcu: boolean("hbcu").notNull().default(false),
    hispanicServing: boolean("hispanic_serving").notNull().default(false),
    tribal: boolean("tribal").notNull().default(false),
    onlineOnly: boolean("online_only").notNull().default(false),
  },
  (t) => [index("colleges_state_idx").on(t.state), index("colleges_name_idx").on(t.name)],
);

/**
 * Programs each college offers (College Scorecard field-of-study data), undergraduate credentials
 * only. CIP codes here are 4-digit families ("11.07"); majors in the crosswalk are 6-digit.
 */
export const collegePrograms = pgTable(
  "college_programs",
  {
    unitId: integer("unit_id")
      .notNull()
      .references(() => colleges.unitId, { onDelete: "cascade" }),
    cip4: text("cip4").notNull(),
    title: text("title").notNull(),
    // 1 undergraduate certificate, 2 associate, 3 bachelor's.
    credentialLevel: smallint("credential_level").notNull(),
    medianDebt: integer("median_debt"),
    // Median earnings four years after completing (only where the sample is large enough).
    medianEarnings4yr: integer("median_earnings_4yr"),
  },
  (t) => [primaryKey({ columns: [t.unitId, t.cip4, t.credentialLevel] }), index("college_programs_cip_idx").on(t.cip4)],
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

/**
 * O*NET 31.0 Work Styles: 21 styles (like Attention to Detail or Empathy) per occupation, with
 * both of the file's scales. O*NET rated them with a hybrid AI/expert method (Domain Source
 * "AI/Expert"), not by surveying workers, so they are used lightly and described as estimates.
 */
export const occupationWorkStyles = pgTable(
  "occupation_work_styles",
  {
    occupationCode: text("occupation_code")
      .notNull()
      .references(() => occupations.code, { onDelete: "cascade" }),
    // Our id for the style, e.g. "attention_to_detail" (WORK_STYLES in src/lib/reference/work-styles.ts).
    style: text("style").notNull(),
    // Work Styles Impact (WI), −3 to +3: how much the style helps (+) or gets in the way of (−) the work.
    impact: real("impact").notNull(),
    // Distinctiveness Rank (DR): 1 is the style that most sets this occupation apart from others.
    // Null when the style isn't among the occupation's ranked ones (up to 10; published as 0).
    distinctiveRank: smallint("distinctive_rank"),
  },
  (t) => [primaryKey({ columns: [t.occupationCode, t.style] })],
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
  /** Which interest facts the model was given (see EXPLANATION_FACTS_VERSION); missing before version 2. */
  factsVersion?: number;
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
    // The student context sent with this conversation's prompts, reused byte-for-byte during an
    // active session so the prompt cache stays valid (see studentContext in respond.ts). Cleared
    // when what it summarizes changes. Live plan and roadmap data come from tools.
    context: text("context"),
    contextBuiltAt: timestamp("context_built_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("counselor_conversations_user_idx").on(t.userId, t.updatedAt)],
);

export const counselorMessages = pgTable(
  "counselor_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Insertion order. Timestamps can tie when a reply and its notice are saved together.
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
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
  (t) => [index("counselor_messages_conversation_idx").on(t.conversationId, t.seq)],
);

/** Short notes the counselor keeps about a student across conversations (never sensitive details). */
export const counselorMemory = pgTable("counselor_memory", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  notes: jsonb("notes").$type<string[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Weekly reminder emails, claimed per recipient before sending so a re-run of the cron job
 * never double-sends and a failed send to one parent can be retried alone.
 */
export const reminderSends = pgTable(
  "reminder_sends",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    // SHA-256 of the recipient address (never the address itself).
    recipient: text("recipient").notNull().default(""),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    // Null until the email actually went out; a stale claim with no send is retried.
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekStart, t.recipient] })],
);

// ---------------------------------------------------------------------------
// College list and applications (Phase 3) — student data, deleted with the student
// ---------------------------------------------------------------------------

export type CollegeListStatus =
  | "considering" | "applying" | "applied" | "accepted" | "waitlisted" | "not_accepted" | "enrolling" | "declined";
export type DeadlineType = "early_decision" | "early_action" | "regular" | "rolling" | "priority";

export type ApplicationChecklist = {
  applicationSubmitted?: boolean;
  transcriptRequested?: boolean;
  recommendationsRequested?: boolean;
  testScoresSent?: boolean;
  fafsaListed?: boolean;
  cssProfileSubmitted?: boolean;
  aidOfferReceived?: boolean;
  depositPaid?: boolean;
};

/** Yearly amounts from a financial aid offer, entered by the student to compare offers. */
export type AidOffer = {
  costOfAttendance?: number;
  grants?: number;
  scholarships?: number;
  workStudy?: number;
  federalLoans?: number;
  parentLoans?: number;
  otherLoans?: number;
};

/**
 * Colleges and training programs a student is considering or applying to. Entries either point
 * to a Scorecard college (unitId, no foreign key so reference reloads never delete them) or are
 * custom (apprenticeships and programs not in the Scorecard).
 */
export const collegeList = pgTable(
  "college_list",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    unitId: integer("unit_id"),
    name: text("name").notNull(),
    kind: text("kind").$type<"college" | "program">().notNull().default("college"),
    status: text("status").$type<CollegeListStatus>().notNull().default("considering"),
    deadlineType: text("deadline_type").$type<DeadlineType>(),
    deadline: date("deadline", { mode: "string" }),
    checklist: jsonb("checklist").$type<ApplicationChecklist>().notNull().default({}),
    aidOffer: jsonb("aid_offer").$type<AidOffer>(),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("college_list_user_idx").on(t.userId),
    uniqueIndex("college_list_user_unit_uq").on(t.userId, t.unitId),
  ],
);

// ---------------------------------------------------------------------------
// Access and billing (Phase 4). Access belongs to a household: every student in it shares the
// trial, subscription or free access. No payment details are stored; Stripe holds those.
// ---------------------------------------------------------------------------

export const accessKindEnum = pgEnum("access_kind", ["trial", "free_access", "sponsored", "comp"]);
export type AccessKind = (typeof accessKindEnum.enumValues)[number];

/**
 * Periods of full access other than a paid subscription: the 14-day trial, the self-reported
 * free-access path (no documents), sponsored seats and staff comps. `endsAt` null means no end.
 */
export const accessGrants = pgTable(
  "access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    kind: accessKindEnum("kind").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    // Who asked for it (a parent or teen for free access, staff for comps). Kept only as a link.
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    // The student it's for, when it was given to one student rather than the whole family: a staff
    // grant made with that student's email or username, grants the student brought along when they
    // joined a parent's household, and the paid time carried over from their old plan. If the
    // student leaves the household (see removeLinkedParent), it goes with them. Kept only as a link.
    forUserId: uuid("for_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("access_grants_household_idx").on(t.householdId, t.endsAt)],
);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);
export type SubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number];

/** A household's Stripe customer and subscription, as last reported by Stripe webhooks. */
export const billingAccounts = pgTable("billing_accounts", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  // The parent whose card the Stripe customer holds. Only they can use it (portal, checkout); set
  // to null when they delete their account, after which the plan is left to end.
  payerUserId: uuid("payer_user_id").references(() => users.id, { onDelete: "set null" }),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  status: subscriptionStatusEnum("status"),
  plan: text("plan").$type<"monthly" | "annual">(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Stripe webhook events already applied, so a retried delivery changes nothing. */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A student's invitation for a parent or guardian to link to their account (for teens who
 * signed up on their own). Only a hash of the token is kept.
 */
export const parentInvites = pgTable(
  "parent_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentUserId: uuid("student_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The address the student typed, shown only to that student (in Settings and their own data
    // export) so they can tell who they invited and who accepted. Deleted with the invitation when
    // it's cancelled, forgotten by the daily sweep once it expires unanswered, and deleted when the
    // student removes the parent who accepted it or that parent deletes their account. Null for
    // invitations sent before addresses were kept.
    sentTo: text("sent_to"),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("parent_invites_student_idx").on(t.studentUserId)],
);

/**
 * Stripe clean-up that failed and must be retried (cancelling or deleting a family's customer when
 * their account is deleted). Holds only Stripe ids, never who they belonged to. Retried by the
 * daily sweep until it succeeds.
 */
export const stripeCleanup = pgTable("stripe_cleanup", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").$type<"delete_customer" | "cancel_at_period_end">().notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  // The last error's name only.
  lastError: text("last_error"),
  createdAt: createdAt(),
});
