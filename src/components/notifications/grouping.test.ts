import { describe, expect, it } from "vitest";
import {
  buildSections,
  countRows,
  visibleRows,
  type DaySection,
  type InboxRow,
} from "./grouping";
import type { NotificationType } from "@/modules/notifications/types";

/**
 * The arithmetic behind the list.
 *
 * Everything asserted here is what the reader sees before they read a word:
 * which day a thing sits under, whether the group named itself again, whether
 * three edits to one expense are three lines or one. All of it is pure, so
 * none of these tests renders anything.
 */

let counter = 0;

function row(overrides: Partial<InboxRow> = {}): InboxRow {
  counter += 1;
  return {
    id: `n${counter}`,
    type: "expense.created" as NotificationType,
    groupId: "chalet",
    groupName: "Chalet",
    entityId: `e${counter}`,
    actor: "Hervé",
    subject: "Raclette",
    title: "",
    sentence: "Hervé added Raclette",
    amount: "CHF 25.00",
    url: "/groups/chalet/expenses/e1",
    createdAt: "2026-08-24T09:00:00.000Z",
    day: "today" as DaySection,
    read: false,
    ...overrides,
  };
}

describe("sectioning by day", () => {
  it("renders the three sections in order and skips the empty ones", () => {
    const sections = buildSections(
      [row({ day: "earlier" }), row({ day: "today" })],
      { filter: "all" },
    );

    expect(sections.map((section) => section.day)).toEqual([
      "today",
      "earlier",
    ]);
  });

  it("shows nothing at all when every row was filtered away", () => {
    expect(buildSections([row({ read: true })], { filter: "unread" })).toEqual(
      [],
    );
  });
});

describe("naming the group only when it changes", () => {
  /**
   * Sixteen rows from three groups do not need sixteen labels. One per run is
   * what a reader actually uses to know where they are.
   */
  it("prints the chip once per run of consecutive rows from one group", () => {
    const [section] = buildSections(
      [
        row({ groupId: "chalet" }),
        row({ groupId: "chalet" }),
        row({ groupId: "multi" }),
        row({ groupId: "chalet" }),
      ],
      { filter: "all" },
    );

    expect(
      section!.items.map((item) => "showChip" in item && item.showChip),
    ).toEqual([true, false, true, true]);
  });

  /** Each day starts over: the first row under a heading always says where it is. */
  it("starts the run again in the next section", () => {
    const sections = buildSections(
      [row({ groupId: "chalet" }), row({ groupId: "chalet", day: "earlier" })],
      { filter: "all" },
    );

    for (const section of sections) {
      expect(
        "showChip" in section.items[0]! && section.items[0]!.showChip,
      ).toBe(true);
    }
  });

  /** A card is a break in the list; the group under it introduces itself again. */
  it("treats a reminder card as the end of a run", () => {
    const [section] = buildSections(
      [
        row({ groupId: "chalet" }),
        row({ groupId: "chalet", type: "reminder.received" }),
        row({ groupId: "chalet" }),
      ],
      { filter: "all" },
    );

    const chips = section!.items.map((item) =>
      "showChip" in item ? item.showChip : null,
    );
    expect(chips).toEqual([true, null, true]);
  });
});

describe("folding a burst of changes to one thing", () => {
  it("collapses consecutive rows about the same entity by the same person", () => {
    const [section] = buildSections(
      [
        row({ entityId: "jardinier", type: "expense.deleted" }),
        row({ entityId: "jardinier", type: "expense.updated" }),
        row({ entityId: "jardinier", type: "expense.created" }),
      ],
      { filter: "all" },
    );

    expect(section!.items).toHaveLength(1);
    const [item] = section!.items;
    expect(item!.kind).toBe("burst");
    expect("rows" in item! && item.rows).toHaveLength(3);
  });

  /** Two rows are a burst; one is a sentence, and hiding it would help nobody. */
  it("leaves a single change as an ordinary row", () => {
    const [section] = buildSections([row({ entityId: "jardinier" })], {
      filter: "all",
    });

    expect(section!.items[0]!.kind).toBe("activity");
  });

  /**
   * "Hervé made 3 changes" is a claim about Hervé. Two people editing one
   * expense stay two rows rather than becoming one sentence that is untrue of
   * whoever is not named.
   */
  it("does not fold two people's changes into one person's sentence", () => {
    const [section] = buildSections(
      [
        row({ entityId: "jardinier", actor: "Hervé" }),
        row({ entityId: "jardinier", actor: "Alice" }),
      ],
      { filter: "all" },
    );

    expect(section!.items.map((item) => item.kind)).toEqual([
      "activity",
      "activity",
    ]);
  });

  /** A run is consecutive: something else in between ends it. */
  it("does not reach across an unrelated row", () => {
    const [section] = buildSections(
      [
        row({ entityId: "jardinier" }),
        row({ entityId: "raclette" }),
        row({ entityId: "jardinier" }),
      ],
      { filter: "all" },
    );

    expect(section!.items).toHaveLength(3);
  });

  /** Rows with nothing to be about cannot be the same thing twice. */
  it("never folds rows that name no entity", () => {
    const [section] = buildSections(
      [row({ entityId: null }), row({ entityId: null })],
      { filter: "all" },
    );

    expect(section!.items).toHaveLength(2);
  });

  /** A burst that crosses midnight is two runs, because it is two sections. */
  it("keeps a run inside the day it belongs to", () => {
    const sections = buildSections(
      [
        row({ entityId: "jardinier", day: "today" }),
        row({ entityId: "jardinier", day: "yesterday" }),
      ],
      { filter: "all" },
    );

    expect(sections).toHaveLength(2);
    for (const section of sections) {
      expect(section.items[0]!.kind).toBe("activity");
    }
  });
});

