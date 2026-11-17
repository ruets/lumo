// SPDX-License-Identifier: AGPL-3.0-or-later
import type { TodayResponse } from "@lumo/api-client";
import { describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({ api: {} }));
vi.mock("./queue", () => ({ useQueue: () => [] }));
vi.mock("./store", () => ({ showToast: () => undefined }));

const { overlayQueue } = await import("./hooks.js");

const entry = (over: object = {}) =>
	({
		item: { id: "a", requiresApproval: false, reward: 2, creditsTo: "personal" },
		approved: 0,
		pending: 0,
		target: 2,
		done: false,
		completionIds: [],
		...over,
	}) as never;
const today = (e: object): TodayResponse => ({ date: "2026-11-17", items: [e as never] });
const op = (itemId: string, date = "2026-11-17") => ({ id: crypto.randomUUID(), itemId, date, createdAt: "" });

describe("overlayQueue", () => {
	it("adds the queued completions to the day's progress", () => {
		const r = overlayQueue(today(entry()), [op("a")]);
		expect(r.items[0]).toMatchObject({ approved: 1, done: false });
		expect(overlayQueue(today(entry()), [op("a"), op("a")]).items[0]).toMatchObject({ approved: 2, done: true });
	});

	it("never exceeds the goal (the server would refuse the excess)", () => {
		expect(overlayQueue(today(entry({ approved: 1 })), [op("a"), op("a"), op("a")]).items[0]).toMatchObject({
			approved: 2,
			done: true,
		});
	});

	it("ignores another day or another item", () => {
		expect(overlayQueue(today(entry()), [op("a", "2026-11-16"), op("b")]).items[0]).toMatchObject({ approved: 0 });
	});

	it("an item needing adult approval goes pending, not completed", () => {
		const e = entry({ item: { id: "a", requiresApproval: true, reward: 2, creditsTo: "personal" } });
		expect(overlayQueue(today(e), [op("a")]).items[0]).toMatchObject({ approved: 0, pending: 1, done: false });
	});
});
