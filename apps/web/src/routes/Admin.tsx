// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AdminHousehold, AdminUser } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { type FormEvent, type ReactNode, useState } from "react";
import { Field, fieldClass, PageTitle, PrimaryButton, useConfirm } from "../components/ui";
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
	const confirm = useConfirm();
	const remove = useAdminWrite(() => api.adminDeleteUser(user.id));
	const assign = useAdminWrite((householdId: string) =>
		api.adminAssignHousehold(user.id, { householdId, role: "member" }),
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
						confirm.ask(t("admin.user.deleteConfirm", { name: user.displayName }), t("admin.user.delete"), () =>
							remove.mutate(undefined, { onSuccess: saved }),
						);
					}}
				>
					{t("admin.user.delete")}
				</button>
			</span>
			{confirm.dialog}
		</li>
	);
}

/** A super admin invites someone: they create their own account (Authentik or local) with the code. */
function InviteUser() {
	const [token, setToken] = useState<string | null>(null);
	const make = useAdminWrite(() => api.adminCreateAccountInvite());
	return (
		<div className="grid gap-2 border-t border-line pt-3">
			<button
				type="button"
				className={ghost}
				onClick={() => make.mutate(undefined, { onSuccess: (r) => setToken(r.token) })}
			>
				{t("admin.invite.button")}
			</button>
			{token && (
				<div className="grid gap-1.5">
					<p className="m-0 text-sm text-muted">{t("admin.invite.shown")}</p>
					<p className="m-0 text-xs text-muted">{t("admin.invite.link")}</p>
					<code className="select-all break-all rounded-xl bg-bg p-3 text-sm">{`${window.location.origin}/?invite=${token}`}</code>
					<p className="m-0 text-xs text-muted">{t("admin.invite.code")}</p>
					<code className="select-all break-all rounded-xl bg-bg p-3 text-sm">{token}</code>
				</div>
			)}
		</div>
	);
}

function HouseholdRow({ household }: { household: AdminHousehold }) {
	const rename = useAdminWrite((name: string) => api.adminRenameHousehold(household.id, name));
	const confirm = useConfirm();
	const archive = useAdminWrite((archived: boolean) => api.adminArchiveHousehold(household.id, archived));
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
				{household.archived && <span className="text-xs font-bold text-bad">{t("admin.household.archived")}</span>}
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
					className={household.archived ? ghost : danger}
					onClick={() => {
						if (household.archived) return archive.mutate(false, { onSuccess: saved });
						confirm.ask(
							t("admin.household.archiveConfirm", { name: household.name }),
							t("admin.household.archive"),
							() => archive.mutate(true, { onSuccess: saved }),
						);
					}}
				>
					{household.archived ? t("admin.household.unarchive") : t("admin.household.archive")}
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
			{confirm.dialog}
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
				<InviteUser />
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
