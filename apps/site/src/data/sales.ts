/**
 * The second bundled, fully fictional sample: `sales-q3.csv`, one quarter (Jul–Sep 2024) of sales by region.
 *
 * 48 rows, 6 columns (orderId, orderDate, customer, region, status, amount). The rows are a committed literal, not
 * generated at load time: they were produced once by a small solver (seeded mulberry32, integer cents) so that the
 * front door's published figures hold exactly, and sales.test.ts pins every one of them:
 *
 *   - statuses over all rows: paid 32, refunded 10, pending 6;
 *   - total amount by region (every row): west 6,978.10 · north 6,462.07 · south 3,593.90 · east 2,732.19;
 *   - top 5 customers by total amount (every row): Puddlesworth Inc 4,163.37 · Brambleskate Ltd 4,000.23 ·
 *     Nimbus Pickle Works 3,537.37 · Kettlewhistle Farms 3,440.73 · Thistlewhump Bakery 2,381.37;
 *   - the three rows src/data/sample.ts shows the model (first, middle, last) are orders 5001, 5025 and 5048.
 *
 * Customer names are the invented ones from orders.ts.
 */

export interface Sale {
  orderId: number;
  orderDate: string;
  customer: string;
  region: 'west' | 'north' | 'south' | 'east';
  status: 'paid' | 'refunded' | 'pending';
  amount: number;
}

export const SALES_FILENAME = 'sales-q3.csv';
export const SALES_ROW_COUNT = 48;

/** [orderId, orderDate, customer, region, status, amount in cents] */
const ROWS: ReadonlyArray<readonly [number, string, string, Sale['region'], Sale['status'], number]> = [
  [5001, '2024-07-17', 'Puddlesworth Inc', 'west', 'refunded', 27934],
  [5002, '2024-07-15', 'Thistlewhump Bakery', 'north', 'pending', 79290],
  [5003, '2024-07-06', 'Thistlewhump Bakery', 'north', 'paid', 18402],
  [5004, '2024-09-23', 'Brambleskate Ltd', 'north', 'paid', 82721],
  [5005, '2024-08-07', 'Kettlewhistle Farms', 'east', 'refunded', 56241],
  [5006, '2024-09-19', 'Thistlewhump Bakery', 'north', 'refunded', 33886],
  [5007, '2024-09-09', 'Zorblat Industries', 'south', 'paid', 15672],
  [5008, '2024-09-11', 'Quillfeather & Sons', 'south', 'paid', 13333],
  [5009, '2024-07-29', 'Brambleskate Ltd', 'north', 'paid', 97350],
  [5010, '2024-07-19', 'Puddlesworth Inc', 'west', 'paid', 49618],
  [5011, '2024-08-13', 'Glimmerbank Co-op', 'west', 'paid', 13926],
  [5012, '2024-09-03', 'Quillfeather & Sons', 'north', 'paid', 22972],
  [5013, '2024-09-08', 'Nimbus Pickle Works', 'south', 'paid', 45612],
  [5014, '2024-09-12', 'Thistlewhump Bakery', 'north', 'refunded', 51974],
  [5015, '2024-08-28', 'Brambleskate Ltd', 'north', 'paid', 57360],
  [5016, '2024-08-28', 'Nimbus Pickle Works', 'west', 'paid', 75329],
  [5017, '2024-08-08', 'Kettlewhistle Farms', 'east', 'refunded', 48328],
  [5018, '2024-08-20', 'Puddlesworth Inc', 'west', 'paid', 93725],
  [5019, '2024-07-09', 'Brambleskate Ltd', 'east', 'refunded', 56272],
  [5020, '2024-09-25', 'Glimmerbank Co-op', 'south', 'refunded', 13784],
  [5021, '2024-08-11', 'Wibbleton Hardware', 'east', 'pending', 13009],
  [5022, '2024-07-22', 'Glimmerbank Co-op', 'east', 'paid', 8022],
  [5023, '2024-09-20', 'Thistlewhump Bakery', 'north', 'paid', 54585],
  [5024, '2024-08-22', 'Nimbus Pickle Works', 'west', 'pending', 42214],
  [5025, '2024-08-27', 'Puddlesworth Inc', 'west', 'paid', 71088],
  [5026, '2024-08-06', 'Brambleskate Ltd', 'north', 'paid', 64384],
  [5027, '2024-07-19', 'Glimmerbank Co-op', 'east', 'paid', 10108],
  [5028, '2024-07-15', 'Nimbus Pickle Works', 'south', 'paid', 45601],
  [5029, '2024-08-10', 'Wibbleton Hardware', 'west', 'refunded', 17105],
  [5030, '2024-08-15', 'Kettlewhistle Farms', 'south', 'paid', 30943],
  [5031, '2024-07-20', 'Kettlewhistle Farms', 'south', 'paid', 42204],
  [5032, '2024-07-23', 'Brambleskate Ltd', 'north', 'paid', 41936],
  [5033, '2024-09-11', 'Mx. Pemberwick', 'north', 'paid', 14352],
  [5034, '2024-08-11', 'Nimbus Pickle Works', 'west', 'paid', 31332],
  [5035, '2024-08-16', 'Mx. Pemberwick', 'east', 'refunded', 13861],
  [5036, '2024-08-13', 'Kettlewhistle Farms', 'south', 'pending', 70181],
  [5037, '2024-08-04', 'Mx. Pemberwick', 'west', 'pending', 10937],
  [5038, '2024-07-13', 'Puddlesworth Inc', 'west', 'paid', 47777],
  [5039, '2024-09-18', 'Nimbus Pickle Works', 'south', 'paid', 41051],
  [5040, '2024-09-13', 'Kettlewhistle Farms', 'south', 'paid', 28798],
  [5041, '2024-08-31', 'Glimmerbank Co-op', 'north', 'paid', 11960],
  [5042, '2024-09-30', 'Wibbleton Hardware', 'south', 'paid', 12211],
  [5043, '2024-09-22', 'Nimbus Pickle Works', 'west', 'pending', 72598],
  [5044, '2024-09-28', 'Kettlewhistle Farms', 'east', 'paid', 67378],
  [5045, '2024-08-29', 'Puddlesworth Inc', 'west', 'refunded', 67841],
  [5046, '2024-09-12', 'Mx. Pemberwick', 'west', 'paid', 18032],
  [5047, '2024-07-30', 'Glimmerbank Co-op', 'north', 'paid', 15035],
  [5048, '2024-09-08', 'Puddlesworth Inc', 'west', 'paid', 58354],
];

export const SALES_COLUMNS: ReadonlyArray<keyof Sale> = ['orderId', 'orderDate', 'customer', 'region', 'status', 'amount'];

/** 48 rows. A fresh copy on every call. */
export function bundledSales(): Array<Record<string, unknown>> {
  return ROWS.map(([orderId, orderDate, customer, region, status, cents]) => ({
    orderId,
    orderDate,
    customer,
    region,
    status,
    amount: cents / 100,
  }));
}

/** The same rows as CSV (header + one line per row, LF). Amounts are written with two decimals (`792.90`). */
export function SALES_CSV(): string {
  const lines = [SALES_COLUMNS.join(',')];
  for (const [orderId, orderDate, customer, region, status, cents] of ROWS) {
    lines.push([String(orderId), orderDate, csvCell(customer), region, status, (cents / 100).toFixed(2)].join(','));
  }
  return lines.join('\n') + '\n';
}

function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
