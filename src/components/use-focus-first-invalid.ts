"use client";

import { useEffect, useRef } from "react";

/**
 * Moves focus to the first control in `form` marked aria-invalid. When no control is (the error is
 * about the whole form, like "Too many attempts"), moves it to the form's role="alert" message,
 * which takes focus with tabIndex={-1}.
 */
export function focusFirstInvalid(form: ParentNode | null) {
  (form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? form?.querySelector<HTMLElement>('[role="alert"]'))?.focus();
}

/**
 * After a submit comes back, moves focus to the first invalid control of the form this ref is on,
 * or to its error message. Otherwise focus drops to the page (the submit button is disabled while
 * the action runs), and a screen reader user doesn't learn what went wrong. Focusing the control
 * reads its error, which it points to with aria-describedby. `result` is the action's state: each
 * submit returns a new object, so a second failed submit with the same error still moves focus and
 * is read out.
 */
export function useFocusFirstInvalid(result: unknown) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (result) focusFirstInvalid(formRef.current);
  }, [result]);
  return formRef;
}
