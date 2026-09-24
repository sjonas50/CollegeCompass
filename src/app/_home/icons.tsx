import type { ReactNode } from "react";

/** Small line icons for the home page, drawn inline. Always decorative: the text next to them says it. */
function Icon({ children, className = "size-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

type P = { className?: string };

export const CompassIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5z" />
  </Icon>
);

export const StarIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={`shrink-0 ${className ?? ""}`}>
    <path fill="currentColor" d="M12 2.8l2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 16.83l-5.5 2.9 1.05-6.13L3.1 9.27l6.15-.9z" />
  </svg>
);

export const CheckIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const ChatIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M20 12.5a7.5 7.5 0 0 1-11 6.6L4 20l1-4.3A7.5 7.5 0 1 1 20 12.5z" />
  </Icon>
);

export const LockIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const EyeIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.75" />
  </Icon>
);

export const ShieldIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 3 19 6v5.5c0 4.4-3 7.9-7 9.5-4-1.6-7-5.1-7-9.5V6z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const HeartIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />
  </Icon>
);

export const ArrowIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const ChevronIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const MailIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
    <path d="m4 7 8 6 8-6" />
  </Icon>
);

export const FamilyIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="8" cy="7.5" r="2.5" />
    <circle cx="16.5" cy="9" r="2" />
    <path d="M3.5 19v-1.5A4.5 4.5 0 0 1 12.5 17.5V19M13.5 19v-1a3 3 0 0 1 6 0v1" />
  </Icon>
);

export const SearchIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);

export const BookIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
    <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
  </Icon>
);

export const BriefcaseIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
    <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 13h17" />
  </Icon>
);

export const BuildingIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M3.5 9 12 4.5 20.5 9M5 9.5v8M9.5 9.5v8M14.5 9.5v8M19 9.5v8M3.5 20h17" />
  </Icon>
);

export const CalendarCheckIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    <path d="m9 14.5 2 2 4-4" />
  </Icon>
);

export const MapIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z" />
    <path d="M9 4v14M15 6v14" />
  </Icon>
);

export const FlagIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" />
  </Icon>
);

export const DownloadIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />
  </Icon>
);

export const HandIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 21c-4 0-7-2.6-7-6.5V11a1.5 1.5 0 0 1 3 0v1" />
    <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M14 11V6a1.5 1.5 0 0 1 3 0v8.5c0 3.9-2 6.5-5 6.5" />
  </Icon>
);

export const NoAdsIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" />
  </Icon>
);

export const GiftIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="4" y="9" width="16" height="11" rx="1.5" />
    <path d="M3 9h18M12 9v11M12 9S9.5 4 7.5 5.5 9 9 12 9zm0 0s2.5-5 4.5-3.5S15 9 12 9z" />
  </Icon>
);
