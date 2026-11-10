import { describe, expect, it } from "vitest";
import { getManaAbility, parseManaCost, planPayment } from "./mana";
import { BEAR, ELF, FOREST, MOUNTAIN, fakeCard, makePermanent } from "./testHelpers";

describe("parseManaCost", () => {
  it("splits generic and colored requirements", () => {
    const cost = parseManaCost("{2}{R}");
    expect(cost?.generic).toBe(2);
    expect(cost?.colored.R).toBe(1);
  });

  it("counts repeated colors", () => {
    expect(parseManaCost("{R}{R}")?.colored.R).toBe(2);
  });

  it("treats an empty cost as free", () => {
    const cost = parseManaCost("");
    expect(cost?.generic).toBe(0);
  });

  it("returns null for costs it can't handle", () => {
    expect(parseManaCost("{X}{R}")).toBeNull();
    expect(parseManaCost("{W/U}")).toBeNull();
  });
});

describe("getManaAbility", () => {
  it("reads a basic land's reminder text", () => {
    expect(getManaAbility(FOREST)).toBe("G");
    expect(getManaAbility(MOUNTAIN)).toBe("R");
  });

  it("reads a creature's mana ability", () => {
    expect(getManaAbility(ELF)).toBe("G");
  });

  it("returns null for cards that don't make mana", () => {
    expect(getManaAbility(BEAR)).toBeNull();
    expect(getManaAbility(fakeCard("Flyer", ["Creature"], { oracleText: "Flying" }))).toBeNull();
  });
});

describe("planPayment", () => {
  const cost = (text: string) => {
    const parsed = parseManaCost(text);
    if (!parsed) throw new Error("bad cost in test");
    return parsed;
  };

  it("pays with lands that produce the right colors", () => {
    const f1 = makePermanent("p1", FOREST);
    const f2 = makePermanent("p1", FOREST);
    const plan = planPayment([f1, f2], cost("{1}{G}"));
    expect(plan).toHaveLength(2);
  });

  it("returns null when a color can't be produced", () => {
    const m = makePermanent("p1", MOUNTAIN);
    expect(planPayment([m], cost("{G}"))).toBeNull();
  });

  it("returns null when there isn't enough mana", () => {
    const f = makePermanent("p1", FOREST);
    expect(planPayment([f], cost("{1}{G}"))).toBeNull();
  });

  it("uses off-color lands for generic costs", () => {
    const f = makePermanent("p1", FOREST);
    const m = makePermanent("p1", MOUNTAIN);
    const plan = planPayment([f, m], cost("{1}{G}"));
    expect(plan).toHaveLength(2);
  });

  it("doesn't tap a land it doesn't need", () => {
    const f1 = makePermanent("p1", FOREST);
    const f2 = makePermanent("p1", FOREST);
    const m = makePermanent("p1", MOUNTAIN);
    const plan = planPayment([f1, f2, m], cost("{G}{G}"));
    expect(plan).toHaveLength(2);
    expect(plan).not.toContain(m.instanceId);
  });

  it("ignores tapped permanents", () => {
    const tapped = makePermanent("p1", FOREST, { tapped: true });
    expect(planPayment([tapped], cost("{G}"))).toBeNull();
  });

  it("prefers lands over mana creatures", () => {
    const land = makePermanent("p1", FOREST);
    const elf = makePermanent("p1", ELF);
    const plan = planPayment([elf, land], cost("{G}"));
    expect(plan).toEqual([land.instanceId]);
  });

  it("can't use a summoning-sick mana creature", () => {
    const sickElf = makePermanent("p1", ELF, { summoningSick: true });
    expect(planPayment([sickElf], cost("{G}"))).toBeNull();
  });

  it("can use a mana creature once it's no longer summoning sick", () => {
    const elf = makePermanent("p1", ELF, { summoningSick: false });
    expect(planPayment([elf], cost("{G}"))).toEqual([elf.instanceId]);
  });

  it("pays a free cost with nothing tapped", () => {
    expect(planPayment([], cost(""))).toEqual([]);
  });
});