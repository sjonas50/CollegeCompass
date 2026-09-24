"use client";

import { useState } from "react";

/**
 * A destructive action that asks once before submitting its server action.
 */
export function ConfirmButton({
  action,
  fields,
  label,
  accessibleLabel,
  question,
  confirmLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  fields?: Record<string, string>;
  label: string;
  accessibleLabel?: string;
  question: string;
  confirmLabel: string;
}) {
  const [asking, setAsking] = useState(false);
  // The chat moves its URL to /counselor/<id> without a navigation, so the page this was rendered
  // for may not be where the student is now. The action returns them there.
  const [returnTo, setReturnTo] = useState("");
  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => {
          setReturnTo(window.location.pathname);
          setAsking(true);
        }}
        aria-label={accessibleLabel}
        className="min-h-11 shrink-0 px-2 text-sm text-muted underline"
      >
        {label}
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" role="group" aria-label={question}>
      {Object.entries(fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="returnTo" value={returnTo} />
      <span className="text-sm">{question}</span>
      <button type="submit" className="min-h-11 rounded-lg bg-danger px-3 text-sm font-medium text-white" autoFocus>
        {confirmLabel}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="min-h-11 px-2 text-sm underline">
        Cancel
      </button>
    </form>
  );
}
