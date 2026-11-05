# Silai scheduling engine

A pure TypeScript engine for Shakuntala Tai's blouse-stitching app. It has no UI, no
database and no `Date.now()`. The app passes in `today`, the settings and the stored
data, and gets back plain data. Dates are always `"YYYY-MM-DD"` strings.

```bash
npm test          # vitest, 54 tests (incl. 12-week day-by-day simulations)
npm run typecheck
```

## Stored data (app's local DB)

```
Customer ──< Order ──< OrderPart ──< Blouse
                       (one delivery date)  (price, type, status, doneDate)
```

- A customer can come many times; each visit is an **Order**.
- An order normally has one **OrderPart** (one delivery date). A split order
  (some emergency, the rest general) has two parts with their own dates.
- Price is stored per **Blouse**. Delivery (`deliveredOn`) is per part.
- Stitch dates are **never stored**: the engine works them out every time.

## How capacity works

- **W per week** (default 10). The daily amount is W spread evenly over that week's
  actual working days. Mon–Fri gives 2,2,2,2,2. A holiday on Wednesday gives 3,2,3,2.
- **General orders** may only use **G = W − R** per week, spread evenly and rounded
  down (7 → 1,1,2,1,2). Every day therefore keeps some room for emergencies, and
  general delivery dates come with a built-in margin.
- **Emergency orders** may use the full W.
- **Take extra anyway** (+n for one week) adds +1 per day from the start of the week
  (from today in the current week): 10 + 3 → 3,3,3,2,2.
- **Day extra** (+n on one date) is used for catching up after a missed day.
- Quotes look at every existing delivery date. A new date is offered only if
  everything, old and new, can still be stitched in time (earliest-deadline-first).
- **Today's list**: unfinished blouses with the nearest deadline first, filled as
  early as possible. Far-deadline work is done early. When an emergency arrives, that
  work simply moves to a later day before its own deadline.

## API

Every call takes an `EngineInput`:

```ts
{ today, settings, orders, parts, blouses, weekExtras?, dayExtras? }
```

| Function | Use in the app |
|---|---|
| `rebuildSchedule(input, previousStitchDates?)` | Today screen and calendar. Returns `queue`, `today`, `todayTarget`, `doneTodayCount`, `days`, `stitchDate`, `late`/`lateParts`, `willMiss`/`willMissParts`, `changes`. Call it after every change. |
| `quoteBoth(input, n)` | New order: general and emergency dates side by side. |
| `quote(input, parts)` | Split order, e.g. `[{count:2, priority:'emergency'}, {count:3, priority:'general'}]`. |
| `maxByDate(input, date, priority, prior?)` | "How many can be ready by Friday?" |
| `checkDate(input, part, date, prior?)` | Customer's own date. Returns `ok`, or the reason, `nearestValid`, `fullWeek`, and `extraNeeded` for "Take extra anyway". |
| `checkPartDateChange(input, partId, newDate, newPriority?)` | Customer wants an existing delivery moved. Same answer shape as `checkDate`. |
| `catchUpExtra(input)` | After a missed day: suggested `dayExtras` ("+1 Thu, +1 Fri") that clear the late flags. |
| `confirmOrder(order, parts)` | Builds the Order / OrderPart / Blouse records to save. |
| `report(parts, blouses, from, to)` | Weekly or monthly: stitched, delivered, due (counts and amounts). |

**Confirm flow:** quote → customer agrees → `confirmOrder` → save (plus the
`WeekExtra` if she chose "Take extra anyway") → `rebuildSchedule`.

## Rules the app must follow

1. **Today screen = a queue.** Show the top `todayTarget - doneTodayCount` items of
   `queue` (normally 2). When she ticks one, the next one moves up. Below that, a
   "Want to do more?" section shows the following items of `queue`. Extra work
   done today counts toward the week, so later days get lighter.
2. **Tick with the right date.** `doneDate` must be the day she actually stitched.
   On the first open of each day, if the previous working day's list (save
   `today.blouseIds` each evening) still has unticked blouses, ask: *"Did you
   finish these yesterday?"* Tick the ones she confirms with yesterday's date.
   Without this, today's list goes empty and new customers get dates that are too late.
3. **Undo / fix mistakes.** Undo done = set `status: 'scheduled'` and remove
   `doneDate`. Editing an order (blouse count, price, date) is plain data editing.
   Use `checkPartDateChange` before saving a new date, then rebuild.
4. **Two kinds of warnings.** `late` = the blouse is using its spare day (small grey
   note). `willMiss` = it cannot be ready on the promised date: show it on top and
   suggest calling the customer.
5. **Catch up.** When `late` is not empty, call `catchUpExtra`. If it returns
   something, show *"Do 1 extra on Thu and Fri to catch up?"*. On yes, save its
   `dayExtras`.
6. **Delivery closes a part.** Set `deliveredOn` when she hands it over. Its
   blouses then leave the schedule even if a tick was forgotten.
7. **Settings preview.** Before saving new settings (lower W, new holiday), run
   `rebuildSchedule` with them and show how many blouses would become `willMiss`.

## Settings (defaults)

| Setting | Default |
|---|---|
| `weeklyTarget` (W) | 10 |
| `emergencyReserve` (R) | 3 |
| `workingWeekdays` | Mon–Fri |
| `daysOff` | none |
| `emergencyGap` / `normalGap` | 1 / 2 days |
| `deliveryWeekdays` | all 7 |
| `allowNewWorkToday` | true (quotes may count on today) |
| `weekStartsOn` | Monday |

## Known limits

- Every blouse counts as the same amount of work. A heavy/bridal blouse that takes
  2–3× longer will get a date that is too early. Possible later fix: an effort
  weight per blouse type.
- A quote is valid for the moment it is given. Only one person uses the phone, so
  this is fine.

## Notes

- The latest stitch day is the latest working day whose delivery date (gap, moved to
  the next delivery weekday) is on or before the promised date.
- Order of work: earliest latest-stitch day first. An emergency and a general
  blouse due the same day differ by one gap day, so the general one comes first.
- Late blouses keep their real catch-up day when quoting, so new orders never push
  already-late work further.
