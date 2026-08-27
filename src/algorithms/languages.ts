import type { LanguageRange } from "../models";

export interface RollParse {
  rolls: number[];
  invalid: string[];
}
export function parseRollList(raw: string): RollParse {
  const rolls = new Set<number>();
  const invalid: string[] = [];
  for (const token of raw.split(",")) {
    const value = token.trim();
    if (!value) continue;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(value);
    if (!match) {
      invalid.push(value);
      continue;
    }
    const start = Number(match[1]),
      end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start) {
      invalid.push(value);
      continue;
    }
    for (let roll = start; roll <= end; roll++) rolls.add(roll);
  }
  return { rolls: [...rolls].sort((a, b) => a - b), invalid };
}
export interface LanguageValidation {
  duplicates: number[];
  missing: number[];
  outside: number[];
  malformed: string[];
  counts: Record<string, number>;
}
export function validateLanguageRanges(
  ranges: LanguageRange[],
  rollStart: number,
  studentCount: number,
): LanguageValidation {
  const end = rollStart + Math.max(studentCount - 1, 0);
  const owners = new Map<number, string[]>();
  const malformed: string[] = [];
  for (const range of ranges) {
    const raw = range.rolls ?? `${range.fromRoll}-${range.toRoll}`;
    const parsed = parseRollList(raw);
    malformed.push(
      ...parsed.invalid.map(
        (item) => `${range.language || "Unnamed"}: ${item}`,
      ),
    );
    for (const roll of parsed.rolls)
      owners.set(roll, [...(owners.get(roll) ?? []), range.language]);
  }
  const outside = [...owners.keys()]
    .filter((roll) => roll < rollStart || roll > end)
    .sort((a, b) => a - b);
  const duplicates = [...owners.entries()]
    .filter(([, languages]) => languages.length > 1)
    .map(([roll]) => roll)
    .sort((a, b) => a - b);
  const missing = Array.from(
    { length: studentCount },
    (_, index) => rollStart + index,
  ).filter((roll) => !owners.has(roll));
  const counts: Record<string, number> = {};
  for (const [roll, languages] of owners)
    if (
      roll >= rollStart &&
      roll <= end &&
      languages.length === 1 &&
      languages[0]
    )
      counts[languages[0]] = (counts[languages[0]] ?? 0) + 1;
  return { duplicates, missing, outside, malformed, counts };
}
export function languageForRoll(
  ranges: LanguageRange[] | undefined,
  roll: number,
): string | undefined {
  return ranges?.find((range) =>
    parseRollList(
      range.rolls ?? `${range.fromRoll}-${range.toRoll}`,
    ).rolls.includes(roll),
  )?.language;
}
