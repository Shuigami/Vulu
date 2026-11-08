import { describe, expect, it } from 'vitest';
import { monthGrid, monthLabel, monthRange, shiftMonth } from './calendar';

describe('monthGrid', () => {
	it('starts on Monday and pads with the neighbouring months', () => {
		// 1 November 2026 is a Sunday
		const grid = monthGrid('2026-11');
		expect(grid).toHaveLength(42);
		expect(grid[0]).toMatchObject({ key: '2026-10-26', inMonth: false });
		expect(grid[6]).toMatchObject({ key: '2026-11-01', day: 1, inMonth: true });
		expect(grid[35]).toMatchObject({ key: '2026-11-30', inMonth: true });
		expect(grid[36]).toMatchObject({ key: '2026-12-01', inMonth: false });
		expect(grid[6].label).toBe('dimanche 1 novembre');
	});

	it('uses four weeks when the month fits', () => {
		// February 2027 starts on a Monday and has 28 days
		const grid = monthGrid('2027-02');
		expect(grid).toHaveLength(28);
		expect(grid.every((c) => c.inMonth)).toBe(true);
	});
});

describe('months', () => {
	it('shifts across years', () => {
		expect(shiftMonth('2026-12', 1)).toBe('2027-01');
		expect(shiftMonth('2026-01', -1)).toBe('2025-12');
	});

	it('bounds the month at Paris midnights', () => {
		const { from, to } = monthRange('2026-11');
		expect(from.toISOString()).toBe('2026-10-31T23:00:00.000Z');
		expect(to.toISOString()).toBe('2026-11-30T23:00:00.000Z');
	});

	it('labels the month in French', () => {
		expect(monthLabel('2026-11')).toBe('novembre 2026');
	});
});
