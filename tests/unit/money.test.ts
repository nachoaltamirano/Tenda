import { describe, expect, it } from "vitest";
import { formatMoney, parseMoneyInput } from "@/lib/money";

describe("importes", () => {
  it("interpreta formatos argentinos", () => {
    expect(parseMoneyInput("45000")).toBe(4_500_000);
    expect(parseMoneyInput("45.000")).toBe(4_500_000);
    expect(parseMoneyInput("$ 45.000,50")).toBe(4_500_050);
    expect(parseMoneyInput("1.250.000")).toBe(125_000_000);
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
  });
  it("formatea", () => {
    expect(formatMoney(4_500_000)).toBe("$ 45.000");
    expect(formatMoney(null)).toBe("—");
  });
});
