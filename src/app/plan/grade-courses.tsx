"use client";

import { useEffect, useRef, useState } from "react";
import { type Announce, CourseRow, type PlanCourse } from "./course-row";

type Notice = { text: string; moveFocus: boolean; count: number };

/**
 * One grade's course list, with a status line that outlives the rows. Removing a course, or
 * moving it to another grade, takes its row (and the button that had focus) off this list, so
 * focus goes back to this grade's heading and the status line says what happened.
 */
export function GradeCourses({ courses, emptyText }: { courses: PlanCourse[]; emptyText: string }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notice?.moveFocus) return;
    // The grade section's <summary> holds its heading and is always focusable.
    rootRef.current?.closest("details")?.querySelector("summary")?.focus();
  }, [notice]);

  const announce: Announce = (text, { moveFocus }) =>
    setNotice((prev) => ({ text, moveFocus, count: (prev?.count ?? 0) + 1 }));

  return (
    <div ref={rootRef}>
      <p role="status" className="text-sm font-medium [&:not(:empty)]:mb-3">
        {notice?.text}
      </p>
      {courses.length ? (
        <ul className="space-y-3">
          {courses.map((c) => (
            <CourseRow key={c.id} course={c} announce={announce} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{emptyText}</p>
      )}
    </div>
  );
}
