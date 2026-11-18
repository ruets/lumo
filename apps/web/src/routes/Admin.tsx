// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AdminHousehold, AdminUser } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { type FormEvent, type ReactNode, useState } from "react";
import { Field, fieldClass, PageTitle, PrimaryButton } from "../components/ui";
import { api } from "../lib/api";
import { useAdminHouseholds, useAdminSettings, useAdminUsers, useAdminWrite } from "../lib/hooks";
import { showToast } from "../lib/toast";

const ghost =
	"min-h-11 cursor-pointer rounded-full border border-edge bg-transparent px-4 font-body text-sm font-bold text-soft hover:bg-raised";
const danger = `${ghost} text-bad`;

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="grid gap-2.5">
			<h2 className="m-0 text-[15px] font-bold text-muted">{title}</h2>
			<div className="grid gap-3 rounded-[20px] bg-surface p-4">{children}</div>
		</section>
	);
}

const saved = () => showToast(t("admin.saved"), 1500);

function UserRow({ user, households }: { user: AdminUser; households: AdminHousehold[] }) {
	const update = useAdminWrite(({ input }: { input: Parameters<typeof api.adminUpdateUser>[1] }) =>
		api.adminUpdateUser(user.id, input),
	);
	const remove = useAdminWrite(() => api.adminDeleteUser(user.id));
	const assign = useAdminWrite((householdId: string) =>
		api.adminAssignHousehold(user.id, { householdId, role: "adult" }),
	);
	const takeOut = useAdminWrite((householdId: string) => api.adminRemoveFromHousehold(user.id, householdId));
	const joinable = households.filter((h) => !user.households.some((m) => m.id === h.id));
	return (
		<li className="grid gap-2 border-b border-line py-3 last:border-b-0">
			<span className="flex flex-wrap items-baseline gap-2">
				<strong className="text-[15px]">{user.displayName}</strong>
				{user.username && <span className="text-xs text-muted">@{user.username}</span>}
				{user.isSuperAdmin && <span className="text-xs font-bold text-link">{t("admin.superAdmin")}</span>}
				{user.disabled && <span className="text-xs font-bold text-bad">{t("admin.disabled")}</span>}
			</span>
			<span className="text-[13px] text-muted">
				{user.households.length > 0
					? user.households.map((h) => `${h.name} · ${t(`role.${h.role}` as const)}`).join(", ")
					: t("admin.noHousehold")}
			</span>
			<span className="flex flex-wrap gap-2">
				<button
					type="button"
					className={ghost}
					onClick={() => update.mutate({ input: { isSuperAdmin: !user.isSuperAdmin } }, { onSuccess: saved })}
				>
					{user.isSuperAdmin ? t("admin.user.removeAdmin") : t("admin.user.makeAdmin")}
				</button>
				<button
					type="button"
					className={ghost}
					onClick={() => update.mutate({ input: { disabled: !user.disabled } }, { onSuccess: saved })}
				>
					{user.disabled ? t("admin.user.enable") : t("admin.user.disable")}
				</button>
				{user.households.map((h) => (
					<button key={h.id} type="button" className={ghost} onClick={() => takeOut.mutate(h.id, { onSuccess: saved })}>
						{t("admin.user.takeOutOf", { name: h.name })}
					</button>
				))}
				{joinable.length > 0 && (
					<select
						aria-label={t("admin.user.assign")}
						value=""
						onChange={(e) => e.target.value && assign.mutate(e.target.value, { onSuccess: saved })}
						className={`${fieldClass} w-auto`}
					>
						<option value="">{t("admin.user.assign")}</option>
						{joinable.map((h) => (
							<option key={h.id} value={h.id}>
								{h.name}
							</option>
						))}
					</select>
				)}
				<button
					type="button"
					className={danger}
					onClick={() => {
						if (window.confirm(t("admin.user.deleteConfirm", { name: user.displayName })))
							remove.mutate(undefined, { onSuccess: saved });
					}}
				>
					{t("admin.user.delete")}
				</button>
			</span>
		</li>
	);
}

function CreateUserForm() {
	const create = useAdminWrite((input: Parameters<typeof api.adminCreateUser>[0]) => api.adminCreateUser(input));
	function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const f = new FormData(form);
		create.mutate(
			{
				displayName: String(f.get("displayName") ?? "").trim(),
				username: String(f.get("username") ?? "").trim(),
				password: String(f.get("password") ?? ""),
			},
			{
				onSuccess: () => {
					form.reset();
					saved();
				},
			},
		);
	}
	return (
		<form onSubmit={submit} className="grid gap-3 border-t border-line pt-3">
			<h3 className="m-0 text-sm font-bold">{t("admin.user.create")}</h3>
			<Field label={t("admin.user.displayName")}>
				<input name="displayName" required maxLength={80} className={fieldClass} />
			</Field>
			<Field label={t("auth.username")}>
				<input name="username" required minLength={3} maxLength={32} autoComplete="off" className={fieldClass} />
			</Field>
			<Field label={t("auth.password")}>
				<input
					name="password"
					type="password"
					required
					minLength={10}
					autoComplete="new-password"
					className={fieldClass}
				/>
			</Field>
			<PrimaryButton type="submit" disabled={create.isPending}>
				{t("admin.user.create")}
			</PrimaryButton>
		</form>
	);
}

