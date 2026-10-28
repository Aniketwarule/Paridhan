// ============================================================
// Poshakh – all user-facing strings
// Replace values here to translate to Marathi (or any language)
// ============================================================

export const STRINGS = {
  // ── App general ──────────────────────────────────────────────
  appName: 'Poshakh',
  confirm: 'Confirm',
  cancel: 'Cancel',
  save: 'Save',
  delete: 'Delete',
  edit: 'Edit',
  done: 'Done',
  undo: 'Undo',
  back: 'Back',
  yes: 'Yes',
  no: 'No',
  ok: 'OK',
  close: 'Close',
  loading: 'Loading…',
  noData: 'Nothing here yet.',
  search: 'Search',
  takeExtraAnyway: 'Take extra anyway',
  nearestValidDate: 'Use nearest valid date',

  // ── Bottom tabs ───────────────────────────────────────────────
  tabToday: 'Today',
  tabNewOrder: 'New Order',
  tabOrders: 'Orders',
  tabReports: 'Reports',
  tabSettings: 'Settings',

  // ── Today screen ─────────────────────────────────────────────
  todayTitle: "Today's Work",
  todayDone: (done: number, total: number) => `${done} of ${total} done`,
  todayOverdue: 'Overdue / Carried Over',
  todayStitchToday: 'Stitch Today',
  todayReadyToDeliver: 'Ready to Deliver',
  todayNothingToday: 'Nothing scheduled for today.',
  todayMightBeLate: 'Might be late',
  todayMarkDone: 'Done',
  todayMarkDelivered: 'Delivered',
  todayPaymentReceived: 'Payment received',
  todayEmergencyTag: 'Emergency',

  // ── New Order screen ──────────────────────────────────────────
  newOrderTitle: 'New Order',
  newOrderCustomerName: 'Customer name',
  newOrderCustomerNamePlaceholder: 'E.g. Sunita Patil',
  newOrderCustomerNameRequired: 'Customer name is required.',
  newOrderPhone: 'Contact number (optional)',
  newOrderAstar: 'Astar blouses',
  newOrderDesigner: 'Designer blouses',
  newOrderEmergencyCount: 'How many are emergency?',
  newOrderPriceEach: (index: number, type: string) => `${type} #${index + 1} price (₹)`,
  newOrderTotal: (amount: number) => `Total: ₹${amount}`,
  newOrderGeneralDate: 'General delivery',
  newOrderEmergencyDate: 'Emergency delivery',
  newOrderCustomDateLabel: 'Or enter a custom date',
  newOrderCapacityStrip: 'Capacity (this week + next 4)',
  newOrderCapacityWeek: (used: number, target: number) => `${used} / ${target}`,
  newOrderConfirm: 'Confirm Order',
  newOrderSaved: 'Order saved!',
  newOrderOverLimit: (used: number, target: number) =>
    `This makes the week ${used} of ${target}`,
  newOrderSplit: 'Split order',
  newOrderSplitHint: 'Emergency blouses are delivered earlier.',

  // ── Orders screen ─────────────────────────────────────────────
  ordersTitle: 'Orders',
  ordersPending: 'Pending',
  ordersReady: 'Ready',
  ordersDelivered: 'Delivered',
  ordersSearchPlaceholder: 'Search by name…',
  ordersNoResults: 'No orders found.',
  ordersTotal: (amount: number) => `Total: ₹${amount}`,
  ordersEditPrices: 'Edit prices',
  ordersMoveDate: 'Move delivery date',
  ordersCancel: 'Cancel order',
  ordersCancelConfirm: 'Cancel this order? This cannot be undone.',
  ordersDetailTitle: 'Order Details',
  ordersBlouseType: { astar: 'Astar', designer: 'Designer' },
  ordersBlousePriority: { general: 'General', emergency: 'Emergency' },
  ordersBlouseStatus: {
    scheduled: 'Scheduled',
    done: 'Done',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  },
  ordersScheduledFor: (date: string) => `Stitching: ${date}`,
  ordersDeliverBy: (date: string) => `Deliver by: ${date}`,

  // ── Reports screen ────────────────────────────────────────────
  reportsTitle: 'Reports',
  reportsWeekly: 'Weekly',
  reportsMonthly: 'Monthly',
  reportsTotalIncome: 'Total income',
  reportsBlousesDelivered: 'Blouses delivered',
  reportsAstar: 'Astar',
  reportsDesigner: 'Designer',
  reportsEmergency: 'Emergency',
  reportsGeneral: 'General',
  reportsPending: 'Pending',
  reportsCapacityUsed: 'Capacity used',
  reportsNoData: 'No data for this period.',

  // ── Settings screen ───────────────────────────────────────────
  settingsTitle: 'Settings',
  settingsWorkingDays: 'Working days',
  settingsWeeklyTarget: 'Weekly blouse target',
  settingsEmergencyReserve: 'Emergency reserve per week',
  settingsDailyMax: 'Daily max blouses',
  settingsSpareDays: 'Spare days before delivery (general)',
  settingsPriceAstar: 'Default price: Astar blouse (₹)',
  settingsPriceDesigner: 'Default price: Designer blouse (₹)',
  settingsDaysOff: 'Days off / Holidays',
  settingsAddDayOff: 'Add day off',
  settingsRemoveDayOff: 'Remove',
  settingsBackup: 'Backup & Restore',
  settingsExportDB: 'Export database',
  settingsImportDB: 'Import database',
  settingsImportWarning:
    'Importing will replace ALL current data. Make sure you have a backup.',
  settingsSaved: 'Settings saved.',
  settingsDemoMode: 'Load demo / seed data',
  settingsDemoConfirm:
    'This will add sample customers and orders. Continue?',

  // ── Day names (0 = Sunday) ────────────────────────────────────
  dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  dayNamesShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

  // ── Validation ────────────────────────────────────────────────
  validationPositiveNumber: 'Please enter a positive number.',
  validationDateInPast: 'Date is in the past.',
  validationDateFmt: 'Enter date as YYYY-MM-DD.',
  validationNoBlouses: 'Add at least one blouse.',
  validationEmergencyExceedsTotal:
    'Emergency count cannot exceed total blouses.',
};
