/** Local calendar date, always "YYYY-MM-DD". Never a timestamp. */
export type DateStr = string;

export type Priority = 'general' | 'emergency';
export type BlouseStatus = 'scheduled' | 'done' | 'cancelled';

/** 0 = Sunday ... 6 = Saturday */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Settings {
  /** W: blouses per week she aims for. Daily amount is derived from the week's working days. */
  weeklyTarget: number;
  /** R: blouses per week kept free for emergencies. G = W - R. */
  emergencyReserve: number;
  /** Weekdays she stitches on. */
  workingWeekdays: Weekday[];
  /** Holidays: no stitching on these dates (delivery is still allowed). */
  daysOff: DateStr[];
  /** Calendar days between stitch day and delivery for emergency work (min 1). */
  emergencyGap: number;
  /** Calendar days between stitch day and delivery for general work. */
  normalGap: number;
  /** Weekdays she is willing to hand work over. */
  deliveryWeekdays: Weekday[];
  /** If true, a new order may count on being stitched today when quoting. */
  allowNewWorkToday: boolean;
  /** First day of the week for weekly counting (default 1 = Monday). */
  weekStartsOn: Weekday;
}

// ---------- Stored data (what the app keeps in its local DB) ----------

/** One customer can come many times. */
export interface Customer {
  id: string;
  name: string;
  phone?: string;
  createdAt: number;
}

/** One visit of a customer. */
export interface Order {
  id: string;
  customerId: string;
  /** Any increasing number (e.g. ms epoch). Used for "oldest order first". */
  createdAt: number;
  note?: string;
}

/**
 * One delivery of an order. A normal order has one part; a split order
 * (some emergency, rest general) has two parts with their own dates.
 */
export interface OrderPart {
  id: string;
  orderId: string;
  priority: Priority;
  /** Stored at confirm time; changes only when she edits it manually. */
  promisedDelivery: DateStr;
  /** Set when the part is handed over to the customer. */
  deliveredOn?: DateStr;
  cancelled?: boolean;
}

export interface Blouse {
  id: string;
  partId: string;
  type?: string;
  price: number;
  status: BlouseStatus;
  /** Day it was actually stitched (set when status = done). */
  doneDate?: DateStr;
}

/** "Take extra anyway": +n blouses for the week starting at weekStart. */
export interface WeekExtra {
  weekStart: DateStr;
  n: number;
}

/** Catch-up: +n blouses on one specific day. */
export interface DayExtra {
  date: DateStr;
  n: number;
}

export interface EngineInput {
  today: DateStr;
  settings: Settings;
  orders: Order[];
  parts: OrderPart[];
  blouses: Blouse[];
  weekExtras?: WeekExtra[];
  dayExtras?: DayExtra[];
}

// ---------- Results ----------

export type ChangeReason = 'moved-earlier' | 'moved-later' | 'added' | 'now-late' | 'unscheduled';

export interface Change {
  blouseId: string;
  from: DateStr | null;
  to: DateStr | null;
  reason: ChangeReason;
}

export interface DayPlan {
  date: DateStr;
  blouseIds: string[];
}

export interface ScheduleResult {
  /** Today's list (empty on a non-working day), nearest deadline first. */
  today: DayPlan;
  /** All days with planned work, from today on, in order. */
  days: DayPlan[];
  /** Planned stitch date for every unfinished blouse (null = does not fit in the horizon). */
  stitchDate: Record<string, DateStr | null>;
  /** Latest allowed stitch day per unfinished blouse. */
  latestStitch: Record<string, DateStr | null>;
  /**
   * Whole work queue, in the order she should stitch (nearest deadline first).
   * Today's list is the top of this queue; if she has energy for more, she
   * continues down the queue.
   */
  queue: string[];
  /** Today's daily amount (before subtracting what is done today). 0 on a day off. */
  todayTarget: number;
  /** Blouses already marked done today. */
  doneTodayCount: number;
  /** "Using its spare day": stitched after its latest stitch day. Quiet notice. */
  late: string[];
  lateParts: string[];
  /** "Will miss delivery": cannot be stitched before the promised date. Call the customer. */
  willMiss: string[];
  willMissParts: string[];
  /** What moved compared to `previous`. */
  changes: Change[];
}

export interface QuotePartRequest {
  count: number;
  priority: Priority;
}

export interface WeekUsage {
  weekStart: DateStr;
  used: number;
  capacity: number;
}

export interface QuotePart {
  priority: Priority;
  count: number;
  /** null = "No free date in 6 months" */
  dateOffered: DateStr | null;
  latestStitch: DateStr | null;
  /** Planned stitch day for each of the new blouses. */
  stitchDays: DateStr[];
  weekUsage: WeekUsage[];
}

export type DateCheckFailure = 'not-a-delivery-day' | 'too-soon' | 'no-working-day' | 'full';

export interface DateCheck {
  ok: boolean;
  reason?: DateCheckFailure;
  fullWeek?: DateStr;
  fullDay?: DateStr;
  nearestValid?: DateStr | null;
  /** "Take extra anyway" proposal, if extra in one week makes the date work. */
  extraNeeded?: WeekExtra | null;
}