describe("gathering finished imports", () => {
  const anImport = (over: Partial<InboxRow> = {}) =>
    row({
      type: "import.completed",
      actor: null,
      entityId: null,
      sentence: "Import finished: 577 added, 0 skipped, 0 not imported",
      amount: null,
      ...over,
    });

  /** Something the reader set going themselves does not interrupt the news. */
  it("sinks them to the foot of their day", () => {
    const [section] = buildSections([anImport(), row(), row()], {
      filter: "all",
    });

    expect(section!.items.map((item) => item.kind)).toEqual([
      "activity",
      "activity",
      "digest",
    ]);
  });

  it("gathers two or more into one digest", () => {
    const [section] = buildSections([anImport(), anImport(), row()], {
      filter: "all",
    });

    const digest = section!.items.at(-1)!;
    expect(digest.kind).toBe("digest");
    expect("rows" in digest && digest.rows).toHaveLength(2);
  });

  /** Each day gathers its own; yesterday's imports are not today's news. */
  it("keeps each day's imports in that day", () => {
    const sections = buildSections(
      [anImport(), anImport({ day: "yesterday" })],
      { filter: "all" },
    );

    expect(sections).toHaveLength(2);
    for (const section of sections) {
      expect(
        "rows" in section.items[0]! && section.items[0]!.rows,
      ).toHaveLength(1);
    }
  });

  /** An import carries no group chip: it is a footnote, not an event. */
  it("gives a digest no group chip", () => {
    const [section] = buildSections([anImport()], { filter: "all" });

    expect("showChip" in section!.items[0]!).toBe(false);
  });
});

describe("the counts beside the filters", () => {
  it("counts unread and reminders over the same set", () => {
    expect(
      countRows([
        row(),
        row({ read: true }),
        row({ type: "reminder.received" }),
      ]),
    ).toEqual({ unread: 2, reminders: 1 });
  });

  /**
   * A group that has been quietened drops out of the counts as well as the
   * list. A badge that keeps counting what it refuses to show is a badge
   * nobody can clear.
   */
  it("leaves out a group that has been muted or snoozed", () => {
    const rows = [row({ groupId: "chalet" }), row({ groupId: "multi" })];

    expect(
      countRows(visibleRows(rows, { suppressedGroups: ["chalet"] })),
    ).toEqual({ unread: 1, reminders: 0 });
  });

  it("leaves out a row swiped away in this session", () => {
    const kept = row();
    const gone = row();

    expect(
      countRows(visibleRows([kept, gone], { dismissed: [gone.id] })),
    ).toEqual({ unread: 1, reminders: 0 });
  });
});

describe("narrowing the list", () => {
  it("keeps only the unread ones", () => {
    const [section] = buildSections([row(), row({ read: true })], {
      filter: "unread",
    });

    expect(section!.items).toHaveLength(1);
  });

  it("keeps only the reminders", () => {
    const [section] = buildSections(
      [row(), row({ type: "reminder.received" })],
      { filter: "reminders" },
    );

    expect(section!.items.map((item) => item.kind)).toEqual(["reminder"]);
  });

  /**
   * Filtering happens before folding, so a run whose middle row was filtered
   * out folds as the run that is actually on screen rather than as the one in
   * the data.
   */
  it("folds what survives the filter, not what was there before it", () => {
    const [section] = buildSections(
      [
        row({ entityId: "jardinier" }),
        row({ entityId: "jardinier", read: true }),
        row({ entityId: "jardinier" }),
      ],
      { filter: "unread" },
    );

    expect(section!.items).toHaveLength(1);
    expect(
      "rows" in section!.items[0]! && section!.items[0]!.rows,
    ).toHaveLength(2);
  });
});
