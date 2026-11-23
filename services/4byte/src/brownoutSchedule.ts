import type { BrownoutConfig } from "./api/brownout";

// Brownout of the openchain.xyz hosts, see argotorg/sourcify#3061
export const brownoutSchedule: BrownoutConfig = {
  "api.openchain.xyz": [
    // Week 1-2: 1h weekly
    { start: "2026-12-08T14:00:00Z", end: "2026-12-08T15:00:00Z" },
    { start: "2026-12-15T14:00:00Z", end: "2026-12-15T15:00:00Z" },
    // No windows from Dec 22 to Jan 5
    // Week 3-4: 4h weekly
    { start: "2027-01-12T14:00:00Z", end: "2027-01-12T18:00:00Z" },
    { start: "2027-01-19T14:00:00Z", end: "2027-01-19T18:00:00Z" },
    // Week 5-6: 8h weekly
    { start: "2027-01-26T10:00:00Z", end: "2027-01-26T18:00:00Z" },
    { start: "2027-02-02T10:00:00Z", end: "2027-02-02T18:00:00Z" },
    // Week 7-8: 24h weekly
    { start: "2027-02-09T00:00:00Z", end: "2027-02-10T00:00:00Z" },
    { start: "2027-02-16T00:00:00Z", end: "2027-02-17T00:00:00Z" },
    // Week 9+: permanent shutdown
    { start: "2027-02-23T00:00:00Z", end: "2028-01-01T00:00:00Z" },
  ],
};
