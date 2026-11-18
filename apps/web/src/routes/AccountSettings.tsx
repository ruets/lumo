// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountResponse } from "@lumo/api-client";
import { t, weekdayLong, weekdayNarrow } from "@lumo/i18n";
import { type FormEvent, useState } from "react";
import { Field, fieldClass, PrimaryButton } from "../components/ui";
import { useUpdateAccount } from "../lib/hooks";
import { showToast } from "../lib/toast";

/** The person's own time zone and first weekday: nobody has two "todays", whatever households they are in. */
export function AccountSettings({ account }: { account: AccountResponse }) {
	// Keyed on the saved values so the form resets to what the server now holds.
	return <AccountForm key={`${account.timezone}|${account.weekStart}`} account={account} />;
}

function AccountForm({ account }: { account: AccountResponse }) {
	const update = useUpdateAccount();
	const [weekStart, setWeekStart] = useState(account.weekStart);
	const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

	function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const f = new FormData(e.currentTarget);
		update.mutate(
			{ timezone: String(f.get("timezone") ?? "").trim(), weekStart },
			{ onSuccess: () => showToast(t("household.saved"), 1500) },
		);
	}

	return (
		<form onSubmit={submit} className="grid gap-3">
			<Field label={t("account.timezone")}>
				<input
					name="timezone"
					defaultValue={account.timezone}
					required
					list="lumo-time-zones"
					autoComplete="off"
					className={fieldClass}
				/>
			</Field>
			<datalist id="lumo-time-zones">
				{zones.map((z) => (
					<option key={z} value={z} />
				))}
			</datalist>
			<p className="m-0 -mt-2 text-xs text-muted">{t("account.timezoneHint")}</p>
			<fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0">
				<legend className="mb-1.5 p-0 text-sm font-semibold text-muted">{t("account.weekStart")}</legend>
				<div className="flex gap-1.5">
					{[1, 2, 3, 4, 5, 6, 7].map((d) => (
						<button
							key={d}
							type="button"
							aria-pressed={weekStart === d}
							aria-label={weekdayLong(d)}
							title={weekdayLong(d)}
							onClick={() => setWeekStart(d)}
							className={`grid size-11 cursor-pointer place-items-center rounded-full border-0 font-body text-sm font-bold ${
								weekStart === d ? "bg-primary text-white" : "bg-raised text-soft hover:bg-edge"
							}`}
						>
							{weekdayNarrow(d)}
						</button>
					))}
				</div>
			</fieldset>
			<div>
				<PrimaryButton type="submit" disabled={update.isPending}>
					{t("account.save")}
				</PrimaryButton>
			</div>
		</form>
	);
}
