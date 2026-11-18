// SPDX-License-Identifier: AGPL-3.0-or-later

/** Business error returned to the client as `application/problem+json` (RFC 9457). */
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
	unauthenticated: () => new AppError(401, "unauthenticated", "Authentication required"),
	invalidCredentials: () => new AppError(401, "invalid_credentials", "Incorrect username or password"),
	forbidden: (detail?: string) => new AppError(403, "forbidden", "Forbidden", detail),
	invitationRequired: () => new AppError(403, "invitation_required", "An invitation is required to create an account"),
	invalidInvite: () => new AppError(400, "invalid_invite", "Invitation invalid, expired or already used"),
	localAuthDisabled: () => new AppError(404, "local_auth_disabled", "Local accounts are disabled"),
	oidcDisabled: () => new AppError(404, "oidc_disabled", "OIDC sign-in is not configured"),
	oidcFailed: (detail?: string) => new AppError(400, "oidc_failed", "OIDC sign-in failed", detail),
	setupDone: () => new AppError(409, "setup_done", "This instance is already set up"),
	noHousehold: () => new AppError(403, "no_household", "This account is not in a household"),
	accountDisabled: () => new AppError(403, "account_disabled", "This account is disabled"),
	alreadyMember: () => new AppError(409, "already_member", "This account is already in this household"),
	conflict: (code: string, title: string) => new AppError(409, code, title),
	invalidCode: () => new AppError(400, "invalid_code", "Code invalid, expired or already used"),
	supervised: () => new AppError(403, "supervised", "Your guardians do not allow this"),
	notFound: (what: string) => new AppError(404, "not_found", `${what} not found`),
	validation: (detail: string) => new AppError(400, "validation_error", "Invalid request", detail),
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
