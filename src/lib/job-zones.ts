/**
 * Plain-language O*NET Job Zones: how much preparation a career usually needs (31.0 merges zones 1
 * and 2). A zone says what's typical for its careers, not what each one requires, so every phrase
 * is hedged ("Usually…"). `reasonLead` starts a career's reason on the matches page (see
 * src/lib/matching/explain.ts) and says the same thing as `detail`, in fewer words.
 */
export const JOB_ZONE_INFO: Record<number, { label: string; detail: string; reasonLead: string }> = {
  1: {
    label: "Little preparation",
    detail: "Usually a high school diploma and on-the-job training.",
    reasonLead: "Usually with on-the-job training",
  },
  2: {
    label: "Some preparation",
    detail: "Usually a high school diploma, plus up to a year of on-the-job training.",
    reasonLead: "Usually with some on-the-job training",
  },
  3: {
    label: "Medium preparation",
    detail: "Usually vocational training, an apprenticeship, or an associate degree.",
    reasonLead: "Usually after career training or a two-year degree",
  },
  4: { label: "Considerable preparation", detail: "Usually a bachelor's degree.", reasonLead: "Usually after a bachelor's degree" },
  5: {
    label: "Extensive preparation",
    detail: "Usually a graduate degree, like a master's, law degree, or doctorate.",
    reasonLead: "Usually after a graduate degree",
  },
};
