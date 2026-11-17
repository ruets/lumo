// SPDX-License-Identifier: AGPL-3.0-or-later

/** Design tokens partagés web et mobile. Valeurs provisoires, à affiner à l'étape 3. */
export const colors = {
	background: "#fafaf7",
	surface: "#ffffff",
	text: "#1f2430",
	muted: "#6b7280",
	primary: "#f59e0b",
	primaryText: "#1f2430",
	danger: "#dc2626",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radii = { sm: 6, md: 12, lg: 20 } as const;

export const fontSizes = { sm: 14, md: 16, lg: 20, xl: 28 } as const;
