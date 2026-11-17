// SPDX-License-Identifier: AGPL-3.0-or-later

export const fr = {
	"app.name": "Lumo",
	"auth.title": "Connexion",
	"auth.oidc": "Se connecter avec Authentik",
	"auth.local": "Compte local",
	"auth.username": "Identifiant",
	"auth.password": "Mot de passe",
	"auth.submit": "Se connecter",
	"auth.logout": "Se déconnecter",
	"auth.error": "Connexion impossible",
	"home.greeting": "Bonjour, {name}",
	"home.household": "Foyer : {name}",
	"home.wallet.personal": "Porte-monnaie : {amount} pièces",
	"home.wallet.shared": "Cagnotte : {amount} pièces",
	"common.loading": "Chargement…",
} as const;

export type MessageKey = keyof typeof fr;
export type Locale = "fr";

const dictionaries: Record<Locale, Record<MessageKey, string>> = { fr };

export function t(key: MessageKey, params: Record<string, string | number> = {}, locale: Locale = "fr"): string {
	const template = dictionaries[locale][key];
	return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
