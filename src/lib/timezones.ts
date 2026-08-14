/**
 * The IANA timezone list, in the shape a picker needs it.
 *
 * Zones come from the runtime's own database (`Intl.supportedValuesOf`), so
 * the list can never drift from what the scheduler — and the validation in
 * `@/modules/groups/schemas` — will accept. Engines too old to have it get a
 * short hand-written list rather than an empty picker.
 *
 * Offsets are the ones in force right now, so a zone on summer time says so,
 * the same way the clock on the wall does.
 */

const FALLBACK_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export type TimezoneOption = {
  /** IANA identifier — the value that gets stored. */
  readonly zone: string;
  /** `America/New_York` → `America / New York`. */
  readonly label: string;
  /** Offset in force now, e.g. `GMT+02:00`. */
  readonly offsetLabel: string;
  /** Minutes east of UTC, used for ordering. */
  readonly offsetMinutes: number;
  /** Name, identifier and offsets, normalised, for `filterTimezones`. */
  readonly search: string;
};

function supportedTimezones(): readonly string[] {
  try {
    const zones = Intl.supportedValuesOf?.("timeZone");
    return zones && zones.length > 0 ? zones : FALLBACK_ZONES;
  } catch {
    return FALLBACK_ZONES;
  }
}

/**
 * Whether the runtime will accept `zone`, asked the same way the server-side
 * schema asks it. Aliases the zone list omits (`Asia/Calcutta`) pass here, so
 * a browser that reports one is not told its own timezone does not exist.
 */
export function isSupportedTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The device's own zone, or null when the runtime cannot name one we accept. */
export function detectTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isSupportedTimezone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * Accents, underscores and slashes folded away, so `sao paulo` finds
 * `America/Sao_Paulo` and `são` finds it too.
 */
export function normaliseSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[_/,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minutes east of UTC for `zone` at `at`, or null if the runtime cannot say. */
function offsetMinutesAt(zone: string, at: Date): number | null {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    if (!name) return null;
    // Bare `GMT` on the prime meridian, `GMT+05:30` everywhere else.
    if (name === "GMT" || name === "UTC") return 0;
    const match = /^(?:GMT|UTC)([+-])(\d{1,2}):?(\d{2})?$/.exec(name);
    if (!match) return null;
    const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
    return match[1] === "-" ? -minutes : minutes;
  } catch {
    return null;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** One zone, described. Exported for the value a picker shows while closed. */
export function describeTimezone(
  zone: string,
  at: Date = new Date(),
): TimezoneOption {
  const label = zone.replace(/_/g, " ").replace(/\//g, " / ");
  const offsetMinutes = offsetMinutesAt(zone, at) ?? 0;
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  const padded = `${sign}${pad(hours)}:${pad(minutes)}`;
  // `+2` as well as `+02:00`: both are things people type.
  const short =
    minutes === 0 ? `${sign}${hours}` : `${sign}${hours}:${minutes}`;

  return {
    zone,
    label,
    offsetLabel: `GMT${padded}`,
    offsetMinutes,
    search: normaliseSearchText(
      `${label} ${zone} GMT${padded} GMT${short} UTC${padded} UTC${short}`,
    ),
  };
}

let cached: readonly TimezoneOption[] | null = null;

/**
 * Every zone the runtime knows, ordered by offset and then by name — the
 * order someone browsing rather than searching expects.
 *
 * Built once: describing ~400 zones means ~400 `Intl.DateTimeFormat`
 * instances, which is worth doing at most once per process.
 */
export function timezoneOptions(): readonly TimezoneOption[] {
  if (!cached) {
    const now = new Date();
    cached = supportedTimezones()
      .map((zone) => describeTimezone(zone, now))
      .sort(
        (a, b) =>
          a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label),
      );
  }
  return cached;
}

/**
 * The zones matching `query`, every term of which has to appear somewhere —
 * so `eur par` narrows to `Europe / Paris` the way a person expects it to.
 */
export function filterTimezones(
  options: readonly TimezoneOption[],
  query: string,
): readonly TimezoneOption[] {
  const terms = normaliseSearchText(query).split(" ").filter(Boolean);
  if (terms.length === 0) return options;
  return options.filter((option) =>
    terms.every((term) => option.search.includes(term)),
  );
}