function HouseholdRow({ household }: { household: AdminHousehold }) {
	const rename = useAdminWrite((name: string) => api.adminRenameHousehold(household.id, name));
	const remove = useAdminWrite(() => api.adminDeleteHousehold(household.id));
	const adjust = useAdminWrite((input: { amount: number; note: string }) => api.adminAdjustPot(household.id, input));
	const [pot, setPot] = useState(false);
	function submitPot(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const f = new FormData(e.currentTarget);
		adjust.mutate(
			{ amount: Number(f.get("amount")), note: String(f.get("note") ?? "").trim() },
			{
				onSuccess: (r) => {
					setPot(false);
					showToast(t("admin.pot.balance", { amount: r.balance }), 2500);
				},
			},
		);
	}
	return (
		<li className="grid gap-2 border-b border-line py-3 last:border-b-0">
			<span className="flex flex-wrap items-baseline gap-2">
				<strong className="text-[15px]">{household.name}</strong>
				<span className="text-xs text-muted">{t("admin.household.members", { count: household.memberCount })}</span>
			</span>
			<span className="flex flex-wrap gap-2">
				<button
					type="button"
					className={ghost}
					onClick={() => {
						const name = window.prompt(t("admin.household.name"), household.name)?.trim();
						if (name && name !== household.name) rename.mutate(name, { onSuccess: saved });
					}}
				>
					{t("admin.household.rename")}
				</button>
				<button type="button" className={ghost} onClick={() => setPot((v) => !v)}>
					{t("admin.pot.adjust")}
				</button>
				<button
					type="button"
					className={danger}
					onClick={() => {
						if (window.confirm(t("admin.household.deleteConfirm", { name: household.name })))
							remove.mutate(undefined, { onSuccess: saved });
					}}
				>
					{t("admin.household.delete")}
				</button>
			</span>
			{pot && (
				<form onSubmit={submitPot} className="grid gap-3">
					<Field label={t("admin.pot.amount")}>
						<input name="amount" type="number" step={1} required className={fieldClass} />
					</Field>
					<Field label={t("admin.pot.note")}>
						<input name="note" required maxLength={500} className={fieldClass} />
					</Field>
					<PrimaryButton type="submit" disabled={adjust.isPending}>
						{t("admin.pot.adjust")}
					</PrimaryButton>
				</form>
			)}
		</li>
	);
}

function CreateHouseholdForm() {
	const create = useAdminWrite((name: string) => api.adminCreateHousehold(name));
	function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		create.mutate(String(new FormData(form).get("name") ?? "").trim(), {
			onSuccess: () => {
				form.reset();
				saved();
			},
		});
	}
	return (
		<form onSubmit={submit} className="grid gap-3 border-t border-line pt-3">
			<Field label={t("admin.household.name")}>
				<input name="name" required maxLength={80} className={fieldClass} />
			</Field>
			<PrimaryButton type="submit" disabled={create.isPending}>
				{t("admin.household.create")}
			</PrimaryButton>
		</form>
	);
}

function SettingsSection() {
	const settings = useAdminSettings();
	const update = useAdminWrite((householdCreation: "anyone" | "admins") =>
		api.adminUpdateSettings({ householdCreation }),
	);
	if (!settings.data) return null;
	return (
		<Section title={t("admin.settings")}>
			<Field label={t("admin.settings.creation")}>
				<select
					value={settings.data.householdCreation}
					onChange={(e) => update.mutate(e.target.value as "anyone" | "admins", { onSuccess: saved })}
					className={fieldClass}
				>
					<option value="anyone">{t("admin.settings.anyone")}</option>
					<option value="admins">{t("admin.settings.admins")}</option>
				</select>
			</Field>
		</Section>
	);
}

/** Instance administration for super admins: accounts, households, instance settings. Never any content. */
export function AdminPage() {
	const users = useAdminUsers();
	const households = useAdminHouseholds();
	const list = households.data?.households ?? [];
	return (
		<div className="grid max-w-xl gap-5">
			<PageTitle>{t("admin.title")}</PageTitle>
			<Section title={t("admin.users")}>
				<ul className="m-0 list-none p-0">
					{users.data?.users.map((u) => (
						<UserRow key={u.id} user={u} households={list} />
					))}
				</ul>
				<CreateUserForm />
			</Section>
			<Section title={t("admin.households")}>
				<ul className="m-0 list-none p-0">
					{list.map((h) => (
						<HouseholdRow key={h.id} household={h} />
					))}
				</ul>
				<CreateHouseholdForm />
			</Section>
			<SettingsSection />
		</div>
	);
}
