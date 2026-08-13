"use client";

import { cn } from "@/lib/utils";

/**
 * Timezone picker driven by the runtime's own IANA database
 * (`Intl.supportedValuesOf`), so the list can never drift from what the
 * scheduler will accept. Falls back to a small list on older engines.
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

function supportedTimezones(): string[] {
  try {
    const zones = Intl.supportedValuesOf?.("timeZone");
    return zones && zones.length > 0 ? [...zones] : FALLBACK_ZONES;
  } catch {
    return FALLBACK_ZONES;
  }
}

export function TimezoneSelect({
  id,
  name,
  defaultValue,
  className,
}: {
  id?: string;
  name?: string;
  defaultValue: string;
  className?: string;
}) {
  const zones = supportedTimezones();
  const withDefault = zones.includes(defaultValue)
    ? zones
    : [defaultValue, ...zones];

  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
        className,
      )}
    >
      {withDefault.map((zone) => (
        <option key={zone} value={zone}>
          {zone.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
