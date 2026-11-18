// SPDX-License-Identifier: AGPL-3.0-or-later
import { hasSeveralSpaces, type SpaceFilter } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { setSpaceFilter } from "../lib/space";

/** All / Personal / one pill per household. Hidden when the person has a single space. */
export function SpacePills({
	households,
	value,
}: {
	households: readonly { id: string; name: string }[];
	value: SpaceFilter;
}) {
	if (!hasSeveralSpaces(households)) return null;
	const options: { id: SpaceFilter; label: string }[] = [
		{ id: "all", label: t("space.all") },
		{ id: "personal", label: t("space.personal") },
		...households.map((h) => ({ id: h.id as SpaceFilter, label: h.name })),
	];
	return (
		<fieldset className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
			<legend className="sr-only">{t("space.filter")}</legend>
			{options.map((o) => (
				<button
					key={o.id}
					type="button"
					aria-pressed={value === o.id}
					onClick={() => setSpaceFilter(o.id)}
					className={`min-h-9 cursor-pointer rounded-full border-0 px-4 font-body text-[13px] font-bold ${
						value === o.id ? "bg-primary text-white" : "bg-raised text-soft hover:bg-edge"
					}`}
				>
					{o.label}
				</button>
			))}
		</fieldset>
	);
}
