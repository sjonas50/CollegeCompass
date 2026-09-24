"use client";

import { useEffect, useRef } from "react";

/**
 * "Removed from your list." after removing an entry sends the student back here. The button they
 * pressed is gone, so focus moves to this message: screen readers read it, and the next Tab
 * starts from the top of the list page instead of the start of the site.
 */
export function RemovedNotice() {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="status"
      className="rounded-lg bg-success-soft px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
    >
      Removed from your list.
    </p>
  );
}
