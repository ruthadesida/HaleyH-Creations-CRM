import { describe, expect, it } from "vitest";
import { dropPosition } from "./board";

const col = [
  { id: "a", position: 1 },
  { id: "b", position: 2 },
  { id: "c", position: 3 },
];

const order = (moved: string, pos: number, cards = col) =>
  [...cards.filter((c) => c.id !== moved), { id: moved, position: pos }].sort((x, y) => x.position - y.position).map((c) => c.id);

describe("dropPosition", () => {
  it("moves a card down onto the next card (lands below it)", () => {
    expect(order("a", dropPosition(col, "a", "b"))).toEqual(["b", "a", "c"]);
  });
  it("moves a card to the bottom when dropped on the last card", () => {
    expect(order("a", dropPosition(col, "a", "c"))).toEqual(["b", "c", "a"]);
  });
  it("moves a card up (lands above the card dropped on)", () => {
    expect(order("c", dropPosition(col, "c", "a"))).toEqual(["c", "a", "b"]);
    expect(order("c", dropPosition(col, "c", "b"))).toEqual(["a", "c", "b"]);
  });
  it("lands above the card dropped on when coming from another column", () => {
    expect(order("x", dropPosition(col, "x", "b"))).toEqual(["a", "x", "b", "c"]);
    expect(order("x", dropPosition(col, "x", "a"))).toEqual(["x", "a", "b", "c"]);
  });
  it("goes to the end when dropped on the column itself", () => {
    expect(order("x", dropPosition(col, "x", null))).toEqual(["a", "b", "c", "x"]);
    expect(dropPosition([], "x", null)).toBe(1);
  });
});
