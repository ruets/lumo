// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AdminHousehold, AdminUser } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { colors, radii, spacing } from "@lumo/tokens";
import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import { useAdminHouseholds, useAdminSettings, useAdminUsers, useAdminWrite } from "../src/hooks";
import { api } from "../src/session";
import { showToast } from "../src/store";
import { Button, Chip, Field, font, Screen, T } from "../src/ui";

const saved = () => showToast(t("admin.saved"), 1500);

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

const confirm = (title: string, message: string, onOk: () => void) =>
	Alert.alert(title, message, [
		{ text: t("common.cancel"), style: "cancel" },
		{ text: title, style: "destructive", onPress: onOk },
	]);

function UserRow({ user, households }: { user: AdminUser; households: AdminHousehold[] }) {
	const update = useAdminWrite((input: Parameters<typeof api.adminUpdateUser>[1]) =>
		api.adminUpdateUser(user.id, input),
	);
	const remove = useAdminWrite(() => api.adminDeleteUser(user.id));
	const takeOut = useAdminWrite((householdId: string) => api.adminRemoveFromHousehold(user.id, householdId));
	const joinable = households.filter((h) => !user.households.some((m) => m.id === h.id));
	const assign = useAdminWrite((householdId: string) =>
		api.adminAssignHousehold(user.id, { householdId, role: "member" }),
	);
	const [picking, setPicking] = useState(false);
	return (
		<View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
			<T style={{ fontFamily: font.bold, fontSize: 15 }}>
				{user.displayName}
				{user.username ? `  @${user.username}` : ""}
				{user.isSuperAdmin ? `  · ${t("admin.superAdmin")}` : ""}
				{user.disabled ? `  · ${t("admin.disabled")}` : ""}
			</T>
			<T style={{ color: colors.muted, fontSize: 13 }}>
				{user.households.length > 0
					? user.households.map((h) => `${h.name} · ${t(`role.${h.role}` as const)}`).join(", ")
					: t("admin.noHousehold")}
			</T>
			<Button
				variant="ghost"
				label={user.isSuperAdmin ? t("admin.user.removeAdmin") : t("admin.user.makeAdmin")}
				onPress={() => update.mutate({ isSuperAdmin: !user.isSuperAdmin }, { onSuccess: saved })}
			/>
			<Button
				variant="ghost"
				label={user.disabled ? t("admin.user.enable") : t("admin.user.disable")}
				onPress={() => update.mutate({ disabled: !user.disabled }, { onSuccess: saved })}
			/>
			{user.households.map((h) => (
				<Button
					key={h.id}
					variant="ghost"
					label={t("admin.user.takeOutOf", { name: h.name })}
					onPress={() => takeOut.mutate(h.id, { onSuccess: saved })}
				/>
			))}
			{joinable.length > 0 && (
				<>
					<Button variant="ghost" label={t("admin.user.assign")} onPress={() => setPicking((v) => !v)} />
					{picking && (
						<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
							{joinable.map((h) => (
								<Chip
									key={h.id}
									label={h.name}
									on={false}
									onPress={() =>
										assign.mutate(h.id, {
											onSuccess: () => {
												setPicking(false);
												saved();
											},
										})
									}
								/>
							))}
						</View>
					)}
				</>
			)}
			<Button
				variant="ghost"
				label={t("admin.user.delete")}
				onPress={() =>
					confirm(t("admin.user.delete"), t("admin.user.deleteConfirm", { name: user.displayName }), () =>
						remove.mutate(undefined, { onSuccess: saved }),
					)
				}
			/>
		</View>
	);
}

/** A super admin invites someone: they create their own account (Authentik or local) with the code. */
function InviteUser() {
	const [token, setToken] = useState<string | null>(null);
	const make = useAdminWrite(() => api.adminCreateAccountInvite());
	return (
		<View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
			<Button
				variant="ghost"
				label={t("admin.invite.button")}
				onPress={() => make.mutate(undefined, { onSuccess: (r) => setToken(r.token) })}
			/>
			{token && (
				<View style={{ gap: 6 }}>
					<T style={{ color: colors.muted, fontSize: 14 }}>{t("admin.invite.shown")}</T>
					<T selectable style={{ backgroundColor: colors.background, borderRadius: 12, padding: 12, fontSize: 14 }}>
						{token}
					</T>
				</View>
			)}
		</View>
	);
}

