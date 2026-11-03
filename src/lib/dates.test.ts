import { describe, expect, it } from "vitest";
import {
  addDays, daysUntil, endOfDayUtc, localMidnightUtc, relativeDue, startOfMonth, todayIn, utcToZonedInput, zonedInputToUtc,
} from "./dates";

// 23:30 UTC on 3 Nov is already 00:30 on 4 Nov in Lagos (UTC+1).
const lateUtc = new Date("2026-11-03T23:30:00Z");

describe("todayIn", () => {
  it("uses the business time zone, not UTC", () => {
    expect(todayIn("Africa/Lagos", lateUtc)).toBe("2026-11-04");
    expect(todayIn("UTC", lateUtc)).toBe("2026-11-03");
  });
});

describe("day boundaries", () => {
  it("local midnight in Lagos is 23:00 UTC the previous day", () => {
    expect(localMidnightUtc("2026-11-04")).toBe("2026-11-03T23:00:00.000Z");
    expect(endOfDayUtc("2026-11-04")).toBe("2026-11-04T23:00:00.000Z");
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("finds the start of the month", () => {
    expect(startOfMonth("2026-11-17")).toBe("2026-11-01");
  });
});

describe("zoned datetime inputs", () => {
  it("treats a typed time as Lagos time", () => {
    expect(zonedInputToUtc("2026-11-04T10:30")).toBe("2026-11-04T09:30:00.000Z");
  });
  it("round-trips", () => {
    expect(utcToZonedInput(zonedInputToUtc("2026-11-04T00:15"))).toBe("2026-11-04T00:15");
  });
  it("rejects malformed input", () => {
    expect(zonedInputToUtc("tomorrow")).toBeNull();
    expect(utcToZonedInput(null)).toBe("");
  });
});

describe("relativeDue", () => {
  it.each([
    ["2026-11-04", "Today"],
    ["2026-11-05", "Tomorrow"],
    ["2026-11-03", "Yesterday"],
    ["2026-11-08", "In 4 days"],
    ["2026-11-01", "3 days overdue"],
  ])("%s → %s", (date, label) => {
    expect(relativeDue(date, "Africa/Lagos", lateUtc)).toBe(label);
  });
  it("counts whole days", () => {
    expect(daysUntil("2026-11-11", "Africa/Lagos", lateUtc)).toBe(7);
  });
});
