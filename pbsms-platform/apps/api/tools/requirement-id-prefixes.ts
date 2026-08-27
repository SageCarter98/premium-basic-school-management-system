/**
 * Shared prefix family for SRS requirement IDs (FR-/NFR-/TEN-/DP-/BR-/SEC-),
 * used by both check-traceability.ts (EC-504) and detect-spec-gaps.ts
 * (EC-107). Deliberately excludes `EC-` — that's this repository's own
 * internal-engineering-process ticket namespace (CLAUDE.md's EC-series),
 * not an SRS requirement; conflating the two would make EC-107's gap
 * report report nonsense (an "unimplemented EC-501" is meaningless).
 */
export const SRS_ID_PREFIXES = ['FR', 'NFR', 'TEN', 'DP', 'BR', 'SEC'] as const;
