import type { KeyboardEvent } from "react";

/**
 * The keyboard for a one-of-many control drawn by hand.
 *
 * A row of chips marked `role="radio"`, or a switcher marked `role="tab"`,
 * promises a screen reader two things the markup does not do on its own: that
 * the whole group is one stop on the Tab key, and that the arrow keys move
 * through it. Every one of these was drawn as a row of plain buttons, so Tab
 * walked through all of them — twenty stops across the icon picker's two
 * grids — and the arrows did nothing at all.
 *
 * This puts both back without touching how any of them look. The chosen item
 * is the one Tab lands on — the first, while nothing is chosen — and the
 * arrows, Home and End move to another item and choose it, which is what a
 * radio and an automatically activated tab both do, and what Radix does for
 * the controls it draws itself. A disabled item is stepped over.
 *
 * A grid says how many `columns` it has, and then up and down move a row
 * rather than an item: in a five-wide grid of icons, the key pointing down
 * should land under the icon it left, not beside it.
 *
 * A plain function rather than a hook, because nothing here is state. The
 * group is found from the key press itself, so an item keeps whatever markup
 * it already had — a `<li>` around it, a component in between — and needs only
 * the two props this returns. The one thing it relies on is that the items
 * appear in the group in the same order as `values`.
 */

const GROUP = '[role="radiogroup"], [role="tablist"]';
const ITEM = '[role="radio"], [role="tab"]';

export interface RovingChoiceProps {
  tabIndex: number;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export function rovingChoice<T>({
  values,
  selected,
  onSelect,
  isDisabled = () => false,
  columns = 1,
}: {
  /** Every item, in the order they are drawn. */
  values: readonly T[];
  /** The chosen one, or nothing yet. */
  selected: T | null | undefined;
  onSelect: (value: T) => void;
  isDisabled?: (value: T) => boolean;
  /** How many items a row holds, for a grid. One for a single line. */
  columns?: number;
}): (value: T) => RovingChoiceProps {
  const enabled = values.filter((value) => !isDisabled(value));
  const landing =
    selected !== null && selected !== undefined && enabled.includes(selected)
      ? selected
      : enabled[0];

  return (value) => ({
    tabIndex: value === landing ? 0 : -1,
    onKeyDown: (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const from = values.indexOf(value);
      const to = destination(event.key, from, values.length, columns, (index) =>
        isDisabled(values[index] as T),
      );
      if (to === undefined) return;
      // A key this group answers never scrolls the page as well, even when
      // there is nowhere further for it to go.
      event.preventDefault();
      if (to === null) return;

      const group = event.currentTarget.closest(GROUP);
      const items = group
        ? Array.from(group.querySelectorAll<HTMLElement>(ITEM)).filter(
            (item) => item.closest(GROUP) === group,
          )
        : [];
      items[to]?.focus();
      onSelect(values[to] as T);
    },
  });
}

/**
 * Where a key sends focus from `from`.
 *
 * `undefined` for a key this does not handle, so the caller leaves it alone;
 * `null` for one it handles that has nowhere to go — the bottom row of a grid,
 * or a group with nothing else enabled in it.
 */
function destination(
  key: string,
  from: number,
  count: number,
  columns: number,
  disabled: (index: number) => boolean,
): number | null | undefined {
  /** Steps until an enabled item, wrapping only a line, never a grid's rows. */
  const walk = (stride: number, wrap: boolean): number | null => {
    let index = from;
    for (let tries = 0; tries < count; tries += 1) {
      index += stride;
      if (index < 0 || index >= count) {
        if (!wrap) return null;
        index = (index + count) % count;
      }
      if (index === from) return null;
      if (!disabled(index)) return index;
    }
    return null;
  };
  const edge = (start: number, stride: number): number | null => {
    for (let index = start; index >= 0 && index < count; index += stride) {
      if (!disabled(index)) return index === from ? null : index;
    }
    return null;
  };

  const grid = columns > 1;
  switch (key) {
    case "ArrowRight":
      return walk(1, true);
    case "ArrowLeft":
      return walk(-1, true);
    case "ArrowDown":
      return grid ? walk(columns, false) : walk(1, true);
    case "ArrowUp":
      return grid ? walk(-columns, false) : walk(-1, true);
    case "Home":
      return edge(0, 1);
    case "End":
      return edge(count - 1, -1);
    default:
      return undefined;
  }
}
