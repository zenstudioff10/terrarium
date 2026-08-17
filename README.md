# Terrarium

A time ledger for the fourteen hours you actually get: **06:00 – 20:00 Asia/Jakarta**.

Two plants sit in the middle of the page.

**The left jar is the future.** Its water level is the time still on the clock, and its leaves wilt from the tip down as the day drains. Nothing you did earlier touches it — an hour already spent has already moved the clock, and charging it again against the hours ahead would be counting the same hour twice.

**The right jar is the past.** It starts bare every morning and grows a leaf for every stretch of productive time, roots reaching down as you go. Its jar fills with what is gone: ochre sludge for time you wasted, a grey band riding on top for time you never logged.

After 20:00 the whole page shifts to dusk, because your window has closed.

**Appearance** sits in the masthead: ☀ light, ◐ follow the window, ☾ dark. *Follow the window* is the
default and keeps that behaviour — daylight while your hours are open, dusk once they close, on Jakarta
time rather than your machine's setting. Light and dark pin it regardless of the hour. The choice is
saved and applied before the first paint, so a dark theme never flashes light on load.

## Running it

```sh
cd TimeManage
python3 -m http.server 8080
# open http://localhost:8080
```

Serving it locally is the reliable route. Opening `index.html` by double-clicking generally works too — there is no build step, no npm, and no network requests — but `localStorage` behaviour on `file://` varies by browser, so the server is safer if you care about keeping your data.

Everything lives in your browser's `localStorage` under the key `tm.v1`. Nothing leaves the machine.

Every change writes immediately, and the record tab says so — *"Saved just now"* under the export
buttons. If a write ever fails (storage full, private mode, a browser blocking the origin) that line
turns red and names the reason, instead of the app carrying on as though it had saved.

**Import cannot silently destroy anything.** Picking a file only inspects it; it tells you how many
days and entries are about to be replaced and waits. If you go ahead, the previous contents are kept
and **Undo import** puts them back.

**That is still not a backup** — one cleared browser profile takes the lot. Use *Export JSON* now and
then and keep the file somewhere real.

### Testing without touching your data

Open the page with **`?sandbox`** and the entire store moves to a throwaway key (`tm.sandbox`), leaving
`tm.v1` untouched. Anyone poking at the app — including me — should use that, because seeding test
data into the live key is exactly how real entries get destroyed.

## The model

All of it is one pure function in `js/energy.js`. Every term is either a clock reading or a sum of logged minutes — there are no invented coefficients and nothing to tune.

```
startMin    = 06:00, or when you woke if that was later
endMin      = 20:00 normally, later on a night you cram (capped at 00:00)
WINDOW      = endMin − startMin          // 840 minutes on a normal day
elapsed     = minutes of the window already burned
clockLeft   = WINDOW − elapsed           // the future. Nothing else touches this.

napMin      = naps logged inside the window
usable      = WINDOW − napMin            // the day you actually had
elapsedAdj  = elapsed − napMin           // naps hand the clock back
untracked   = max(0, elapsedAdj − productive − wasted)

ceilingLost = wasted + untracked
ceiling     = usable − ceilingLost       // ≡ productive + clockLeft

committedAhead = booked blocks still ahead of now, merged so overlaps count once
freeLeft       = clockLeft − committedAhead

target         = the productive hours you are aiming at
targetReachable = ceiling ≥ target
```

Three things worth knowing:

**The past never reaches the future.** An hour you wasted is already inside `elapsed`, so `clockLeft` has already fallen by that hour. Deducting anything further would charge you twice for one hour. Earlier versions of this did exactly that, with a `wasted × 0.5` "drag" factor and a night-sleep cap that shrank the window. Both were invented penalties dressed up as measurements, and both are gone. The window is fourteen hours, every day.

**What waste actually costs is the ceiling.** `ceiling` is the most productive hours you can still *end* the day with. Work an hour and `productive` rises exactly as `clockLeft` falls, so it holds steady. Waste an hour — or leave one unlogged — and only `clockLeft` moves, so it drops by exactly that hour. One hour of waste, one hour off your best case, once. That is the whole consequence, and it is arithmetic rather than judgement.

