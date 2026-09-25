import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FreeQuiz } from "@/app/try/free-quiz";
import { type Db, createTestDb } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, LIKE_SCALE, PERSONALITY_ITEMS, WORK_VALUES, WORK_VALUE_INFO } from "@/lib/assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "@/lib/assessments/service";
import type { SessionUser } from "@/lib/auth/sessions";
import InstrumentPage from "./[instrument]/page";
import { questionRange, showFirstQuestion, showQuestion, unansweredText } from "./question-list";
import { PageButtons, Questionnaire } from "./questionnaire";
import { RANKING_CLEARED, ValuesButtons, ValuesSort, focusFirstValue, rankChange, rankedName } from "./values-sort";

// The activities for keyboard and screen reader users: where focus goes when a page turns, what
// is announced, why Next is off, and how the values ranking is read out.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), redirect: () => {}, notFound: () => {} }));

afterEach(() => {
  state.db = null;
  state.user = null;
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const items = INTEREST_ITEMS.map(({ id, text }) => ({ id, text }));
const questionnaire = (initial: Record<string, number>) =>
  renderToStaticMarkup(createElement(Questionnaire, { attemptId: "a", items, options: LIKE_SCALE, prompt: "Would you like to…", initial }));
const answered = (count: number) => Object.fromEntries(items.slice(0, count).map((i) => [i.id, 4]));

describe("turning a page", () => {
  it("says which questions are showing", () => {
    expect(questionRange(0, 6, 60)).toBe("Questions 1–6 of 60");
    expect(questionRange(1, 6, 60)).toBe("Questions 7–12 of 60");
    expect(questionRange(3, 6, 20)).toBe("Questions 19–20 of 20");
  });

  it("goes back to the top and focuses the first new question, so Tab moves into its answers", () => {
    const calls: string[] = [];
    const question = (n: number) => ({
      focus: (o?: FocusOptions) => calls.push(`focus ${n} ${JSON.stringify(o)}`),
      scrollIntoView: (o?: ScrollIntoViewOptions) => calls.push(`scroll to ${n} ${JSON.stringify(o)}`),
    });
    const list = { querySelectorAll: () => [question(0), question(1), question(2)] };
    showFirstQuestion(list, { scrollTo: ((o: ScrollToOptions) => calls.push(`scroll ${JSON.stringify(o)}`)) as Window["scrollTo"] });
    // Focus without a second scroll, so the progress bar above stays in view.
    expect(calls).toEqual(['scroll {"top":0}', 'focus 0 {"preventScroll":true}']);

    calls.length = 0;
    showQuestion(list, 2);
    expect(calls).toEqual(['scroll to 2 {"block":"center"}', 'focus 2 {"preventScroll":true}']);
    expect(() => showFirstQuestion(null, { scrollTo: () => {} })).not.toThrow();
  });

  it("gives each question a focus target and a polite live region for the page", () => {
    const html = questionnaire({});
    expect(html.match(/<fieldset tabindex="-1"/g)).toHaveLength(6);
    expect(html).toMatch(/<p class="sr-only" aria-live="polite"><\/p>/);
    const quiz = renderToStaticMarkup(createElement(FreeQuiz, { items, options: LIKE_SCALE }));
    expect(quiz.match(/<fieldset tabindex="-1"/g)).toHaveLength(6);
    expect(quiz).toMatch(/<p class="sr-only" aria-live="polite"><\/p>/);
  });

  it("shows a clear focus ring outside a selected answer", () => {
    const html = questionnaire(answered(1));
    const selected = /<label class="([^"]*bg-accent text-accent-foreground[^"]*)"/.exec(html)?.[1];
    expect(selected).toContain("has-focus-visible:outline-offset-2");
    expect(selected).toContain("has-focus-visible:outline-2");
    expect(selected).not.toContain("focus-within");
  });
});

describe("why Next is off", () => {
  it("counts what's left on the page and offers to go there", () => {
    expect(unansweredText(1)).toBe("1 question on this page still needs an answer.");
    expect(unansweredText(4)).toBe("4 questions on this page still need an answer.");

    const html = questionnaire(answered(4));
    expect(text(html)).toContain("2 questions on this page still need an answer. Go to the first one");
    const hintId = /<p id="([^"]+)" class="text-sm text-muted">2 questions/.exec(html)?.[1];
    expect(hintId).toBeTruthy();
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*aria-describedby="${hintId}"[^>]*>Next</button>`));

    // The first page is done, so it opens on the second, with one question left.
    const second = text(questionnaire(answered(11)));
    expect(second).toContain("1 question on this page still needs an answer. Go to it");
  });

  it("says nothing once the page is done", () => {
    const html = questionnaire(answered(60));
    expect(text(html)).not.toContain("still need");
    expect(html).not.toContain("aria-describedby");
  });

  it("keeps Next focusable while the page saves, so focus is still there if saving fails", () => {
    const buttons = (props: { pending: boolean; unanswered?: number; back?: () => void }) =>
      renderToStaticMarkup(
        createElement(PageButtons, { back: () => {}, next: () => {}, nextLabel: "Next", unanswered: 0, hintId: "hint", ...props }),
      );
    const button = (html: string, label: string) => new RegExp(`<button[^>]*>${label}</button>`).exec(html)?.[0] ?? "";

    const saving = buttons({ pending: true });
    expect(button(saving, "Saving…")).toContain('aria-disabled="true"');
    // A disabled button would drop keyboard focus to the start of the page.
    expect(button(saving, "Saving…")).not.toContain('disabled=""');
    expect(button(saving, "Saving…")).toContain("aria-disabled:opacity-60");
    expect(button(saving, "Back")).toContain('disabled=""');

    const ready = buttons({ pending: false });
    expect(button(ready, "Next")).not.toMatch(/disabled="/);
    expect(button(ready, "Back")).not.toMatch(/disabled="/);
    // Unanswered questions still turn Next off, and say why.
    expect(button(buttons({ pending: false, unanswered: 2 }), "Next")).toMatch(/disabled=""[^>]*aria-describedby="hint"/);
    expect(buttons({ pending: false, back: undefined })).not.toContain("Back");
  });

  it("waits for the free quiz's saved answers before counting", () => {
    const html = renderToStaticMarkup(createElement(FreeQuiz, { items, options: LIKE_SCALE }));
    expect(text(html)).not.toContain("still need");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Next<\/button>/);
  });
});

describe("values ranking", () => {
  const values = WORK_VALUES.map((v) => ({ id: v, ...WORK_VALUE_INFO[v] }));
  const names = Object.fromEntries(values.map((v) => [v.id, v.name]));

  it("names each value with its rank", () => {
    expect(rankedName("Support", 1, 6)).toBe("Support, ranked 1 of 6");
    expect(rankedName("Support", 0, 6)).toBe("Support");
  });

  it("announces each change, including values removed after the one tapped", () => {
    expect(rankChange([], ["support"], names, 6)).toBe("Support is number 1. 5 more to rank.");
    expect(rankChange(["support", "independence"], ["support", "independence", "relationships"], names, 6)).toBe(
      "Helping people is number 3. 3 more to rank.",
    );
    const all = ["support", "independence", "relationships", "achievement", "recognition", "working_conditions"];
    expect(rankChange(all.slice(0, 5), all, names, 6)).toBe("Security & stability is number 6. All 6 are ranked.");
    expect(rankChange(all.slice(0, 3), all.slice(0, 2), names, 6)).toBe("Removed Helping people. 4 more to rank.");
    expect(rankChange(all.slice(0, 3), all.slice(0, 1), names, 6)).toBe("Removed Independence and the one after it. 5 more to rank.");
    expect(rankChange(all, [], names, 6)).toBe("Removed Support and the 5 after it. 6 more to rank.");
  });

  it("labels each button with its value, described by its meaning, with a live region for changes", () => {
    const html = renderToStaticMarkup(createElement(ValuesSort, { attemptId: "a", values }));
    for (const v of values) {
      const button = new RegExp(`<button[^>]*aria-pressed="false" aria-label="${v.name.replace("&", "&amp;")}" aria-describedby="([^"]+)"`).exec(html);
      expect(button, v.name).not.toBeNull();
      expect(html).toContain(`id="${button![1]}" class="block text-sm text-muted">${v.description.replace("'", "&#x27;")}`);
    }
    expect(html).toMatch(/<p class="sr-only" aria-live="polite"><\/p>/);
    expect(text(html)).toContain("Tap one again to remove it, along with any you picked after it.");
  });

  it("says the ranking is cleared on Start over, and moves focus to the first value", () => {
    expect(RANKING_CLEARED).toBe("Your ranking is cleared. Start with what matters most.");
    const focused: string[] = [];
    const list = {
      querySelector: (selector: "button") => ({ focus: () => focused.push(selector) }),
    };
    focusFirstValue(list);
    expect(focused).toEqual(["button"]);
    expect(() => focusFirstValue(null)).not.toThrow();
    expect(() => focusFirstValue({ querySelector: () => null })).not.toThrow();
  });

  it("keeps See my results focusable while the ranking saves, so focus is still there if saving fails", () => {
    const buttons = (props: { ranked: number; pending: boolean }) =>
      renderToStaticMarkup(createElement(ValuesButtons, { submit: () => {}, startOver: () => {}, total: 6, ...props }));
    const button = (html: string, label: string) => new RegExp(`<button[^>]*>${label}</button>`).exec(html)?.[0] ?? "";

    const saving = buttons({ ranked: 6, pending: true });
    expect(button(saving, "Saving…")).toContain('aria-disabled="true"');
    // A disabled button would drop keyboard focus to the start of the page.
    expect(button(saving, "Saving…")).not.toContain('disabled=""');
    expect(button(saving, "Saving…")).toContain("aria-disabled:opacity-60");
    expect(button(saving, "Start over")).toContain('disabled=""');

    const ready = buttons({ ranked: 6, pending: false });
    expect(button(ready, "See my results")).not.toMatch(/disabled="/);
    expect(button(ready, "Start over")).not.toMatch(/disabled="/);
    // Until every value is ranked, See my results is off.
    expect(button(buttons({ ranked: 3, pending: false }), "See my results")).toContain('disabled=""');
    expect(buttons({ ranked: 0, pending: false })).not.toContain("Start over");
    // The whole activity renders the same buttons.
    const values = WORK_VALUES.map((v) => ({ id: v, ...WORK_VALUE_INFO[v] }));
    expect(button(renderToStaticMarkup(createElement(ValuesSort, { attemptId: "a", values })), "See my results")).toBe(
      button(buttons({ ranked: 0, pending: false }), "See my results"),
    );
  });
});

