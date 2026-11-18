// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountResponse } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import type { FormEvent } from "react";
import { Field, fieldClass, PrimaryButton } from "../components/ui";
import { useCreateOwnHousehold, useJoinHousehold } from "../lib/hooks";

const value = (e: FormEvent<HTMLFormElement>, name: string) =>
	String(new FormData(e.currentTarget).get(name) ?? "").trim();

/** For an account in no household: join one with a code, or create one when the instance allows it. */
export function HouseholdAccess({ account, hint = true }: { account: AccountResponse; hint?: boolean }) {
	const join = useJoinHousehold();
	const create = useCreateOwnHousehold();
	return (
		<>
			{hint && <p className="m-0 text-sm text-muted">{t("noHousehold.settingsHint")}</p>}
			<form
				onSubmit={(e) => {
					e.preventDefault();
					join.mutate(value(e, "code"));
				}}
				className="grid gap-3"
			>
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
					className="grid gap-3 border-t border-line pt-3"
				>
					<Field label={t("noHousehold.createName")}>
						<input name="name" required maxLength={80} className={fieldClass} />
					</Field>
					<PrimaryButton type="submit" disabled={create.isPending}>
						{t("noHousehold.create")}
					</PrimaryButton>
				</form>
			)}
		</>
	);
}
