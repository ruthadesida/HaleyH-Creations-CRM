import { describe, expect, it } from "vitest";
import { fillTemplate } from "./templates";

describe("fillTemplate", () => {
  it("fills known placeholders", () => {
    expect(fillTemplate("Hello {first_name}, {balance} is due on {order_number}.", { first_name: "Ngozi", balance: "₦70,000", order_number: "HC-00012" }))
      .toBe("Hello Ngozi, ₦70,000 is due on HC-00012.");
  });
  it("leaves unknown or missing placeholders visible so staff notice them", () => {
    expect(fillTemplate("Hi {first_name} {nickname}", {})).toBe("Hi {first_name} {nickname}");
  });
  it("allows an empty value (e.g. no courier)", () => {
    expect(fillTemplate("On its way{courier}.", { courier: "" })).toBe("On its way.");
  });
});