describe("a finished activity's page", () => {
  async function finish(instrument: "interests" | "personality" | "values") {
    const db = await createTestDb();
    state.db = db;
    const res = await registerStudent(db, {
      displayName: "Sam",
      email: "sam@example.com",
      password: "correct horse battery",
      birthDate: "2010-05-01",
      grade: 10,
    });
    if (!res.ok) throw new Error(res.error);
    state.user = { id: res.value.userId, role: "student", displayName: "Sam", username: null, householdId: null, parentManaged: false, grade: 10 };
    const start = await startOrResumeAttempt(db, res.value.userId, instrument, new Date(Date.now() - 60_000));
    if (!start.ok) throw new Error();
    const responses =
      instrument === "values"
        ? Object.fromEntries(WORK_VALUES.map((v, i) => [v, i + 1]))
        : Object.fromEntries((instrument === "interests" ? INTEREST_ITEMS : PERSONALITY_ITEMS).map((i) => [i.id, 3]));
    await saveResponses(db, res.value.userId, start.attempt.id, responses);
    await completeAttempt(db, res.value.userId, start.attempt.id);
    const page = InstrumentPage({ params: Promise.resolve({ instrument }), searchParams: Promise.resolve({}) } as PageProps<"/discover/[instrument]">);
    return text(renderToStaticMarkup((await page) as ReactNode));
  }

  it("explains the wait to retake in words that fit the activity", async () => {
    expect(await finish("values")).toMatch(/What matters to you can change as you grow — you can retake it after/);
    expect(await finish("personality")).toMatch(/How you see yourself can change as you grow — you can retake it after/);
    const interests = await finish("interests");
    expect(interests).toMatch(/Your interests can change as you grow — you can retake it after/);
    expect(interests).not.toContain("personality");
  });
});
