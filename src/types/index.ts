// ============================================================
// Poshakh – shared TypeScript types
// The scheduling maths lives in "Scheduling engine/" (see src/engine).
// These types describe what the app stores in SQLite.
// ============================================================
import type { BlouseStatus, Priority, Settings } from '../engine';

export type { BlouseStatus, Priority } from '../engine';

/**
 * Stitching work: what the schedule plans. The table and type are still called "blouse",
 * but a row can also be a dress or a nav-vari saree. 'navvari' takes a whole working day;
 * the others take one slot.
 */
export type BlouseType = 'astar' | 'sadha' | 'designer' | 'dress' | 'navvari';
/** Small work: only added to the order and the bill, it never uses schedule time. */
export type SmallWorkKind = 'blouse_alter' | 'dress_alter' | 'parkar_alter' | 'parkar_stitch' | 'piko_fall' | 'piko' | 'other';
/** Anything she can add to an order. */
export type WorkKey = BlouseType | SmallWorkKind;
/** Derived from the order's parts and blouses; never edited by hand. */
export type OrderStatus = 'pending' | 'ready' | 'delivered' | 'cancelled';

// ----------------------------------------------------------------
// Stored rows (mirror the SQLite schema)
// ----------------------------------------------------------------

export interface Customer {
  id: number;
  name: string;
  phone?: string;
}

/** One visit of a customer. */
export interface Order {
  id: number;
  customerId: number;
  createdAt: string; // ISO date-time
  status: OrderStatus;
  notes?: string;
  /** Money received in advance for this order (₹). */
  advance: number;
  /** Customer's old unpaid amount added to this order (₹). */
  previousDue: number;
}

/** One delivery of an order (a split order has an emergency and a general part). */
export interface OrderPart {
  id: number;
  orderId: number;
  priority: Priority;
  promisedDelivery: string; // YYYY-MM-DD
  deliveredOn?: string;     // YYYY-MM-DD
  cancelled: boolean;
}

export interface Blouse {
  id: number;
  partId: number;
  orderId: number;
  type: BlouseType;
  /** Her own label, e.g. "Wedding blouse". */
  name?: string;
  price: number;
  status: BlouseStatus;
  doneDate?: string; // YYYY-MM-DD, the day it was actually stitched
  paid: boolean;
}

/** Bill-only work on a delivery. Identical pieces share one row with a quantity. */
export interface SmallWork {
  id: number;
  partId: number;
  orderId: number;
  kind: SmallWorkKind;
  /** Her own label; for 'other' this is the name of the work. */
  name?: string;
  qty: number;
  /** Price of one (₹). */
  price: number;
  paid: boolean;
}

export interface CustomerSummary extends Customer {
  lastOrderAt?: string;
  orderCount: number;
}

export interface DayOff {
  id: number;
  date: string; // YYYY-MM-DD
  label?: string;
}

/** Engine settings (minus holidays, which live in their own table) plus prices. */
export interface AppSettings extends Omit<Settings, 'daysOff'> {
  priceAstar: number;
  priceDesigner: number;
  /** Usual price of every other kind of work; missing means she has not set one yet. */
  rates: Partial<Record<WorkKey, number>>;
}

// ----------------------------------------------------------------
// UI helper types
// ----------------------------------------------------------------

/** A blouse joined with its part, order and customer, for lists. */
export interface BlouseView extends Blouse {
  customerName: string;
  customerPhone?: string;
  priority: Priority;
  promisedDelivery: string;
  partDeliveredOn?: string;
}

export interface PartWithBlouses extends OrderPart {
  blouses: Blouse[];
  smallWork: SmallWork[];
}

export interface OrderWithDetails {
  order: Order;
  customer: Customer;
  parts: PartWithBlouses[];
}
