/** Whether `year` is a leap year in the Gregorian calendar. */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0;
}
