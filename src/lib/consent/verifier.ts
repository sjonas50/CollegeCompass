import { env } from "@/env";

/** Bump when the privacy notice parents agree to changes. */
export const CONSENT_POLICY_VERSION = "2026-09-draft";

export type ConsentVerification = {
  /** Which method verified the parent, e.g. "dev_attestation" or a vendor's name. */
  method: string;
  /** The verifier's reference id. Never raw card numbers or ID images. */
  verificationRef: string | null;
};

export type ConsentVerificationInput = {
  parentUserId: string;
  /** The parent ticked "I am this child's parent or legal guardian and I consent". */
  attested: boolean;
};

/**
 * Verifies that the adult giving consent is the child's parent.
 *
 * Only `dev_attestation` exists today: a click-through that is NOT verifiable parental consent
 * under COPPA, and `env()` refuses it in production. Real methods (for example a card check or
 * government-ID check through a consent vendor) are chosen with counsel and added here.
 */
export async function verifyParentConsent(
  input: ConsentVerificationInput,
): Promise<ConsentVerification | null> {
  switch (env().CONSENT_VERIFIER) {
    case "dev_attestation":
      return input.attested ? { method: "dev_attestation", verificationRef: null } : null;
  }
}
