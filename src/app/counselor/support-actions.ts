export type SupportAction = { href: string; label: string };

/** Big-button actions for a crisis reply, based on the hotlines the message names. */
export function supportActions(text: string): SupportAction[] {
  const actions: SupportAction[] = [
    { href: "tel:988", label: "Call 988" },
    { href: "sms:988", label: "Text 988" },
  ];
  if (text.includes("741741")) actions.push({ href: "sms:741741?body=HOME", label: "Text HOME to 741741" });
  if (text.includes("1-800-422-4453")) {
    actions.unshift({ href: "tel:18004224453", label: "Call Childhelp (1-800-422-4453)" }, { href: "sms:18004224453", label: "Text Childhelp" });
  }
  actions.push({ href: "https://988lifeline.org/chat/", label: "Chat online with 988" });
  if (text.includes("911")) actions.push({ href: "tel:911", label: "Call 911 (emergency)" });
  return actions;
}