It is computed from the loss side rather than as `productive + clockLeft`. The two are algebraically identical whenever the log is sane, but deriving it from what is gone keeps it honest at the edges: a day you have not touched yet reads as the full window rather than a deficit, and over-logging cannot promise more hours than the day physically holds.

**Sleep is never waste.** A nap comes out of `usable` *and* hands the clock back, so its net effect is exactly zero — it is neither kept nor lost.

**Waking later starts the window later.** Put the time you got up in **Woke at** and the day opens then instead of at 06:00. Sleep until 09:00 and those three hours leave `usable` altogether rather than piling up as unlogged time you have to answer for. It costs you nothing: the ceiling is `productive + clockLeft`, and sleeping in moves neither — it only shrinks the denominator. The stretch you slept through is shaded on the day strip. **Slept last night** beside it is a plain statistic; it changes no figure.

**Booked time is not lost time — it is just not free.** The **Plan** tab holds *routines* that repeat on chosen weekdays and *plans* for today only, each with a start and an end. Whatever is still ahead of now is subtracted from `clockLeft` to give **free**, the second figure under the left jar and the hatched band inside its water. Overlapping blocks are merged first, so a meeting booked inside a class counts once. This deliberately leaves the **ceiling alone** — a booked hour is still an hour you can be productive in, so booking your gym slot does not lower what you can finish the day on. It answers a different question: how much of what remains is actually yours to choose.

A block never writes an entry. Once one is behind you it simply stops counting as ahead, and offers a one-tap **log it** that files it for real with its own tag and length — so the record can never fill with work you did not do. Routines live at the root of the store and plans belong to their day, which is why editing a routine does not rewrite your history.

**The right jar grows toward a target, not toward the whole day.** Set **Daily target** in the ledger — 1, 2, 3, 4, 5, 6 or 8 hours. Growth is `productive / target`, so hitting six hours on a six-hour target fills the jar. It used to be `productive / usable`, measured against the full fourteen-hour window, which meant a superb six-hour day read as 43% and the jar could never look finished however well the day went.

The target also gives the ceiling something to be measured against. Since `ceiling` is the best you can still end on, the target is reachable exactly while `ceiling ≥ target` — so the page can tell you the moment a six-hour day stops being possible, rather than leaving you to work it out. The target changes nothing else: `ceiling`, `untracked`, `usable` and the rest are untouched by it. The record counts how many days in the period cleared it.

**Unlogged time costs the same as wasted time.** Both take an hour off the ceiling. The grey band in the right-hand jar is that debt, and it is the nudge to log more. A day with nothing logged at all is treated as a clean slate, not a deficit — you cannot fail to account for hours before you opened the page.

**A crammed night extends the day rather than falling outside it.** The window normally closes at 20:00, but the **Window ends** presets in the ledger push tonight out to 21:00, 22:00, 23:00 or midnight. Doing so genuinely hands you more hours: `clockLeft` grows, and so does the ceiling. The stretch past 20:00 is marked everywhere it appears — a tinted segment on the day strip, a dashed 20:00 line across the left jar, and blue columns on the leak clock — so a crammed day still reads as a crammed day when you look back at it.

The choice is stored **per day**. Cramming is the exception, so tomorrow opens back at 20:00, while past days keep whatever end they actually had and the record stays accurate. Midnight is the hard cap, because the ledger day rolls over at **06:00, not midnight** — a 01:00 session still belongs to the day that started the morning before, and letting a window cross 06:00 would break that.

## Logging

- Pick **Productive / Wasted / Nap**, then a chip (`+15m`, `+30m`, `+1h`) or type a duration — `45m`, `1h30`, `1.5h`, `90` all parse.
- Or run the live timer. It survives a reload and reconciles against wall-clock time when you come back.
  Leave it running overnight and it will **not** write one enormous block: the span is split across the
  ledger days it actually crossed and each piece clipped to that day's own window, because hours outside
  a window were never tracked hours. The toast says how much was logged, across how many days, and how
  much fell outside — and undo takes back every piece at once.
- Every add and delete offers a 6-second undo.
- **Slept last night** is recorded for the dashboard only. **Woke at** trims the front of the window — `6:40`, `0640`, `640` and `9` all parse.

