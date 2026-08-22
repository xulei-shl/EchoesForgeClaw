# @blobatar/solid

## 2.4.0

## 2.3.1

## 2.3.0

### Minor Changes

- a5fd112: Add Svelte, Solid, and Preact adapters
  
  Three new framework adapters, each its own package under ADR-0009 — its own
  build, its own peers, and its own row in `packages/harness`.
  
  Each holds a real component written in its framework's own idiom and compiled
  by its framework's own transform, which is what splitting the packages bought:
  `@blobatar/preact` against `preact/jsx-runtime`, `@blobatar/solid` through
  `babel-preset-solid` (emitting a DOM build, an SSR build, and JSX source for
  consumers running `vite-plugin-solid`), and `@blobatar/svelte` as a Svelte
  component the consumer's own compiler builds.
  
  `@blobatar/svelte` publishes source rather than a `dist` and is reachable only
  through the `svelte` export condition — see ADR-0010.
  
  All three peer-depend on `blobatar` with an exact major range (`2.x`) plus their
  own framework peer, read `_parts` from `blobatar/internal` and `blobatarUri`
  from `blobatar/uri`, and support both rendering modes.
