/**
 * Time limit for the randomized sweeps that run the real planner over many students. They take a
 * few seconds on a laptop and several times that on shared CI runners.
 */
export const SWEEP_TIMEOUT_MS = 120_000;
