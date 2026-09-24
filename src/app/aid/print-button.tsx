"use client";

import { Button } from "@/components/ui";
import { PrinterIcon } from "./icons";

/** Opens the browser's print dialog. Hidden on the printed page itself. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()} className="gap-2 print:hidden">
      <PrinterIcon className="size-5" />
      {label}
    </Button>
  );
}
