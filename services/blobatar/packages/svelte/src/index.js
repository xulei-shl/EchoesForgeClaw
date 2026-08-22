/**
 * Plain JavaScript, not TypeScript, and that is the whole point of the file.
 *
 * This package is source-resolved (ADR-0010): what ships is Svelte, compiled by
 * the consumer. That makes every file here something a consumer's toolchain has
 * to read, so the only TypeScript that ships is inside the component's
 * `lang="ts"` block — which the Svelte compiler strips on its own — and inside
 * declarations, which are types by definition. The entry itself is JS so a
 * bundler that resolves this package needs nothing but a Svelte plugin.
 *
 * Named rather than default, so `import { Blobatar }` reads the same here as in
 * every other adapter.
 */
export { default as Blobatar } from "./Blobatar.svelte";
