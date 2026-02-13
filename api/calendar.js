// /api/calendar.js
// Vercel serverless function — serves a live .ics feed of all approved time off.
// Subscribe to this URL in Google Calendar, Outlook, or Apple Calendar:
//   https://your-app.vercel.app/api/calendar

const SUPABASE_URL = "https://hhobwuwautnddjzewizo.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Set in Vercel env vars

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Use service key to bypass RLS (this runs server-side only)
    const apiKey = SUPABASE_SERVICE_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "SUPABASE_SERVICE_KEY not configured" });
    }

    // Fetch all approved requests with employee names
    const requestsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/time_off_requests?status=eq.approved&select=id,dates,employee_id,profiles(name)`,
      {
        headers: {
          "apikey": apiKey,
          "Authorization": `Bearer ${apiKey}`,
        },
      }
    );

    if (!requestsRes.ok) {
      const err = await requestsRes.text();
      console.error("Supabase error:", err);
      return res.status(500).json({ error: "Failed to fetch data" });
    }

    const requests = await requestsRes.json();

    // Build ICS
    let ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//VacationTracker//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Team Time Off",
      "X-WR-TIMEZONE:America/Chicago",
      // Refresh every 12 hours
      "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
      "X-PUBLISHED-TTL:PT12H",
    ];

    for (const req of requests) {
      const name = req.profiles?.name || "Unknown";
      const dates = (req.dates || []).sort();
      if (!dates.length) continue;

      // Group consecutive dates into ranges
      const ranges = [];
      let start = dates[0];
      let prev = dates[0];

      for (let i = 1; i < dates.length; i++) {
        const prevDate = new Date(prev);
        const currDate = new Date(dates[i]);
        const diffDays = (currDate - prevDate) / (1000 * 60 * 60 * 24);
        if (diffDays <= 3) {
          prev = dates[i];
        } else {
          ranges.push([start, prev]);
          start = dates[i];
          prev = dates[i];
        }
      }
      ranges.push([start, prev]);

      for (let k = 0; k < ranges.length; k++) {
        const [rangeStart, rangeEnd] = ranges[k];
        // DTEND is exclusive, so add 1 day
        const endDate = new Date(rangeEnd);
        endDate.setDate(endDate.getDate() + 1);
        const endStr = fmtDate(endDate);

        ics.push(
          "BEGIN:VEVENT",
          `DTSTART;VALUE=DATE:${rangeStart.replace(/-/g, "")}`,
          `DTEND;VALUE=DATE:${endStr}`,
          `SUMMARY:${name} - Time Off`,
          `UID:${req.id}-${k}@vacationtracker`,
          "STATUS:CONFIRMED",
          "TRANSP:TRANSPARENT",
          "END:VEVENT"
        );
      }
    }

    ics.push("END:VCALENDAR");

    // Serve as .ics with cache headers (cache for 1 hour, revalidate)
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="team-time-off.ics"');
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=7200");
    res.status(200).send(ics.join("\r\n"));

  } catch (error) {
    console.error("Calendar generation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function fmtDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
