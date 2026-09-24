import type { SafetyCategory } from "./types";

const CRISIS_LINES =
  "You can call or text 988 (the Suicide & Crisis Lifeline) any time, day or night, or text HOME to 741741 to reach the Crisis Text Line.";
const EMERGENCY = "If you're in danger right now, call 911.";
const TRUSTED_ADULT =
  "Is there a trusted adult you can talk to today, like a parent, relative, teacher, coach, or school counselor?";

/**
 * What the counselor says instead of its normal reply when a message is high risk. It is honest
 * that it's an AI and points to real people who can help.
 */
export function supportResponse(category: SafetyCategory): string {
  const opener = "I'm really glad you told me. I'm an AI, so I can't give you the help you deserve right now, but real people can.";
  switch (category) {
    case "abuse":
      return [
        opener,
        "No one is allowed to hurt you, and it's not your fault.",
        "You can call or text the Childhelp National Child Abuse Hotline at 1-800-422-4453, any time, to talk with someone who can help.",
        EMERGENCY,
        TRUSTED_ADULT,
      ].join(" ");
    case "violence":
      return [
        "It sounds like you're dealing with something really intense.",
        "Please talk to a trusted adult today, like a parent, teacher, or school counselor.",
        "If someone is in danger right now, call 911.",
        "If your feelings are overwhelming, you can also call or text 988 to talk with someone right away.",
      ].join(" ");
    default:
      return [opener, CRISIS_LINES, EMERGENCY, TRUSTED_ADULT].join(" ");
  }
}
