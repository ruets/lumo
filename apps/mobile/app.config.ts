// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ExpoConfig } from "expo/config";

/**
 * Static settings live in app.json. Two values are dynamic and come from CI: the Android `versionCode`
 * (ANDROID_VERSION_CODE, an increasing number so a newer APK installs over an older one) and the `version`
 * shown to users (APP_VERSION, the release tag without its leading "v"; Obtainium compares it to the release).
 */
export default ({ config }: { config: ExpoConfig }): ExpoConfig => ({
	...config,
	version: process.env.APP_VERSION?.replace(/^v/, "") || config.version,
	android: {
		...config.android,
		versionCode: Number(process.env.ANDROID_VERSION_CODE ?? 1),
	},
});
