import { describe, expect, it } from "vitest";
import { cleanSearch, searchDigits } from "./search";

describe("cleanSearch", () => {
  it("keeps ordinary names and emails", () => {
    expect(cleanSearch("  Ada  Okafor ")).toBe("Ada Okafor");
    expect(cleanSearch("ada.o+shop@gmail.com")).toBe("ada.o+shop@gmail.com");
  });
  it.each([
    ["ada,email.eq.x", "ada email.eq.x"],
    ["x),or(id.neq.0", "x or id.neq.0"],
    ["%_*\\", "_"],
    ["O'Brien", "O Brien"],
    ['a"b', "a b"],
  ])("neutralises filter syntax in %j", (input, expected) => {
    expect(cleanSearch(input)).toBe(expected);
  });
  it("never leaves characters that split or group PostgREST filters", () => {
    for (const s of ["a,b", "a(b)", "a)b", 'a"b', "a\\b"]) {
      expect(cleanSearch(s)).not.toMatch(/[,()"\\]/);
    }
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
