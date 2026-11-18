// SPDX-License-Identifier: AGPL-3.0-or-later
import { hasSeveralSpaces, type SpaceFilter } from "@lumo/api-client";
import { t } from "@lumo/i18n";
import { View } from "react-native";
import { setSpaceFilter } from "./space";
import { Chip } from "./ui";

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
		<View accessibilityLabel={t("space.filter")} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
			{options.map((o) => (
				<Chip key={o.id} label={o.label} on={value === o.id} onPress={() => setSpaceFilter(o.id)} />
			))}
		</View>
	);
}
