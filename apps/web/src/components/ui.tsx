// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from "@lumo/i18n";
import { type ReactNode, useEffect, useRef, useState } from "react";

export function CoinIcon({ size = 18 }: { size?: number }) {
	return (
		<svg
			aria-hidden="true"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.2"
		>
			<circle cx="12" cy="12" r="9" />
			<circle cx="12" cy="12" r="4.5" />
		</svg>
	);
}

export const Reward = ({ amount }: { amount: number }) => (
	<span className="flex items-center gap-1 text-sm font-bold text-coin">
		<CoinIcon size={14} />+{amount}
	</span>
);

export function Ring({ pct, label }: { pct: number; label: string }) {
	const c = 226.2;
	return (
		<svg role="img" aria-label={label} width="92" height="92" viewBox="0 0 92 92" className="shrink-0">
			<circle cx="46" cy="46" r="36" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="10" />
			<circle
				cx="46"
				cy="46"
				r="36"
				fill="none"
				stroke="#fff"
				strokeWidth="10"
				strokeLinecap="round"
				strokeDasharray={c}
				strokeDashoffset={Math.round(c * (1 - pct / 100) * 10) / 10}
				transform="rotate(-90 46 46)"
			/>
			<text
				x="46"
				y="52"
				textAnchor="middle"
				fill="#fff"
				fontFamily="Unbounded, sans-serif"
				fontSize="15"
				fontWeight="700"
			>
				{pct}%
			</text>
		</svg>
	);
}

export const Bar = ({ pct, color = "bg-coin" }: { pct: number; color?: string }) => (
	<span aria-hidden="true" className="flex h-2 rounded bg-raised">
		<span className={`rounded ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
	</span>
);

export const PageTitle = ({ children }: { children: ReactNode }) => (
	<h1 className="m-0 font-display text-[26px] font-bold tracking-tight">{children}</h1>
);

/** Exclusive choice segment (Habits/Tasks, Week/Month). */
export function Segmented<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { id: T; label: string }[];
	onChange: (id: T) => void;
}) {
	return (
		<fieldset className="m-0 flex min-w-0 gap-1 rounded-[14px] border-0 bg-surface p-1">
			<legend className="sr-only">{label}</legend>
			{options.map((o) => (
				<button
					key={o.id}
					type="button"
					aria-pressed={o.id === value}
					onClick={() => onChange(o.id)}
					className={`min-h-11 flex-1 cursor-pointer rounded-[10px] border-0 px-4 font-body text-sm font-bold ${
						o.id === value ? "bg-primary text-white" : "bg-transparent text-soft hover:bg-raised"
					}`}
				>
					{o.label}
				</button>
			))}
		</fieldset>
	);
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		ref.current?.showModal();
	}, []);
	return (
		<dialog
			ref={ref}
			onClose={onClose}
			onPointerDown={(e) => e.target === ref.current && ref.current?.close()}
			aria-label={title}
			className="m-auto w-[min(92vw,440px)] rounded-3xl border-0 bg-surface p-6 text-ink backdrop:bg-black/60"
		>
			<h2 className="m-0 mb-4 font-display text-lg font-bold">{title}</h2>
			{children}
		</dialog>
	);
}

export const fieldClass =
	"min-h-11 w-full rounded-xl border border-edge bg-bg px-3 font-body text-[15px] text-ink placeholder:text-muted";

export function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the field is passed as `children`
		<label className="grid gap-1.5 text-sm font-semibold text-muted">
			{label}
			{children}
		</label>
	);
}

/**
 * Asks before a destructive action, inside the app: `window.confirm` is blocked or skipped by some embedded
 * browsers and webviews. `ask(message, label, run)` opens the dialog; render `dialog` next to the trigger.
 */
export function useConfirm() {
	const [pending, setPending] = useState<{ message: string; label: string; run: () => void } | null>(null);
	const ask = (message: string, label: string, run: () => void) => setPending({ message, label, run });
	const dialog = pending && (
		<Dialog title={pending.label} onClose={() => setPending(null)}>
			<p className="m-0 mb-5 text-sm text-soft">{pending.message}</p>
			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={() => setPending(null)}
					className="min-h-11 cursor-pointer rounded-full border-0 bg-transparent px-4 font-body text-sm font-bold text-soft"
				>
					{t("common.cancel")}
				</button>
				<button
					type="button"
					onClick={() => {
						const { run } = pending;
						setPending(null);
						run();
					}}
					className="min-h-11 cursor-pointer rounded-full border-0 bg-bad px-5 font-body text-sm font-bold text-bg"
				>
					{pending.label}
				</button>
			</div>
		</Dialog>
	);
	return { ask, dialog };
}

export const PrimaryButton = ({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
	<button
		type="button"
		{...p}
		className="min-h-11 cursor-pointer rounded-full border-0 bg-primary px-5 font-body text-sm font-bold text-white disabled:opacity-50"
	>
		{children}
	</button>
);

export const AddButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
	<button
		type="button"
		onClick={onClick}
		className="flex min-h-[54px] w-full cursor-pointer items-center justify-center gap-2 rounded-[18px] border-2 border-dashed border-edge bg-transparent font-body text-[15px] font-bold text-ink hover:bg-surface"
	>
		<svg
			aria-hidden="true"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.4"
			strokeLinecap="round"
		>
			<path d="M12 5v14M5 12h14" />
		</svg>
		{label}
	</button>
);
