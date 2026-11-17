// SPDX-License-Identifier: AGPL-3.0-or-later
import { en } from "./locales/en.js";
import { fr } from "./locales/fr.js";

/** Every supported locale. To add one: create `locales/<code>.ts` typed `Record<MessageKey, string>` and list it here. */
export const messages = { en, fr } as const;

/** Every dictionary entry, including plural forms (`key_one`, `key_other`). */
export type MessageId = keyof typeof en;

type PluralSuffix = "_zero" | "_one" | "_two" | "_few" | "_many" | "_other";
type StripPlural<K extends string> = K extends `${infer Base}${PluralSuffix}` ? Base : K;

/** What callers pass to `t`: the key without its plural suffix. */
export type MessageKey = StripPlural<MessageId>;
