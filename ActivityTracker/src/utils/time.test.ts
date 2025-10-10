import { formatTimeAgo } from './time';

describe('formatTimeAgo', () => {
  const now = new Date();

  it('should return seconds ago for times less than a minute', () => {
    const fiveSecondsAgo = new Date(now.getTime() - 5 * 1000);
    expect(formatTimeAgo(fiveSecondsAgo, now)).toBe('5 seconds ago');
  });

  it('should return minutes and seconds ago for times less than an hour', () => {
    const oneMinuteFiveSecondsAgo = new Date(now.getTime() - (60 * 1 + 5) * 1000);
    expect(formatTimeAgo(oneMinuteFiveSecondsAgo, now)).toBe('1 minute 5 seconds ago');
  });

  it('should return hours and minutes ago for times less than a day', () => {
    const fourHoursFiveMinutesAgo = new Date(now.getTime() - (60 * 60 * 4 + 60 * 5) * 1000);
    expect(formatTimeAgo(fourHoursFiveMinutesAgo, now)).toBe('4 hours 5 minutes ago');
  });

  it('should return days and hours ago for times less than a month', () => {
    const eightDaysFiveHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 8 + 60 * 60 * 5) * 1000);
    expect(formatTimeAgo(eightDaysFiveHoursAgo, now)).toBe('8 days 5 hours ago');
  });

  it('should return months and days ago for times less than a year', () => {
    const twoMonthsThreeDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 2 + 3 * 24 * 60 * 60) * 1000);
    expect(formatTimeAgo(twoMonthsThreeDaysAgo, now)).toBe('2 months 3 days ago');
  });

  it('should return years and months ago for times more than a year', () => {
    const oneYearTwoMonthsAgo = new Date(now.getTime() - (365 * 24 * 60 * 60 * 1 + 30 * 24 * 60 * 60 * 2) * 1000);
    expect(formatTimeAgo(oneYearTwoMonthsAgo, now)).toBe('1 year 2 months ago');
  });
});