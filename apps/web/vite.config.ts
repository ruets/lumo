// SPDX-License-Identifier: AGPL-3.0-or-later
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		// En développement, l'API tourne sur :3000 ; le cookie de session reste same-origin.
		proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
	},
});
