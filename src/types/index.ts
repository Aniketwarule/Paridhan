// ============================================================
// Poshakh – shared TypeScript types
// The scheduling maths lives in "Scheduling engine/" (see src/engine).
// These types describe what the app stores in SQLite.
// ============================================================
import type { BlouseStatus, Priority, Settings } from '../engine';

export type { BlouseStatus, Priority } from '../engine';

export type BlouseType = 'astar' | 'designer';
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
}

export interface OrderWithDetails {
  order: Order;
  customer: Customer;
  parts: PartWithBlouses[];
}
