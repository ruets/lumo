// SPDX-License-Identifier: AGPL-3.0-or-later
import { colors, radii, spacing } from "@lumo/tokens";
import type { ReactNode } from "react";
import {
	type DimensionValue,
	Modal,
	Pressable,
	type PressableProps,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	type TextInputProps,
	type TextProps,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect, Text as SvgText } from "react-native-svg";
import { useToast } from "./store";

export const font = {
	body: "Manrope_400Regular",
	semi: "Manrope_600SemiBold",
	bold: "Manrope_700Bold",
	display: "Unbounded_500Medium",
	displayBold: "Unbounded_700Bold",
} as const;

export function T({ style, ...p }: TextProps) {
	return <Text {...p} style={[{ fontFamily: font.body, color: colors.text }, style]} />;
}

export function CoinIcon({ size = 18, color = colors.coin }: { size?: number; color?: string }) {
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2}>
			<Circle cx={12} cy={12} r={9} />
			<Circle cx={12} cy={12} r={4.5} />
		</Svg>
	);
}

export function Reward({ amount }: { amount: number }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
			<CoinIcon size={14} />
			<T style={{ color: colors.coin, fontFamily: font.bold, fontSize: 14 }}>+{amount}</T>
		</View>
	);
}

export function BalanceChip({ balance, onPress }: { balance: number; onPress?: () => void }) {
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={`Solde : ${balance} pièces`}
			style={s.chip}
		>
			<CoinIcon />
			<T style={{ color: colors.coin, fontFamily: font.displayBold, fontSize: 15 }}>{balance}</T>
		</Pressable>
	);
}

export function Ring({ pct, label }: { pct: number; label: string }) {
	const c = 226.2;
	return (
		<Svg width={92} height={92} viewBox="0 0 92 92" accessibilityLabel={label} accessibilityRole="image">
			<Circle cx={46} cy={46} r={36} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={10} />
			<Circle
				cx={46}
				cy={46}
				r={36}
				fill="none"
				stroke="#fff"
				strokeWidth={10}
				strokeLinecap="round"
				strokeDasharray={c}
				strokeDashoffset={Math.round(c * (1 - pct / 100) * 10) / 10}
				transform="rotate(-90 46 46)"
			/>
			<SvgText x={46} y={52} textAnchor="middle" fill="#fff" fontFamily={font.displayBold} fontSize={18}>
				{`${pct}%`}
			</SvgText>
		</Svg>
	);
}

export function Bar({ pct, color = colors.coin }: { pct: number; color?: string }) {
	const width = `${Math.max(0, Math.min(100, pct))}%` as DimensionValue;
	return (
		<View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceRaised }}>
			<View style={{ height: 8, borderRadius: 4, backgroundColor: color, width }} />
		</View>
	);
}

export function Title({ children }: { children: ReactNode }) {
	return <T style={{ fontFamily: font.displayBold, fontSize: 26, letterSpacing: -0.26 }}>{children}</T>;
}

/** Écran défilant avec marge pour la barre d'onglets et tirer pour rafraîchir. */
export function Screen({
	children,
	onRefresh,
	refreshing = false,
}: {
	children: ReactNode;
	onRefresh?: () => void;
	refreshing?: boolean;
}) {
	return (
		<SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.background }}>
			<ScrollView
				contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.md, paddingBottom: 40, gap: 20 }}
				refreshControl={
					onRefresh ? (
						<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryLink} />
					) : undefined
				}
			>
				{children}
			</ScrollView>
			<ToastHost />
		</SafeAreaView>
	);
}

export function ToastHost() {
	const toast = useToast();
	if (!toast) return null;
	return (
		<View style={s.toast} accessibilityLiveRegion="polite">
			<T style={{ fontFamily: font.semi, fontSize: 14 }}>{toast}</T>
		</View>
	);
}

export function Segmented<V extends string>({
	value,
	options,
	onChange,
}: {
	value: V;
	options: { id: V; label: string }[];
	onChange: (id: V) => void;
}) {
	return (
		<View style={s.segmented}>
			{options.map((o) => (
				<Pressable
					key={o.id}
					accessibilityRole="button"
					accessibilityState={{ selected: o.id === value }}
					onPress={() => onChange(o.id)}
					style={[s.segment, o.id === value && { backgroundColor: colors.primary }]}
				>
					<T
						style={{
							fontFamily: font.bold,
							fontSize: 14,
							color: o.id === value ? "#fff" : colors.textSoft,
						}}
					>
						{o.label}
					</T>
				</Pressable>
			))}
		</View>
	);
}

