"use client";

import { useId, useSyncExternalStore } from "react";
import type { NetPriceByIncome } from "@/db/schema";
import { AID_EXCEEDS_COST, formatNetPrice } from "@/lib/colleges/format";
import {
  INCOME_BANDS,
  INCOME_BAND_STORAGE_KEY,
  type IncomeBand,
  isIncomeBand,
  netPriceHeadline,
  netPriceRows,
  readStoredBand,
  storeBand,
} from "@/lib/colleges/income";

/*
 * Privacy: we never collect family income. The chosen band lives only in this browser's
 * localStorage (or in memory when storage is blocked). It is never sent to the server, put in a
 * URL or submitted with a form: the select below has no `name`, and pages render every band so
 * this component only highlights one.
 */

const listeners = new Set<() => void>();
// undefined until first read in the browser; null means "no choice".
let current: IncomeBand | null | undefined;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== INCOME_BAND_STORAGE_KEY) return;
  current = readStoredBand(browserStorage());
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): IncomeBand | null {
  if (current === undefined) current = readStoredBand(browserStorage());
  return current;
}

// The server never knows the band: it always renders the "no choice" view.
const getServerSnapshot = () => null;

function setIncomeBand(band: IncomeBand | null) {
  current = band;
  // Still works for this visit when storage is blocked; it just won't be remembered.
  storeBand(browserStorage(), band);
  emit();
}

export function useIncomeBand(): IncomeBand | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Lets a family pick their income range. Saved only in this browser. */
export function IncomeBandPicker({ compact = false }: { compact?: boolean }) {
  const band = useIncomeBand();
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        Your family&apos;s yearly income (optional)
      </label>
      <p id={`${id}-hint`} className="text-sm text-muted">
        {compact
          ? "Saved only in this browser. Never sent to us."
          : "Pick a range to see what families like yours paid. Your choice is saved only in this browser, so you don't have to pick it again. It's never sent to College Compass."}
      </p>
      <select
        id={id}
        value={band ?? ""}
        onChange={(e) => setIncomeBand(isIncomeBand(e.target.value) ? e.target.value : null)}
        aria-describedby={`${id}-hint`}
        className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 focus-visible:outline-2 focus-visible:outline-accent sm:max-w-xs"
      >
        <option value="">{band ? "Clear my choice" : "Choose a range"}</option>
        {INCOME_BANDS.map((b) => (
          <option key={b.key} value={b.key}>
            {b.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * One line about price by family income: the chosen band's price, or the range across bands
 * when nothing is chosen. Renders nothing when the college reported no band prices. `inState`
 * for public colleges, whose net prices are for in-state students.
 */
export function BandPriceLine({
  byIncome,
  inState = false,
  className = "",
}: {
  byIncome: NetPriceByIncome | null;
  inState?: boolean;
  className?: string;
}) {
  const band = useIncomeBand();
  const headline = netPriceHeadline(byIncome, band, { inState });
  if (!headline) return null;
  return (
    <p className={`text-sm ${headline.kind === "band" ? "font-medium" : "text-muted"} ${className}`}>
      {headline.text}
      {headline.kind === "band" && headline.aidExceedsCost && <span className="font-normal"> {AID_EXCEEDS_COST}</span>}
    </p>
  );
}

/** The detail page's net price headline, with a prompt to pick a range when none is chosen. */
export function NetPriceHeadline({ byIncome, inState = false }: { byIncome: NetPriceByIncome | null; inState?: boolean }) {
  const band = useIncomeBand();
  const headline = netPriceHeadline(byIncome, band, { inState });
  return (
    <div className="space-y-1" aria-live="polite">
      {headline ? (
        <p className="text-lg font-semibold sm:text-xl">{headline.text}</p>
      ) : (
        <p className="text-muted">This college didn&apos;t report prices by family income.</p>
      )}
      {headline?.kind === "band" && headline.aidExceedsCost && <p className="text-sm">{AID_EXCEEDS_COST}</p>}
      {!band && headline && <p className="text-sm text-muted">Pick your family&apos;s income range below to see a closer number.</p>}
    </div>
  );
}

/** Net price for every income band, with the chosen band highlighted. */
export function NetPriceTable({ byIncome, inState = false }: { byIncome: NetPriceByIncome | null; inState?: boolean }) {
  const band = useIncomeBand();
  const rows = netPriceRows(byIncome);
  return (
    <table className="w-full text-sm">
      <caption className="mb-1 text-left text-sm text-muted">
        Average net price per year{inState ? " for in-state students" : ""}, by family income
      </caption>
      <thead>
        <tr className="text-left text-muted">
          <th scope="col" className="py-2 pr-3 font-normal">
            Family income
          </th>
          <th scope="col" className="py-2 text-right font-normal">
            Net price
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const chosen = row.band === band;
          const price = formatNetPrice(row.netPrice);
          return (
            <tr key={row.band} className={`border-t border-border ${chosen ? "bg-accent-soft font-medium" : ""}`}>
              <th scope="row" className="py-2 pr-3 pl-2 text-left font-normal">
                {row.label}
                {chosen && <span className="ml-2 text-xs font-medium">(your range)</span>}
              </th>
              <td className="py-2 pr-2 text-right tabular-nums">
                {price ? (
                  <>
                    {price.text}
                    {price.aidExceedsCost && <span className="block text-xs font-normal text-muted">Aid was more than the cost</span>}
                  </>
                ) : (
                  <span className="text-muted">Not reported</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
      {rows.some((r) => r.netPrice === null) && (
        <tfoot>
          <tr>
            <td colSpan={2} className="pt-2 text-xs text-muted">
              &ldquo;Not reported&rdquo; usually means too few students in that income range got federal aid to report a number.
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
