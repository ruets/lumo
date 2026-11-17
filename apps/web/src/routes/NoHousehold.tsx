// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountResponse } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { type FormEvent, useState } from "react";
import { Field, fieldClass, PrimaryButton } from "../components/ui";
import { useCreateOwnHousehold, useJoinHousehold, useLogout } from "../lib/hooks";
import { LanguageSelect } from "../lib/locale";
import { AdminPage } from "./Admin";

/** An account that is in no household: join with a code, create one (when allowed), or administer the instance. */
export function NoHousehold({ account }: { account: AccountResponse }) {
	const logout = useLogout();
	const join = useJoinHousehold();
	const create = useCreateOwnHousehold();
	const [admin, setAdmin] = useState(false);
	const value = (e: FormEvent<HTMLFormElement>, name: string) =>
		String(new FormData(e.currentTarget).get(name) ?? "").trim();
	const link = "min-h-11 cursor-pointer border-0 bg-transparent font-body text-sm font-semibold text-link underline";

	return (
		<main className="mx-auto grid w-full max-w-xl gap-5 px-5 py-12">
			<h1 className="m-0 font-display text-[26px] font-bold">{t("noHousehold.title")}</h1>
			<p className="m-0 text-sm text-muted">
				{account.canCreateHousehold ? t("noHousehold.hint") : t("noHousehold.hintClosed")}
			</p>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					join.mutate(value(e, "code"));
				}}
				className="grid gap-3 rounded-[20px] bg-surface p-4"
			>
				<h2 className="m-0 text-[15px] font-bold text-muted">{t("noHousehold.joinTitle")}</h2>
				<Field label={t("noHousehold.code")}>
					<input name="code" required minLength={10} autoComplete="off" className={fieldClass} />
				</Field>
				<PrimaryButton type="submit" disabled={join.isPending}>
					{t("noHousehold.join")}
				</PrimaryButton>
			</form>
			{account.canCreateHousehold && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						create.mutate(value(e, "name"));
					}}
					className="grid gap-3 rounded-[20px] bg-surface p-4"
				>
					<h2 className="m-0 text-[15px] font-bold text-muted">{t("noHousehold.createTitle")}</h2>
					<Field label={t("noHousehold.createName")}>
						<input name="name" required maxLength={80} className={fieldClass} />
					</Field>
					<PrimaryButton type="submit" disabled={create.isPending}>
						{t("noHousehold.create")}
					</PrimaryButton>
				</form>
			)}
			{account.isSuperAdmin && (
				<>
					<button type="button" className={link} onClick={() => setAdmin((v) => !v)}>
						{t("admin.open")}
					</button>
					{admin && <AdminPage />}
				</>
			)}
			<LanguageSelect />
			<button type="button" className={link} onClick={() => void logout()}>
				{t("auth.logout")}
			</button>
		</main>
	);
}