function HouseholdRow({ household }: { household: AdminHousehold }) {
	const rename = useAdminWrite((name: string) => api.adminRenameHousehold(household.id, name));
	const archive = useAdminWrite((archived: boolean) => api.adminArchiveHousehold(household.id, archived));
	const adjust = useAdminWrite((input: { amount: number; note: string }) => api.adminAdjustPot(household.id, input));
	const [open, setOpen] = useState<"rename" | "pot" | null>(null);
	const [name, setName] = useState(household.name);
	const [amount, setAmount] = useState("");
	const [note, setNote] = useState("");
	return (
		<View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
			<T style={{ fontFamily: font.bold, fontSize: 15 }}>
				{household.name} · {t("admin.household.members", { count: household.memberCount })}
				{household.archived ? ` · ${t("admin.household.archived")}` : ""}
			</T>
			<Button
				variant="ghost"
				label={t("admin.household.rename")}
				onPress={() => setOpen(open === "rename" ? null : "rename")}
			/>
			{open === "rename" && (
				<>
					<Field label={t("admin.household.name")} value={name} onChangeText={setName} maxLength={80} />
					<Button
						label={t("form.save")}
						disabled={!name.trim() || rename.isPending}
						onPress={() =>
							rename.mutate(name.trim(), {
								onSuccess: () => {
									setOpen(null);
									saved();
								},
							})
						}
					/>
				</>
			)}
			<Button variant="ghost" label={t("admin.pot.adjust")} onPress={() => setOpen(open === "pot" ? null : "pot")} />
			{open === "pot" && (
				<>
					<Field
						label={t("admin.pot.amount")}
						value={amount}
						onChangeText={setAmount}
						keyboardType="numbers-and-punctuation"
					/>
					<Field label={t("admin.pot.note")} value={note} onChangeText={setNote} maxLength={500} />
					<Button
						label={t("admin.pot.adjust")}
						disabled={!Number.isInteger(Number(amount)) || Number(amount) === 0 || !note.trim() || adjust.isPending}
						onPress={() =>
							adjust.mutate(
								{ amount: Number(amount), note: note.trim() },
								{
									onSuccess: (r) => {
										setOpen(null);
										setAmount("");
										setNote("");
										showToast(t("admin.pot.balance", { amount: r.balance }), 2500);
									},
								},
							)
						}
					/>
				</>
			)}
			<Button
				variant="ghost"
				label={household.archived ? t("admin.household.unarchive") : t("admin.household.archive")}
				onPress={() =>
					household.archived
						? archive.mutate(false, { onSuccess: saved })
						: confirm(t("admin.household.archive"), t("admin.household.archiveConfirm", { name: household.name }), () =>
								archive.mutate(true, { onSuccess: saved }),
							)
				}
			/>
		</View>
	);
}

function CreateHousehold() {
	const create = useAdminWrite((name: string) => api.adminCreateHousehold(name));
	const [name, setName] = useState("");
	return (
		<View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
			<Field label={t("admin.household.name")} value={name} onChangeText={setName} maxLength={80} />
			<Button
				label={t("admin.household.create")}
				disabled={!name.trim() || create.isPending}
				onPress={() =>
					create.mutate(name.trim(), {
						onSuccess: () => {
							setName("");
							saved();
						},
					})
				}
			/>
		</View>
	);
}

function Settings() {
	const settings = useAdminSettings();
	const update = useAdminWrite((householdCreation: "anyone" | "admins") =>
		api.adminUpdateSettings({ householdCreation }),
	);
	if (!settings.data) return null;
	return (
		<Section title={t("admin.settings")}>
			<T style={{ color: colors.muted, fontSize: 14 }}>{t("admin.settings.creation")}</T>
			<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
				{(["anyone", "admins"] as const).map((v) => (
					<Chip
						key={v}
						label={t(`admin.settings.${v}` as const)}
						on={settings.data.householdCreation === v}
						onPress={() => update.mutate(v, { onSuccess: saved })}
					/>
				))}
			</View>
		</Section>
	);
}

/** Instance administration for super admins: accounts, households, instance settings. Never any content. */
export default function AdminScreen() {
	const users = useAdminUsers();
	const households = useAdminHouseholds();
	const list = households.data?.households ?? [];
	return (
		<Screen topInset={false}>
			<Stack.Screen
				options={{
					headerShown: true,
					headerBackButtonDisplayMode: "minimal",
					title: t("admin.title"),
					headerStyle: { backgroundColor: colors.background },
					headerTintColor: colors.text,
					headerTitleStyle: { fontFamily: font.bold },
					headerShadowVisible: false,
				}}
			/>
			<Section title={t("admin.users")}>
				{users.data?.users.map((u) => (
					<UserRow key={u.id} user={u} households={list} />
				))}
				<InviteUser />
			</Section>
			<Section title={t("admin.households")}>
				{list.map((h) => (
					<HouseholdRow key={h.id} household={h} />
				))}
				<CreateHousehold />
			</Section>
			<Settings />
		</Screen>
	);
}
