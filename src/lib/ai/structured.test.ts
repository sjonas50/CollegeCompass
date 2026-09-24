import { describe, expect, it } from "vitest";
import * as z from "zod";
import { readStructuredOutput } from "./structured";

const Schema = z.object({ answer: z.number() });
const reply = (stop_reason: string, text?: string) =>
  ({ stop_reason, content: text === undefined ? [] : [{ type: "text", text, citations: null }] }) as never;

describe("readStructuredOutput", () => {
  it("returns the parsed output of a complete response", () => {
    expect(readStructuredOutput(reply("end_turn", '{"answer":42}'), Schema)).toEqual({ answer: 42 });
  });

  it("returns null for refusals, truncation, invalid JSON, schema mismatches and empty content", () => {
    expect(readStructuredOutput(reply("refusal", "I can't help with that."), Schema)).toBeNull();
    expect(readStructuredOutput(reply("refusal", '{"answer":42}'), Schema)).toBeNull();
    expect(readStructuredOutput(reply("max_tokens", '{"answer":4'), Schema)).toBeNull();
    expect(readStructuredOutput(reply("end_turn", "not json"), Schema)).toBeNull();
    expect(readStructuredOutput(reply("end_turn", '{"answer":"42"}'), Schema)).toBeNull();
    expect(readStructuredOutput(reply("end_turn"), Schema)).toBeNull();
  });
});
