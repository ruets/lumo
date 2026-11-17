// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { t } from "./index.js";

describe("t", () => {
	it("interpole les paramètres", () => {
		expect(t("home.greeting", { name: "Léa" })).toBe("Bonjour, Léa");
	});
	it("laisse un paramètre manquant tel quel", () => {
		expect(t("home.greeting")).toBe("Bonjour, {name}");
	});
});
