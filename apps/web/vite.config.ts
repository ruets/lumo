// SPDX-License-Identifier: AGPL-3.0-or-later
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		// In development the API runs on :3000; the session cookie stays same-origin.
		proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
	},
});
