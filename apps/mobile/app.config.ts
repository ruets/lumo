// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ExpoConfig } from "expo/config";

/**
 * Static settings live in app.json. Only the Android `versionCode` is dynamic: CI passes an increasing
 * number (ANDROID_VERSION_CODE) so a newer APK installs over an older one.
 */
export default ({ config }: { config: ExpoConfig }): ExpoConfig => ({
	...config,
	android: {
		...config.android,
		versionCode: Number(process.env.ANDROID_VERSION_CODE ?? 1),
	},
});