export function Button({
	label,
	variant = "primary",
	...p
}: PressableProps & { label: string; variant?: "primary" | "coin" | "ghost" }) {
	const bg = variant === "primary" ? colors.primary : variant === "coin" ? colors.coin : "transparent";
	const fg = variant === "primary" ? "#fff" : variant === "coin" ? colors.onCoin : colors.textSoft;
	return (
		<Pressable
			accessibilityRole="button"
			{...p}
			style={[s.button, { backgroundColor: bg }, p.disabled && { opacity: 0.5 }]}
		>
			<T style={{ fontFamily: font.bold, fontSize: 14, color: fg }}>{label}</T>
		</Pressable>
	);
}

export function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
	return (
		<Pressable accessibilityRole="button" onPress={onPress} style={s.add}>
			<Svg
				width={20}
				height={20}
				viewBox="0 0 24 24"
				fill="none"
				stroke={colors.text}
				strokeWidth={2.4}
				strokeLinecap="round"
			>
				<Path d="M12 5v14M5 12h14" />
			</Svg>
			<T style={{ fontFamily: font.bold, fontSize: 15 }}>{label}</T>
		</Pressable>
	);
}

export function Field({ label, ...p }: TextInputProps & { label: string }) {
	return (
		<View style={{ gap: 6 }}>
			<T style={{ fontFamily: font.semi, fontSize: 14, color: colors.muted }}>{label}</T>
			<TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} {...p} style={[s.input, p.style]} />
		</View>
	);
}

export function Sheet({
	title,
	visible,
	onClose,
	children,
}: {
	title: string;
	visible: boolean;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
			<Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Fermer" />
			<View style={s.sheet}>
				<T style={{ fontFamily: font.displayBold, fontSize: 18 }}>{title}</T>
				<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>
					{children}
				</ScrollView>
			</View>
		</Modal>
	);
}

export const NAV_ICONS = {
	today: (c: string) => (
		<Svg
			width={24}
			height={24}
			viewBox="0 0 24 24"
			fill="none"
			stroke={c}
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<Circle cx={12} cy={12} r={4} />
			<Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
		</Svg>
	),
	habits: (c: string) => (
		<Svg
			width={24}
			height={24}
			viewBox="0 0 24 24"
			fill="none"
			stroke={c}
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<Path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />
		</Svg>
	),
	progress: (c: string) => (
		<Svg
			width={24}
			height={24}
			viewBox="0 0 24 24"
			fill="none"
			stroke={c}
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<Path d="M5 20v-8M12 20V5M19 20v-5" />
		</Svg>
	),
	wishes: (c: string) => (
		<Svg
			width={24}
			height={24}
			viewBox="0 0 24 24"
			fill="none"
			stroke={c}
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<Rect x={3} y={8} width={18} height={13} rx={2} />
			<Path d="M12 8v13M3 12h18M12 8c-1.5-4-6-4.5-6-1.8C6 8 9 8 12 8zM12 8c1.5-4 6-4.5 6-1.8C18 8 15 8 12 8z" />
		</Svg>
	),
};

const s = StyleSheet.create({
	chip: {
		minHeight: 44,
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingHorizontal: 14,
		borderRadius: 22,
		backgroundColor: colors.surfaceRaised,
	},
	toast: {
		position: "absolute",
		bottom: 24,
		alignSelf: "center",
		backgroundColor: colors.surfaceRaised,
		borderRadius: radii.pill,
		paddingHorizontal: 20,
		paddingVertical: 12,
	},
	segmented: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: 14, padding: 4, gap: 4 },
	segment: {
		flex: 1,
		minHeight: 44,
		borderRadius: 10,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 14,
	},
	button: { minHeight: 44, borderRadius: 22, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
	add: {
		minHeight: 54,
		borderRadius: 18,
		borderWidth: 2,
		borderStyle: "dashed",
		borderColor: colors.borderDashed,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
	},
	input: {
		minHeight: 44,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: colors.borderDashed,
		backgroundColor: colors.background,
		color: colors.text,
		paddingHorizontal: 12,
		fontFamily: font.body,
		fontSize: 15,
	},
	backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
	sheet: {
		maxHeight: "85%",
		backgroundColor: colors.surface,
		borderTopLeftRadius: 28,
		borderTopRightRadius: 28,
		padding: spacing.lg,
		gap: 14,
	},
});
