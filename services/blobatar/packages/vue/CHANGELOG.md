# @blobatar/vue

## 2.4.0

## 2.3.1

## 2.3.0

## 2.2.0

### Minor Changes

- 011915a: Adapters are published under their own names: **`@blobatar/react`** and **`@blobatar/vue`**.
  
  Nothing breaks. `blobatar/react` and `blobatar/vue` keep working and render exactly what they always did — the new packages re-export them, so they are the same component and cannot drift. Move when it suits you:
  
  ```sh
  bunx blobatar-codemod .
  bun add @blobatar/react
  ```
  
  The old subpaths are deprecated and frozen, and go in v3. They are also the last two: adapters added from here on are packages only, so `blobatar`'s optional peer list stops growing at `react` and `vue` instead of naming every framework the library ever supports.
  
  Also new: `blobatar/internal` (`_parts`, `_layout`, `serializeVars`), the entry point adapters build against. Its shape changes only on a major, together with every `@blobatar/*` package. It is not a general-purpose API — `blobatar()` and `blobatarUri()` remain the public answers for rendering markup.
  
  No blobatar changes. Faces are byte-identical to the previous release.
