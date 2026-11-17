// SPDX-License-Identifier: AGPL-3.0-or-later

/** URL publique de l'API Lumo (ex. https://lumo.example.org), définie à la compilation. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:3000";
/** Issuer Authentik (même application OIDC que le web, avec la redirect URI `lumo://auth`). Vide = OIDC masqué. */
export const OIDC_ISSUER = process.env.EXPO_PUBLIC_OIDC_ISSUER ?? "";
export const OIDC_CLIENT_ID = process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? "";
