// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LocaleBoundary } from "./lib/locale";
import { router } from "./router";
import "./styles.css";

const queryClient = new QueryClient({
	defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true } },
});

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<LocaleBoundary>
				<RouterProvider router={router} />
			</LocaleBoundary>
		</QueryClientProvider>
	</StrictMode>,
);
