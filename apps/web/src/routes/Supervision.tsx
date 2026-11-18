// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SupervisionResponse } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { Link } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { Field, fieldClass, PageTitle, PrimaryButton } from "../components/ui";
import { api } from "../lib/api";
import { useSupervision, useSupervisionWrite } from "../lib/hooks";

const RIGHTS = ["canCreate", "canModify", "canDelete", "canTransfer"] as const;

export function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="grid gap-2.5">
			<h2 className="m-0 text-[15px] font-bold text-muted">{title}</h2>
			<div className="grid gap-3 rounded-[20px] bg-surface p-4">{children}</div>
		</section>
	);
}

const ghost =
	"min-h-11 cursor-pointer rounded-full border border-edge bg-transparent px-4 font-body text-sm font-bold text-soft hover:bg-raised";

function Codes() {
	const [shown, setShown] = useState<string | null>(null);
	const make = useSupervisionWrite((kind: "supervise" | "be_supervised") => api.createSupervisionCode(kind));
	const redeem = useSupervisionWrite((code: string) => api.redeemSupervisionCode(code));
	return (
		<>
			<div className="flex flex-wrap gap-2">
				{(["supervise", "be_supervised"] as const).map((kind) => (
					<button
						key={kind}
						type="button"
						className={ghost}
						onClick={() => make.mutate(kind, { onSuccess: (r) => setShown(r.token) })}
					>
						{kind === "supervise" ? t("supervision.codeSupervise") : t("supervision.codeBeSupervised")}
					</button>
				))}
			</div>
			{shown && (
				<div className="grid gap-1.5">
					<p className="m-0 text-sm text-muted">{t("supervision.codeShown")}</p>
					<code className="select-all break-all rounded-xl bg-bg p-3 text-sm">{shown}</code>
				</div>
			)}
			<form
				onSubmit={(e: FormEvent<HTMLFormElement>) => {
					e.preventDefault();
					const form = e.currentTarget;
					redeem.mutate(String(new FormData(form).get("code") ?? "").trim(), { onSuccess: () => form.reset() });
				}}
				className="grid gap-3 border-t border-line pt-3"
			>
				<Field label={t("supervision.redeemTitle")}>
					<input name="code" required minLength={10} autoComplete="off" className={fieldClass} />
				</Field>
				<p className="m-0 -mt-2 text-xs text-muted">{t("supervision.redeemHint")}</p>
				<PrimaryButton type="submit" disabled={redeem.isPending}>
					{t("supervision.redeem")}
				</PrimaryButton>
			</form>
		</>
	);
}

function CreateWard() {
	const create = useSupervisionWrite((input: Parameters<typeof api.createWardAccount>[0]) =>
		api.createWardAccount(input),
	);
	return (
		<form
			onSubmit={(e: FormEvent<HTMLFormElement>) => {
				e.preventDefault();
				const form = e.currentTarget;
				const f = new FormData(form);
				create.mutate(
					{
						displayName: String(f.get("displayName") ?? "").trim(),
						username: String(f.get("username") ?? "").trim(),
						password: String(f.get("password") ?? ""),
					},
					{ onSuccess: () => form.reset() },
				);
			}}
			className="grid gap-3"
		>
			<h3 className="m-0 text-sm font-bold">{t("supervision.createAccount")}</h3>
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
				{t("supervision.createAccount")}
			</PrimaryButton>
		</form>
	);
}

function MySupervision({ data }: { data: SupervisionResponse }) {
	return (
		<Section title={t("supervision.guardians")}>
			{data.guardians.length === 0 ? (
				<p className="m-0 text-sm text-muted">{t("supervision.noGuardians")}</p>
			) : (
				<>
					<p className="m-0 text-[15px] font-bold">{data.guardians.map((g) => g.displayName).join(", ")}</p>
					<h3 className="m-0 text-sm font-bold text-muted">{t("supervision.rights")}</h3>
					<ul className="m-0 grid list-none gap-1.5 p-0">
						{RIGHTS.map((r) => (
							<li key={r} className="flex items-center gap-2 text-sm">
								<span aria-hidden="true">{data.rights?.[r] ? "✓" : "✗"}</span>
								{t(`supervision.right.${r}` as const)}
							</li>
						))}
					</ul>
				</>
			)}
		</Section>
	);
}

export function SupervisionPage() {
	const q = useSupervision();
	const data = q.data;
	return (
		<div className="grid max-w-xl gap-5">
			<PageTitle>{t("supervision.title")}</PageTitle>
			{data && <MySupervision data={data} />}
			{data && !data.rights && (
				<Section title={t("supervision.wards")}>
					{data.wards.length === 0 && <p className="m-0 text-sm text-muted">{t("supervision.noWards")}</p>}
					{data.wards.map((w) => (
						<Link
							key={w.id}
							to="/supervision/$wardId"
							params={{ wardId: w.id }}
							className="flex min-h-11 items-center justify-between font-bold text-ink no-underline"
						>
							{w.displayName}
							<span className="text-sm text-link">{t("supervision.manage")} ›</span>
						</Link>
					))}
					<div className="border-t border-line pt-3">
						<CreateWard />
					</div>
				</Section>
			)}
			<Section title={t("supervision.redeemTitle")}>
				<Codes />
			</Section>
		</div>
	);
}
