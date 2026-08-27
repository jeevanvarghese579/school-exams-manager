import { describe, expect, it } from "vitest";
import {
  languageForRoll,
  parseRollList,
  validateLanguageRanges,
} from "./languages";

describe("second-language roll lists", () => {
  it("parses ranges and individual rolls without rewriting raw punctuation", () =>
    expect(parseRollList("1-10, 14, 18-22").rolls).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 18, 19, 20, 21, 22,
    ]));
  it("accepts a trailing comma while typing", () =>
    expect(parseRollList("1-10,").rolls).toHaveLength(10));
  it("reports duplicate, missing, outside and malformed rolls", () => {
    const result = validateLanguageRanges(
      [
        { id: "a", language: "Hindi", fromRoll: 1, toRoll: 1, rolls: "1-2, x" },
        {
          id: "b",
          language: "Malayalam",
          fromRoll: 1,
          toRoll: 1,
          rolls: "2, 5",
        },
      ],
      1,
      4,
    );
    expect(result.duplicates).toEqual([2]);
    expect(result.missing).toEqual([3, 4]);
    expect(result.outside).toEqual([5]);
    expect(result.malformed).toEqual(["Hindi: x"]);
  });
  it("resolves the configured paper for a roll", () =>
    expect(
      languageForRoll(
        [{ id: "a", language: "Arabic", fromRoll: 1, toRoll: 3, rolls: "1-3" }],
        2,
      ),
    ).toBe("Arabic"));
});
