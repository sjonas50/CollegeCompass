"use client";

import { useActionState } from "react";

type Values = Record<string, string>;
type Wrapped<S> = { result: S; values: Values };

/**
 * useActionState that also remembers what was submitted. React resets a form after its action
 * runs, so without this a validation error would wipe everything the user typed. Feed
 * `values` back in as `defaultValue` (never for passwords).
 */
export function useFormAction<S>(action: (prev: S, formData: FormData) => Promise<S>, initial: S) {
  const [state, dispatch, pending] = useActionState<Wrapped<S>, FormData>(
    async (prev, formData) => {
      const values: Values = {};
      for (const [key, value] of formData) {
        if (typeof value === "string" && !/password/i.test(key)) values[key] = value;
      }
      return { result: await action(prev.result, formData), values };
    },
    { result: initial, values: {} },
  );
  return [state.result, dispatch, pending, state.values] as const;
}
