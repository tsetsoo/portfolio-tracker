import { describe, expect, it } from "vitest";

import {
  alertsIntervalMs,
  alertsSchedulerEnabled,
} from "@/lib/alerts/scheduler";

describe("alertsSchedulerEnabled", () => {
  it("runs in production by default", () => {
    expect(alertsSchedulerEnabled({ NODE_ENV: "production" })).toBe(true);
  });

  it("stays off in development unless opted in", () => {
    expect(alertsSchedulerEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(
      alertsSchedulerEnabled({ NODE_ENV: "development", ALERTS_ENABLED: "1" }),
    ).toBe(true);
  });

  it("can be switched off in production", () => {
    expect(
      alertsSchedulerEnabled({ NODE_ENV: "production", ALERTS_ENABLED: "0" }),
    ).toBe(false);
  });
});

describe("alertsIntervalMs", () => {
  it("defaults to ten minutes", () => {
    expect(alertsIntervalMs({})).toBe(600_000);
  });

  it("honours a valid override", () => {
    expect(alertsIntervalMs({ ALERTS_INTERVAL_MS: "120000" })).toBe(120_000);
  });

  it("ignores junk and sub-minute values", () => {
    expect(alertsIntervalMs({ ALERTS_INTERVAL_MS: "abc" })).toBe(600_000);
    expect(alertsIntervalMs({ ALERTS_INTERVAL_MS: "1000" })).toBe(600_000);
    expect(alertsIntervalMs({ ALERTS_INTERVAL_MS: "-5" })).toBe(600_000);
  });

  it("truncates a non-integer override", () => {
    expect(alertsIntervalMs({ ALERTS_INTERVAL_MS: "600000.9" })).toBe(
      600_000,
    );
  });

  it("clamps above the 32-bit ceiling", () => {
    // Node clamps a setInterval delay above 2^31-1 to 1 ms, which would turn
    // the scheduler into a tight loop against the quote providers.
    expect(alertsIntervalMs({ ALERTS_INTERVAL_MS: "999999999999" })).toBe(
      2_147_483_647,
    );
  });
});
