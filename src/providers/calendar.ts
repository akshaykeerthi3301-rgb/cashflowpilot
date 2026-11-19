// Fake founder calendar: weekday slots at 10:30 and 15:00 IST. The booking is real enough to export as .ics.
const SLOTS_UTC = [
  [5, 0],
  [9, 30],
] as const; // 10:30 and 15:00 IST

export function nextSlot(taken: string[], now = new Date()): string {
  for (let day = 1; day < 30; day++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day));
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    for (const [h, m] of SLOTS_UTC) {
      const iso = new Date(d.getTime() + (h * 60 + m) * 60_000).toISOString();
      if (!taken.includes(iso)) return iso;
    }
  }
  throw new Error("calendar full");
}

const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function ics(opts: { uid: string; startIso: string; title: string; attendee: string; description: string }): string {
  const end = new Date(new Date(opts.startIso).getTime() + 30 * 60_000).toISOString();
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CashFlowPilot demo//EN",
    "BEGIN:VEVENT",
    `UID:${opts.uid}@cashflowpilot.example`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(opts.startIso)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${opts.title}`,
    `DESCRIPTION:${opts.description.replace(/\n/g, "\\n")}`,
    "ORGANIZER:mailto:founder@cashflowpilot.example",
    `ATTENDEE:mailto:${opts.attendee}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
