// SPDX-License-Identifier: AGPL-3.0-or-later
import type { HouseholdResponse, Member } from "@lumo/api-client";
import { shortDate, t } from "@lumo/i18n";
import { colors, radii, spacing } from "@lumo/tokens";
import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, Share, Switch, View } from "react-native";
import {
	useCreateInvite,
	useHousehold,
	useMe,
	useRemoveMember,
	useRevokeInvite,
	useUpdateHousehold,
	useUpdateMember,
} from "../src/hooks";
import { currentServerUrl } from "../src/server";
import { showToast } from "../src/store";
import { Avatar, Button, Chip, Field, font, Screen, T } from "../src/ui";

const ROLES = ["owner", "member"] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<View style={{ gap: 10 }}>
			<T style={{ fontFamily: font.bold, fontSize: 15, color: colors.muted }}>{title}</T>
			<View style={{ backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, gap: 14 }}>
				{children}
			</View>
		</View>
	);
}

function MemberRow({
	member,
	isYou,
	canManage,
	first,
}: {
	member: Member;
	isYou: boolean;
	canManage: boolean;
	first: boolean;
}) {
	const update = useUpdateMember();
	const remove = useRemoveMember();
	const confirmRemove = () =>
		Alert.alert(t("household.member.remove"), t("household.member.removeConfirm", { name: member.displayName }), [
			{ text: t("common.cancel"), style: "cancel" },
			{
				text: t("household.member.remove"),
				style: "destructive",
				onPress: () =>
					remove.mutate(member.userId, {
						onSuccess: () => showToast(t("household.member.removed", { name: member.displayName })),
					}),
			},
		]);
	const saved = () => showToast(t("household.saved"), 1500);
	return (
		<View style={first ? { gap: 10 } : { gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
				<Avatar name={member.displayName} onPress={() => undefined} />
				<View style={{ flex: 1 }}>
					<T style={{ fontFamily: font.bold, fontSize: 15 }}>
						{member.displayName}
						{isYou ? ` (${t("household.you")})` : ""}
					</T>
					{!canManage && <T style={{ fontSize: 13, color: colors.muted }}>{t(`role.${member.role}` as const)}</T>}
				</View>
			</View>
			{canManage && (
				<View style={{ gap: 10 }}>
					<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
						{ROLES.map((r) => (
							<Chip
								key={r}
								label={t(`role.${r}` as const)}
								on={member.role === r}
								onPress={() =>
									member.role !== r && update.mutate({ id: member.userId, input: { role: r } }, { onSuccess: saved })
								}
							/>
						))}
					</View>
					{!isYou && (
						<Button
							label={t("household.member.remove")}
							variant="ghost"
							accessibilityLabel={t("household.member.removeFor", { name: member.displayName })}
							disabled={remove.isPending}
							onPress={confirmRemove}
						/>
					)}
				</View>
			)}
		</View>
	);
}

function SettingsSection() {
	const household = useHousehold();
	const h = household.data?.household;
	// Keyed on the saved values so the form resets to what the server now holds.
	return h ? <SettingsForm key={JSON.stringify(h)} h={h} /> : null;
}

function SettingsForm({ h }: { h: HouseholdResponse["household"] }) {
	const update = useUpdateHousehold();
	const [name, setName] = useState(h.name);
	const [backdate, setBackdate] = useState(String(h.backdateDays ?? 2));
	const [unlimited, setUnlimited] = useState(h.backdateDays === null);
	return (
		<Section title={t("household.settings.title")}>
			<Field label={t("household.settings.name")} value={name} onChangeText={setName} maxLength={80} />
			<Field
				label={t("household.settings.backdate")}
				value={backdate}
				onChangeText={setBackdate}
				keyboardType="number-pad"
				editable={!unlimited}
				style={unlimited ? { opacity: 0.4 } : undefined}
			/>
			<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
				<T style={{ fontFamily: font.semi, fontSize: 14, color: colors.textSoft, flex: 1 }}>
					{t("household.settings.backdateUnlimited")}
				</T>
				<Switch value={unlimited} onValueChange={setUnlimited} trackColor={{ true: colors.primary }} />
			</View>
			<T style={{ fontSize: 12, color: colors.muted }}>{t("household.settings.backdateHint")}</T>
			<Button
				label={t("household.settings.save")}
				disabled={update.isPending}
				onPress={() =>
					update.mutate(
						{
							name: name.trim(),
							backdateDays: unlimited ? null : Number(backdate),
						},
						{ onSuccess: () => showToast(t("household.saved"), 1500) },
					)
				}
			/>
		</Section>
	);
}

function InviteSection() {
	const household = useHousehold();
	const create = useCreateInvite();
	const revoke = useRevokeInvite();
	const [role, setRole] = useState<"owner" | "member">("member");
	const [created, setCreated] = useState<{ token: string; expiresAt: string } | null>(null);
	const pending = household.data?.invites ?? [];
	const link = created ? `${currentServerUrl()}/?invite=${created.token}` : "";

	return (
		<>
			<Section title={t("household.invite.title")}>
				<View style={{ flexDirection: "row", gap: 8 }}>
					<Chip label={t("role.member")} on={role === "member"} onPress={() => setRole("member")} />
					<Chip label={t("role.owner")} on={role === "owner"} onPress={() => setRole("owner")} />
				</View>
				<Button
					label={t("household.invite.create")}
					disabled={create.isPending}
					onPress={() => create.mutate(role, { onSuccess: setCreated })}
				/>
				{created && (
					<View
						accessibilityLiveRegion="polite"
						style={{ gap: 8, backgroundColor: colors.background, borderRadius: 12, padding: 12 }}
					>
						<T style={{ fontFamily: font.semi, fontSize: 13, color: colors.success }}>
							{t("household.invite.created")}
						</T>
						<T style={{ fontSize: 12, color: colors.muted }}>{t("household.invite.code")}</T>
						<T selectable style={{ fontSize: 14 }}>
							{created.token}
						</T>
						<T style={{ fontSize: 12, color: colors.muted }}>
							{t("household.invite.expires", { date: shortDate(created.expiresAt.slice(0, 10)) })}
						</T>
						<Button
							label={t("household.invite.share")}
							variant="coin"
							onPress={() => void Share.share({ message: `${link}\n${created.token}` })}
						/>
					</View>
				)}
			</Section>
			<Section title={t("household.invite.pending")}>
				{pending.length === 0 && <T style={{ fontSize: 14, color: colors.muted }}>{t("household.invite.none")}</T>}
				{pending.map((i) => (
					<View
						key={i.id}
						style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}
					>
						<View style={{ flex: 1 }}>
							<T style={{ fontFamily: font.semi, fontSize: 15 }}>{t(`role.${i.role}` as const)}</T>
							<T style={{ fontSize: 12, color: colors.muted }}>
								{t("household.invite.expires", { date: shortDate(i.expiresAt.slice(0, 10)) })}
							</T>
						</View>
						<Button
							label={t("household.invite.revoke")}
							variant="ghost"
							accessibilityLabel={t("household.invite.revokeFor", { role: t(`role.${i.role}` as const) })}
							disabled={revoke.isPending}
							onPress={() => revoke.mutate(i.id)}
						/>
					</View>
				))}
			</Section>
		</>
	);
}

export default function HouseholdScreen() {
	const me = useMe().data;
	const household = useHousehold();
	const canManage = me?.role === "owner";
	return (
		<Screen topInset={false}>
			<Stack.Screen
				options={{
					headerShown: true,
					headerBackButtonDisplayMode: "minimal",
					title: t("household.title"),
					headerStyle: { backgroundColor: colors.background },
					headerTintColor: colors.text,
					headerTitleStyle: { fontFamily: font.bold },
					headerShadowVisible: false,
				}}
			/>
			<Section title={`${t("household.members")} · ${household.data?.household.name ?? me?.household?.name ?? ""}`}>
				{household.data?.members.map((m, i) => (
					<MemberRow key={m.userId} member={m} isYou={m.userId === me?.user.id} canManage={canManage} first={i === 0} />
				))}
			</Section>
			{canManage && <InviteSection />}
			{canManage && <SettingsSection />}
		</Screen>
	);
}
