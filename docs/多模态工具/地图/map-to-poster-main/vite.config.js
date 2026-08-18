import { defineConfig } from 'vite';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
	esbuild: {
		target: 'esnext',
	},
	optimizeDeps: {
		esbuildOptions: {
			target: 'esnext',
		},
	},
	build: {
		target: 'esnext',
	},
	css: {
		postcss: {
			plugins: [
				tailwindcss({
					content: [
						"./index.html",
						"./main.js",
						"./src/**/*.{js,ts,jsx,tsx}",
					],
					theme: {
						extend: {
							colors: {
								background: '#f8f9fa',
								sidebar: '#ffffff',
							},
							fontFamily: {
								sans: ['Outfit', 'sans-serif'],
								serif: ['"Playfair Display"', 'serif'],
								mono: ['"Fira Code"', 'monospace'],
								poster: ['Outfit', 'sans-serif'],
							}
						},
					},
				}),
				autoprefixer(),
			],
		},
	}
});
