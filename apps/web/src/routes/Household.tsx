// SPDX-License-Identifier: AGPL-3.0-or-later
import type { HouseholdResponse, Member, MeResponse } from "@lumo/api-client";
import { shortDate, t } from "@lumo/i18n";
import { useState } from "react";
import { Avatar } from "../components/AppShell";
import { Field, fieldClass, PageTitle, PrimaryButton } from "../components/ui";
import {
	useCreateInvite,
	useHousehold,
	useRemoveMember,
	useRevokeInvite,
	useUpdateHousehold,
	useUpdateMember,
} from "../lib/hooks";
import { showToast } from "../lib/toast";

type Household = HouseholdResponse["household"];

const ROLES = ["owner", "member"] as const;

function MemberRow({ member, isYou, canManage }: { member: Member; isYou: boolean; canManage: boolean }) {
	const update = useUpdateMember();
	const remove = useRemoveMember();
	const saved = () => showToast(t("household.saved"), 1500);
	const confirmRemove = () => {
		if (!window.confirm(t("household.member.removeConfirm", { name: member.displayName }))) return;
		remove.mutate(member.userId, {
			onSuccess: () => showToast(t("household.member.removed", { name: member.displayName })),
		});
	};
	return (
		<li className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0">
			<Avatar name={member.displayName} />
			<span className="grid min-w-0 grow">
				<span className="truncate text-[15px] font-bold">
					{member.displayName}
					{isYou && <span className="ml-2 text-xs font-semibold text-muted">({t("household.you")})</span>}
				</span>
				{!canManage && <span className="text-[13px] text-muted">{t(`role.${member.role}` as const)}</span>}
			</span>
			{canManage && (
				<>
					<select
						aria-label={`${t("household.role")} — ${member.displayName}`}
						value={member.role}
						onChange={(e) =>
							update.mutate(
								{ id: member.userId, input: { role: e.target.value as Member["role"] } },
								{ onSuccess: saved },
							)
						}
						className={`${fieldClass} w-auto`}
					>
						{ROLES.map((r) => (
							<option key={r} value={r}>
								{t(`role.${r}` as const)}
							</option>
						))}
					</select>
					{!isYou && (
						<button
							type="button"
							aria-label={t("household.member.removeFor", { name: member.displayName })}
							disabled={remove.isPending}
							onClick={confirmRemove}
							className="min-h-11 cursor-pointer rounded-full border border-edge bg-transparent px-4 font-body text-sm font-bold text-bad hover:bg-raised"
						>
							{t("household.member.remove")}
						</button>
					)}
				</>
			)}
		</li>
	);
}

function SettingsSection() {
	const household = useHousehold();
	const h = household.data?.household;
	// Keyed on the saved values so the form resets to what the server now holds.
	return h ? <SettingsForm key={JSON.stringify(h)} h={h} /> : null;
}

function SettingsForm({ h }: { h: Household }) {
	const update = useUpdateHousehold();
	const [unlimited, setUnlimited] = useState(h.backdateDays === null);

	function submit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const f = new FormData(e.currentTarget);
		update.mutate(
			{
				name: String(f.get("name") ?? "").trim(),
				backdateDays: unlimited ? null : Number(f.get("backdateDays")),
			},
			{ onSuccess: () => showToast(t("household.saved"), 1500) },
		);
	}

	return (
		<section className="grid gap-2.5">
			<h2 className="m-0 text-[15px] font-bold text-muted">{t("household.settings.title")}</h2>
			<form onSubmit={submit} className="grid gap-3 rounded-[20px] bg-surface p-4">
				<Field label={t("household.settings.name")}>
					<input name="name" defaultValue={h.name} required maxLength={80} className={fieldClass} />
				</Field>
				<Field label={t("household.settings.backdate")}>
					<input
						name="backdateDays"
						type="number"
						min={0}
						max={30}
						defaultValue={h.backdateDays ?? 2}
						disabled={unlimited}
						required={!unlimited}
						className={`${fieldClass} disabled:opacity-40`}
					/>
				</Field>
				<label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-soft">
					<input
						type="checkbox"
						checked={unlimited}
						onChange={(e) => setUnlimited(e.target.checked)}
						className="size-5"
					/>
					{t("household.settings.backdateUnlimited")}
				</label>
				<p className="m-0 -mt-2 text-xs text-muted">{t("household.settings.backdateHint")}</p>
				<div>
					<PrimaryButton type="submit" disabled={update.isPending}>
						{t("household.settings.save")}
					</PrimaryButton>
				</div>
			</form>
		</section>
	);
}

