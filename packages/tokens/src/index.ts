// SPDX-License-Identifier: AGPL-3.0-or-later

/** Design tokens partagés web et mobile, tirés de la maquette (thème sombre). */
export const colors = {
	background: "#0E1220",
	surface: "#1B2032",
	surfaceDone: "#151A29",
	surfaceRaised: "#252B40",
	nav: "#141929",
	border: "#252B40",
	borderDashed: "#3A4160",
	text: "#F2F1FA",
	textSoft: "#C9C8DC",
	muted: "#A9A8C0",
	mutedNav: "#9A99B3",
	primary: "#6B4BF2",
	primarySoft: "#7C5CFF",
	primaryLink: "#B9A8FF",
	onPrimary: "#FFFFFF",
	coin: "#FFC857",
	success: "#3DDC97",
	danger: "#FF7A8A",
	onCoin: "#0E1220",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radii = { sm: 10, md: 18, lg: 26, pill: 999 } as const;

export const fontSizes = { xs: 12, sm: 13, md: 15, lg: 19, xl: 26, xxl: 34 } as const;

export const fonts = {
	display: "Unbounded",
	body: "Manrope",
} as const;