Keyboard: `P` `W` `S` pick the tag · `1` `2` `3` fire the chips · `T` toggles the timer · `⌘Z` undoes.

## Planning

The **Plan** tab sits beside **Log time** in the same panel.

- **Routine** — repeats on the weekdays you pick. Seven day chips per routine, so a Tue/Thu class does not eat your Monday. Rows for other days are dimmed rather than hidden, so the whole timetable stays visible.
- **Today only** — one-off plans that belong to this day alone.
- Both take a start and an end (`08:00`, `0800`, `800` and `8` all parse) plus a tag, so a commute can be booked as wasted and a nap as sleep.
- A block that has finished shows **log it**; one running right now is badged **now**.

The summary line reads `4h 15m booked today · 2h 30m still ahead`, and booked blocks appear as bands on the day strip.

## The record

A separate tab, so the whole of Today fits one screen with no scrolling and the history is one click away rather than a scroll down. It only re-renders while it is actually on screen.

Four periods, each a rolling window ending today. The exact range is printed under the heading, so "Week" is never ambiguous.

| Period | Reaches back | One rail column is |
|---|---|---|
| Day | today | one hour of the window (06–19, more on a crammed night) |
| Week | 7 days | one day |
| Month | 30 days | one day |
| Year | 365 days | one calendar month |

A year drawn as 365 columns is unreadable, so it groups into months; a single day is more useful split across its hours than shown as one bar. Column heights are relative to the fullest column in view — the caption underneath says what that is.

**Where it went** ranks your labels for the period, kept and lost side by side, so "instagram, 6h 2m"
is a thing you can actually see. Sub-minute timer runs still count as one minute, so nothing you did
vanishes. Below that: **kept against lost** as a single split bar, and **where the day leaks**, an hour-by-hour heatmap of when your wasted time actually happens. It runs 06:00–20:00 normally and stretches further if any day in view was crammed, with the late columns tinted blue. Timestamps outside the widest window are clamped to the nearest end rather than dropped, so the hour columns always sum to the same total the ledger shows.

Two things are deliberately not period-scoped: the **streak** (consecutive days where you kept more than you lost, counting back from your last logged day) and **untracked**, which only counts days you were actually logging — days before you started using this would otherwise invent a deficit.

## Files

```
index.html          the shell, shared SVG defs, both plants
css/tokens.css      palette, type, dusk overrides, plant colour ramps
css/base.css        reset, page shell, background field, grain, toast
css/plant.css       the shelf, both vessels, water, roots, sludge, haze, day strip
css/panels.css      the ledger and the logbook
css/dashboard.css   the record
js/time.js          Asia/Jakarta clock, 06:00 rollover, duration parsing
js/store.js         localStorage, export/import
js/schedule.js      routines + plans → booked totals, pure, no DOM
js/energy.js        the model — pure, no DOM
js/plant.js         numbers → SVG geometry, one renderer per jar
js/log.js           chips, timer, entries, undo
js/plan.js          the Plan tab: routines, plans, day chips, log it
js/dashboard.js     period aggregation and charts
js/app.js           boot, the 15s tick, keyboard
```

Stored shape:

```json
{
  "v": 1,
  "routines": [
    { "id": "r1", "label": "class", "start": 480, "end": 600, "tag": "productive", "days": [1, 3, 5] }
  ],
  "days": {
    "2026-08-16": {
      "nightSleepMin": 420,
      "wakeMin": 480,
      "endMin": 1380,
      "plans": [
        { "id": "p1", "label": "dentist", "start": 840, "end": 900, "tag": "productive" }
      ],
      "entries": [
        { "id": "k3f9", "tag": "wasted", "min": 30, "label": "instagram", "at": "2026-08-16T02:12:00.000Z" }
      ]
    }
  },
  "activeTimer": null,
  "settings": { "windowStart": "06:00", "windowEnd": "20:00", "tz": "Asia/Jakarta", "targetMin": 360, "theme": "auto" }
}
```

Timestamps are stored in UTC and resolved to Asia/Jakarta with `Intl.DateTimeFormat` at read time, so the figures stay correct if you travel.