function InviteSection() {
	const household = useHousehold();
	const create = useCreateInvite();
	const revoke = useRevokeInvite();
	const [role, setRole] = useState<"owner" | "member">("member");
	const [created, setCreated] = useState<{ token: string; expiresAt: string } | null>(null);
	const link = created ? `${window.location.origin}/?invite=${created.token}` : "";
	const pending = household.data?.invites ?? [];

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			showToast(t("household.invite.copied"), 1500);
		} catch {
			// clipboard unavailable (insecure context): the text stays selectable on screen
		}
	}

	return (
		<section className="grid gap-2.5">
			<h2 className="m-0 text-[15px] font-bold text-muted">{t("household.invite.title")}</h2>
			<div className="grid gap-3.5 rounded-[20px] bg-surface p-4">
				<div className="flex flex-wrap items-center gap-3">
					<select
						aria-label={t("household.role")}
						value={role}
						onChange={(e) => setRole(e.target.value as "owner" | "member")}
						className={`${fieldClass} w-auto`}
					>
						<option value="member">{t("role.member")}</option>
						<option value="owner">{t("role.owner")}</option>
					</select>
					<PrimaryButton disabled={create.isPending} onClick={() => create.mutate(role, { onSuccess: setCreated })}>
						{t("household.invite.create")}
					</PrimaryButton>
				</div>
				{created && (
					<div role="status" className="grid gap-2 rounded-xl bg-bg p-3">
						<p className="m-0 text-sm font-semibold text-ok">{t("household.invite.created")}</p>
						<p className="m-0 text-xs text-muted">{t("household.invite.link")}</p>
						<div className="flex flex-wrap items-center gap-2">
							<code className="min-w-0 grow break-all text-sm">{link}</code>
							<button
								type="button"
								onClick={() => void copy(link)}
								className="min-h-11 cursor-pointer rounded-full border border-edge bg-transparent px-4 font-body text-sm font-bold text-soft"
							>
								{t("household.invite.copy")}
							</button>
						</div>
						<p className="m-0 text-xs text-muted">{t("household.invite.code")}</p>
						<div className="flex flex-wrap items-center gap-2">
							<code className="min-w-0 grow break-all text-sm">{created.token}</code>
							<button
								type="button"
								onClick={() => void copy(created.token)}
								className="min-h-11 cursor-pointer rounded-full border border-edge bg-transparent px-4 font-body text-sm font-bold text-soft"
							>
								{t("household.invite.copy")}
							</button>
						</div>
						<p className="m-0 text-xs text-muted">
							{t("household.invite.expires", { date: shortDate(created.expiresAt.slice(0, 10)) })}
						</p>
					</div>
				)}
			</div>

			<h2 className="m-0 mt-2 text-[15px] font-bold text-muted">{t("household.invite.pending")}</h2>
			<div className="grid gap-1 rounded-[20px] bg-surface px-4">
				{pending.length === 0 && <p className="m-0 py-3 text-sm text-muted">{t("household.invite.none")}</p>}
				{pending.map((i) => (
					<div key={i.id} className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-b-0">
						<span className="grid">
							<span className="text-[15px] font-semibold">{t(`role.${i.role}` as const)}</span>
							<span className="text-xs text-muted">
								{t("household.invite.expires", { date: shortDate(i.expiresAt.slice(0, 10)) })}
							</span>
						</span>
						<button
							type="button"
							aria-label={t("household.invite.revokeFor", { role: t(`role.${i.role}` as const) })}
							disabled={revoke.isPending}
							onClick={() => revoke.mutate(i.id)}
							className="min-h-11 cursor-pointer rounded-full border border-edge bg-transparent px-4 font-body text-sm font-bold text-soft hover:bg-raised"
						>
							{t("household.invite.revoke")}
						</button>
					</div>
				))}
			</div>
		</section>
	);
}

export function HouseholdPage({ me }: { me: MeResponse }) {
	const household = useHousehold(Boolean(me.household));
	const canManage = me.role === "owner";
	return (
		<div className="grid max-w-2xl gap-5">
			<PageTitle>{t("household.title")}</PageTitle>
			<p className="m-0 -mt-3 text-sm text-muted">{household.data?.household.name ?? me.household?.name}</p>
			<section className="grid gap-2.5">
				<h2 className="m-0 text-[15px] font-bold text-muted">{t("household.members")}</h2>
				<ul className="m-0 list-none rounded-[20px] bg-surface px-4 py-0">
					{household.data?.members.map((m) => (
						<MemberRow key={m.userId} member={m} isYou={m.userId === me.user.id} canManage={canManage} />
					))}
				</ul>
			</section>
			{canManage && <InviteSection />}
			{canManage && <SettingsSection />}
		</div>
	);
}
