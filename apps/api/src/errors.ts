// SPDX-License-Identifier: AGPL-3.0-or-later

/** Erreur métier renvoyée au client en `application/problem+json` (RFC 9457). */
export class AppError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		readonly title: string,
		readonly detail?: string,
	) {
		super(detail ?? title);
		this.name = "AppError";
	}
}

export const errors = {
	unauthenticated: () => new AppError(401, "unauthenticated", "Authentification requise"),
	invalidCredentials: () => new AppError(401, "invalid_credentials", "Identifiant ou mot de passe incorrect"),
	forbidden: (detail?: string) => new AppError(403, "forbidden", "Action interdite", detail),
	invitationRequired: () =>
		new AppError(403, "invitation_required", "Une invitation est nécessaire pour créer un compte"),
	invalidInvite: () => new AppError(400, "invalid_invite", "Invitation invalide, expirée ou déjà utilisée"),
	localAuthDisabled: () => new AppError(404, "local_auth_disabled", "Les comptes locaux sont désactivés"),
	oidcDisabled: () => new AppError(404, "oidc_disabled", "La connexion OIDC n'est pas configurée"),
	oidcFailed: (detail?: string) => new AppError(400, "oidc_failed", "Échec de la connexion OIDC", detail),
	setupDone: () => new AppError(409, "setup_done", "L'instance est déjà initialisée"),
	conflict: (code: string, title: string) => new AppError(409, code, title),
	validation: (detail: string) => new AppError(400, "validation_error", "Requête invalide", detail),
};

export function toProblem(err: AppError, instance?: string) {
	return {
		type: `https://lumo.invalid/problems/${err.code}`,
		title: err.title,
		status: err.status,
		code: err.code,
		...(err.detail ? { detail: err.detail } : {}),
		...(instance ? { instance } : {}),
	};
}
