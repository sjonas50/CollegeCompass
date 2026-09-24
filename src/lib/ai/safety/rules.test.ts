import { describe, expect, it } from "vitest";
import cases from "../../../../evals/safety/cases.json";
import { classifyWithRules } from "./rules";
import { SEVERITY_ORDER, type Severity } from "./types";

type Case = { id: string; text: string; expected: Severity; category?: string; rulesShouldCatch: boolean };

describe("safety rules tier", () => {
  for (const c of (cases as Case[]).filter((c) => c.rulesShouldCatch)) {
    it(`${c.id}: ${c.expected}`, () => {
      const signal = classifyWithRules(c.text);
      if (c.expected === "none") {
        expect(signal).toBeNull();
      } else {
        expect(signal?.category).toBe(c.category);
        expect(SEVERITY_ORDER[signal!.severity]).toBeGreaterThanOrEqual(SEVERITY_ORDER[c.expected]);
      }
    });
  }
});

// Rules rated high or imminent override the model, so these tables pin both sides: explicit crisis
// phrasings the rules must catch on their own (the safety net when the model is down or under-calls),
// and everyday teen messages they must leave to the model.
const atLeast: [Severity, string][] = [
  ["imminent", "I'm going to kill myself tonight"],
  ["imminent", "im ending it all tonight"],
  ["imminent", "I'm ending it all. I'm done."],
  ["imminent", "i'm going to end it all"],
  ["imminent", "gonna end my life this weekend"],
  ["imminent", "I'm going to end it tonight"],
  ["imminent", "i'm gonna end it after school tomorrow, nobody will care"],
  ["imminent", "going to end it with pills"],
  ["imminent", "i want to end it with my dad's gun"],
  ["imminent", "took a bunch of pills an hour ago"],
  ["imminent", "i swallowed a whole bunch of pills like an hour ago and now my stomach hurts"],
  ["imminent", "I swallowed most of a bottle of my mom's sleeping pills about an hour ago."],
  ["imminent", "i took all my moms sleeping pills"],
  ["imminent", "I just took a bunch of pills"],
  ["imminent", "i took like 30 tylenol"],
  ["imminent", "im gonna take all my pills tonight"],
  ["imminent", "i have my moms pills in my room rn and im gonna take all of them after everyone goes to sleep"],
  ["imminent", "gonna kms fr this time. friday after school"],
  ["imminent", "im going to jump off the top of the parking garage near school tomorrow morning"],
  ["imminent", "I wrote my suicide note"],
  ["imminent", "ngl tonight's prob the night i unalive myself"],
  ["high", "end it without anyone noticing"],
  ["high", "i want to kill myself"],
  ["high", "I want to die"],
  ["high", "gonna kms fr"],
  ["high", "i want to kms"],
  ["high", "sometimes i wish i wasn't alive"],
  ["high", "I wish I was never born"],
  ["high", "I've been cutting again"],
  ["high", "i want to unalive myself"],
  ["high", "I don't plan on being around after graduation"],
  ["high", "everyone would be better off without me"],
  ["high", "I've been having suicidal thoughts"],
  ["high", "i've been thinking about jumping off the bridge by my house"],
  ["high", "i've been saving up my meds for weeks"],
  ["high", "I want to end it all"],
  ["medium", "kms this chem homework"],
  ["medium", "The SAT is this weekend and I'm gonna die"],
  ["medium", "I'm going to end it"],
  ["medium", "I'm not going to kill myself, I just feel really low"],
  ["medium", "jk im not actually gonna kms over the sat lol"],
  ["medium", "my essay is about suicide prevention"],
];

// Each of these must stay at medium or below, so the model decides.
const atMost: [Severity, string][] = [
  ["medium", "The SAT is this weekend and I'm gonna die"],
  ["medium", "I'm going to end it with my boyfriend today"],
  ["medium", "my bf keeps lying so im going to end it tonight"],
  ["medium", "Tonight I'm going to end things with her"],
  ["medium", "I need to end it with a strong conclusion before tomorrow"],
  ["medium", "How should I end my essay? I'm going to end it tonight and turn it in tomorrow"],
  ["medium", "how should I end it? it's due tomorrow"],
  ["medium", "in my story the villain decides to end it with a knife"],
  ["medium", "kms this chem homework is due tonight"],
  ["medium", "jk im not actually gonna kms over the sat lol its just stressing me out"],
  ["medium", "don't worry, I'm not gonna kill myself over a test lol"],
  ["medium", "I haven't cut myself in 6 months and I'm proud of it"],
  ["medium", "I took a bunch of pills to calm down before the SAT"],
  ["medium", "my dad took a bunch of pills for his back today"],
  ["medium", "i took 2 advil for my headache"],
  ["medium", "we're gonna jump off the cliff into the lake this weekend"],
  ["medium", "I left a goodbye note for my teacher who's retiring"],
  ["medium", "our English class analyzed the suicide note in the novel"],
  ["none", "I'm cutting class today"],
  ["none", "Today I finally ended the essay on a good note"],
  ["none", "I'm dying to see the new movie this weekend"],
  ["none", "I killed it at the game today"],
  ["none", "I could die of embarrassment tomorrow"],
  ["none", "I'm going to take my meds tonight like always"],
  ["none", "we ended it on a high note at the concert tonight"],
];

describe("self-harm phrasings", () => {
  it.each(atLeast)("at least %s: %s", (min, text) => {
    const signal = classifyWithRules(text);
    expect(signal?.category).toBe("self_harm");
    expect(SEVERITY_ORDER[signal!.severity]).toBeGreaterThanOrEqual(SEVERITY_ORDER[min]);
  });

  it.each(atMost)("at most %s: %s", (max, text) => {
    const severity = classifyWithRules(text)?.severity ?? "none";
    expect(SEVERITY_ORDER[severity]).toBeLessThanOrEqual(SEVERITY_ORDER[max]);
  });

  it("puts ambiguous slang at medium, not higher", () => {
    for (const text of ["kms this chem homework", "The SAT is this weekend and I'm gonna die", "I'm going to end it"]) {
      expect(classifyWithRules(text)?.severity).toBe("medium");
    }
  });
});

describe("sextortion phrasings", () => {
  it.each([
    "this guy i met online has nudes of me and says hes sending them to everyone",
    "he says if i dont send a video by 11 tonight hes posting them and tagging my school",
    "she said she'll leak the pics unless i pay her $200",
  ])("high abuse: %s", (text) => {
    expect(classifyWithRules(text)).toEqual({ category: "abuse", severity: "high" });
  });

  it.each([
    "my mom has so many baby pics of me on her phone",
    "if i dont send my transcript will the school post my decision late?",
  ])("not flagged: %s", (text) => {
    expect(classifyWithRules(text)).toBeNull();
  });
});

describe("normalization", () => {
  it("sees through invisible characters and curly apostrophes", () => {
    expect(classifyWithRules("I’m going to kill​ myself tonight")?.severity).toBe("imminent");
    expect(classifyWithRules("k­ms fr, gonna k‍ms")?.severity).toBe("high");
  });
});
