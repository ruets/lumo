// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { addDays } from "./dates.js";
import { type HeatmapDay, summarizeProgress } from "./progress.js";

// Mardi 17 novembre 2026.
const today = "2026-11-17";
const days = (from: string, n: number, done: number, expected: number): HeatmapDay[] =>
	Array.from({ length: n }, (_, i) => ({ date: addDays(from, i), done, expected }));

describe("summarizeProgress", () => {
	it("week: empty future days, rate up to today, trend vs previous week", () => {
		const heatmap = [...days("2026-11-09", 7, 4, 8), ...days("2026-11-16", 2, 6, 8)];
		const s = summarizeProgress(heatmap, today, "week");
		expect(s.from).toBe("2026-11-16");
		expect(s.bars).toHaveLength(7);
		expect(s.bars.map((b) => b.future)).toEqual([false, false, true, true, true, true, true]);
		expect(s.bars[1]?.current).toBe(true);
		expect(s.done).toBe(12);
		expect(s.expected).toBe(16);
		expect(s.rate).toBe(75);
		expect(s.previousRate).toBe(50);
		expect(s.trend).toBe(25);
	});

	it("month: 4 rolling weeks", () => {
		const heatmap = days(addDays(today, -55), 56, 3, 4);
		const s = summarizeProgress(heatmap, today, "month");
		expect(s.bars).toHaveLength(4);
		expect(s.bars[3]?.current).toBe(true);
		expect(s.bars[3]?.to).toBe(today);
		expect(s.expected).toBe(28 * 4);
		expect(s.rate).toBe(75);
		expect(s.trend).toBe(0);
	});

	it("nothing expected: no rate and no trend", () => {
		const s = summarizeProgress([], today, "week");
		expect(s.rate).toBeNull();
		expect(s.trend).toBeNull();
	});
});
