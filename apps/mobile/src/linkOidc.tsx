// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "@lumo/i18n";
import { colors } from "@lumo/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { makeRedirectUri, useAuthRequest, useAutoDiscovery } from "expo-auth-session";
import { randomUUID } from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo } from "react";
import { describeError, keys, useAccount, useAuthConfig } from "./hooks";
import { api } from "./session";
import { showToast } from "./store";
import { Button, font, T } from "./ui";

WebBrowser.maybeCompleteAuthSession();

/** The Authentik part, mounted only when OIDC is configured: the hooks need a valid issuer. */
function LinkButton({ issuer, clientId }: { issuer: string; clientId: string }) {
	const qc = useQueryClient();
	const discovery = useAutoDiscovery(issuer);
	const nonce = useMemo(() => randomUUID(), []);
	const redirectUri = makeRedirectUri({ scheme: "lumo", path: "auth" });
	const [request, response, promptAsync] = useAuthRequest(
		{ clientId, redirectUri, scopes: ["openid", "profile", "email"], usePKCE: true, extraParams: { nonce } },
		discovery,
	);

	useEffect(() => {
		if (response?.type !== "success" || !request?.codeVerifier) return;
		api
			.linkOidcMobile({
				code: response.params.code ?? "",
				codeVerifier: request.codeVerifier,
				redirectUri,
				nonce,
				...(response.params.state ? { state: response.params.state } : {}),
			})
			.then(async () => {
				await qc.invalidateQueries({ queryKey: keys.account });
				showToast(t("link.done"), 4000);
			})
			.catch((err: unknown) => showToast(describeError(err)));
	}, [response, request, redirectUri, nonce, qc]);

	return <Button label={t("link.button")} disabled={!request} onPress={() => void promptAsync()} />;
}

/** "Link my Authentik account" for a signed-in local account: from then on Authentik signs in to this account. */
export function LinkOidc() {
	const config = useAuthConfig().data;
	const account = useAccount().data;
	if (!config?.oidc || !config.oidcIssuer || !config.oidcClientId || !account) return null;
	if (account.oidc)
		return <T style={{ color: colors.success, fontFamily: font.semi, fontSize: 14 }}>{t("link.linked")}</T>;
	return (
		<>
			<T style={{ color: colors.muted, fontSize: 14 }}>{t("link.hint")}</T>
			<LinkButton issuer={config.oidcIssuer} clientId={config.oidcClientId} />
		</>
	);
}
