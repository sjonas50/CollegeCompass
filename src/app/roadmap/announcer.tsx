"use client";

import { useEffect, useState } from "react";

const EVENT = "cc:roadmap-announce";
const VISIBLE_MS = 5000;

/** Shows (and reads out) a short confirmation from anywhere on the roadmap page. */
export function announce(message: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

/**
 * Lives at the page level, so it survives a milestone card moving to another section (and
 * unmounting) after the page refreshes.
 */
export function Announcer() {
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
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-10 flex justify-center">
      {message.text && (
        <p key={message.id} className="max-w-md rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-lg">
          {message.text}
        </p>
      )}
    </div>
  );
}

/**
 * Moves keyboard and screen reader focus after an action removes the control that had it.
 * Falls back to the page heading if the target is gone.
 */
export function focusById(id: string) {
  const el = document.getElementById(id) ?? document.getElementById("roadmap-heading");
  el?.focus();
}
