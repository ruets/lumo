// SPDX-License-Identifier: AGPL-3.0-or-later

/** Adresses où le HTTP en clair reste acceptable : machine locale et réseau privé. */
export function isLocalHost(host: string): boolean {
	const h = host.toLowerCase().replace(/^\[|\]$/g, "");
	if (h === "localhost" || h === "::1" || h.endsWith(".local") || h.endsWith(".localhost")) return true;
	const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
	if (!m) return false;
	const a = Number(m[1]);
	const b = Number(m[2]);
	return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export type ServerUrlResult = { ok: true; url: string } | { ok: false; reason: "empty" | "invalid" | "insecure" };

/**
 * Normalise ce que tape l'utilisateur : `lumo.example.org` devient `https://lumo.example.org`.
 * HTTPS obligatoire, sauf pour une adresse locale. Les slashs finaux, la requête et l'ancre sont retirés.
 */
export function normalizeServerUrl(input: string): ServerUrlResult {
	const raw = input.trim();
	if (raw === "") return { ok: false, reason: "empty" };
	let candidate = raw;
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
		const host = candidate.split(/[/:?#]/)[0] ?? "";
		candidate = `${isLocalHost(host) ? "http" : "https"}://${candidate}`;
	}
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return { ok: false, reason: "invalid" };
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "invalid" };
	if (url.hostname === "") return { ok: false, reason: "invalid" };
	if (url.protocol === "http:" && !isLocalHost(url.hostname)) return { ok: false, reason: "insecure" };
	return { ok: true, url: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
}
