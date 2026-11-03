import { describe, expect, it } from "vitest";
import { cleanSearch, searchDigits } from "./search";

describe("cleanSearch", () => {
  it("keeps ordinary names", () => {
    expect(cleanSearch("  Ada  Okafor ")).toBe("Ada Okafor");
  });
  it.each([
    ["ada,email.eq.x", "ada email eq x"],
    ["x),or(id.neq.0", "x or id neq 0"],
    ["%_*\\", "_"],
    ["O'Brien", "O Brien"],
  ])("neutralises filter syntax in %j", (input, expected) => {
    expect(cleanSearch(input)).toBe(expected);
  });
  it("caps length and ignores non-strings", () => {
    expect(cleanSearch("a".repeat(100))).toHaveLength(60);
    expect(cleanSearch(["a"])).toBe("");
  });
});

describe("searchDigits", () => {
  it("drops a leading 0 so local numbers match international ones", () => {
    expect(searchDigits("0803 111")).toBe("803111");
    expect(searchDigits("+234 803")).toBe("234803");
    expect(searchDigits("Ada")).toBe("");
  });
});
