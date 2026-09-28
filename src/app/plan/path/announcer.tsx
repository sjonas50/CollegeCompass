"use client";

import { useEffect, useState } from "react";

// One polite live region for "Your path" (design §10.7: one message per action). It lives at the
// page level, so it survives the suggestion that was tapped disappearing after the page refreshes.

const EVENT = "cc:path-announce";
const VISIBLE_MS = 6000;

export function announcePath(message: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

/** Moves focus after an action removes the control that had it; falls back to the path heading. */
export function focusPath(id: string) {
  const el = document.getElementById(id) ?? document.getElementById("path-heading");
  el?.focus();
}

export function PathAnnouncer() {
  const [message, setMessage] = useState({ text: "", id: 0 });

  useEffect(() => {
    const onAnnounce = (e: Event) => setMessage((m) => ({ text: (e as CustomEvent<string>).detail, id: m.id + 1 }));
    window.addEventListener(EVENT, onAnnounce);
    return () => window.removeEventListener(EVENT, onAnnounce);
  }, []);

  useEffect(() => {
    if (!message.text) return;
    const timer = setTimeout(() => setMessage((m) => (m.id === message.id ? { ...m, text: "" } : m)), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div id="path-announcer" role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-10 flex justify-center print:hidden">
      {message.text && (
        <p key={message.id} className="max-w-md rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-lg">
          {message.text}
        </p>
      )}
    </div>
  );
}
