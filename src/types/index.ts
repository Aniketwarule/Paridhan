// ============================================================
// Poshakh – shared TypeScript types
// ============================================================

export type BlouseType = 'astar' | 'designer';
export type BlousePriority = 'general' | 'emergency';
export type BlouseStatus = 'scheduled' | 'done' | 'delivered' | 'cancelled';
export type OrderStatus = 'pending' | 'ready' | 'delivered' | 'cancelled';

// ----------------------------------------------------------------
// Domain entities (mirror the SQLite schema)
// ----------------------------------------------------------------

export interface Customer {
  id: number;
  name: string;
  phone?: string;
}

export interface Order {
  id: number;
  customerId: number;
  createdAt: string; // ISO date-time
  status: OrderStatus;
  notes?: string;
}

export interface BlouseItem {
  id: number;
  orderId: number;
  type: BlouseType;
  price: number;
  priority: BlousePriority;
  scheduledDate: string;          // YYYY-MM-DD
  promisedDeliveryDate: string;   // YYYY-MM-DD
  status: BlouseStatus;
  doneAt?: string;
  deliveredAt?: string;
  paid: boolean;
}

export interface DayOff {
  id: number;
  date: string; // YYYY-MM-DD
  label?: string;
}

export interface AppSettings {
  workingDays: number[];           // 0=Sun … 6=Sat
  weeklyTarget: number;            // default 10
  emergencyReserve: number;        // default 3
  dailyMax: number;                // default ceil(target / workingDays.length)
  spareDaysBeforeDelivery: number; // default 1
  priceAstar: number;              // default 300
  priceDesigner: number;           // default 400
}

// ----------------------------------------------------------------
// Scheduling-engine value types (no DB ids)
// ----------------------------------------------------------------

export interface DayLoad {
  date: string;       // YYYY-MM-DD
  generalUsed: number;
  emergencyUsed: number;
  generalCap: number;
  emergencyCap: number;
}

export interface WeekCapacity {
  weekStart: string;  // Monday YYYY-MM-DD
  used: number;
  target: number;     // weeklyTarget
  generalUsed: number;
  emergencyUsed: number;
}

export interface ScheduleResult {
  /** Each element = one blouse, in stitching order */
  assignments: BlouseAssignment[];
  /** The overall delivery date (last stitch day + spare days) */
  deliveryDate: string;
  /** Whether any week/day limit was exceeded */
  overLimit: boolean;
  overLimitDetail?: string;
}

export interface BlouseAssignment {
  type: BlouseType;
  priority: BlousePriority;
  scheduledDate: string;
  promisedDeliveryDate: string;
}

export interface NewOrderInput {
  astarCount: number;
  designerCount: number;
  emergencyCount: number; // total blouses that are emergency (designer or astar)
  customDate?: string;    // YYYY-MM-DD override
}

// ----------------------------------------------------------------
// UI helper types
// ----------------------------------------------------------------

export interface TodayBlouseGroup {
  customerName: string;
  orderId: number;
  items: BlouseItem[];
}

export interface OrderWithCustomer extends Order {
  customerName: string;
  customerPhone?: string;
  items: BlouseItem[];
}
