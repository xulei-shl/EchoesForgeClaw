# @blobatar/svelte

Svelte adapter for [blobatar](https://github.com/Alain00/blobatar) — deterministic geometric avatars.

## Installation

```sh
bun add @blobatar/svelte blobatar
```

## Usage

```svelte
<script>
  import { Blobatar } from "@blobatar/svelte";
</script>

<Blobatar name="username" />
```

## What this package ships

Svelte, not JavaScript. A Svelte component only becomes renderable code inside
your compiler, so there is no build output here and none is invented — the
package is reachable through the `svelte` export condition, which every Svelte
toolchain applies (`vite-plugin-svelte`, SvelteKit, `svelte-check`). A bundler
configured without it will fail to resolve this package rather than hand you a
file it cannot execute.

Svelte 5 is required: the component is written with runes.

## Props

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | **Required.** Who the blobatar is for. |
| `size` | `number` | Width and height in pixels. |
| `animate` | `"always" \| "hover"` | Enable animation. |
| `background` | `string \| false` | Background style. |
| `palette` | `string[]` | Color palette. |
| `hue` | `number` | Pin the hue. |
| `tone` | `number` | Pin the tone. |
| `normalize` | `boolean` | Normalize the name. |
| `contrast` | `boolean` | Enable contrast. |
| `title` | `string` | Accessible title. |
| `expression` | `Expression` | Expression to render. |
| `traits` | `TraitOverrides` | Override specific traits. |

## License

MIT
