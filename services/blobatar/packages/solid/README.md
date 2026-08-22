# @blobatar/solid

Solid adapter for [blobatar](https://github.com/Alain00/blobatar) — deterministic geometric avatars.

## Installation

```sh
bun add @blobatar/solid blobatar
```

## Usage

```tsx
import { Blobatar } from "@blobatar/solid";

function App() {
  return <Blobatar name="username" />;
}
```

## What this package ships

Three builds, picked by your toolchain: JSX source behind the `solid` condition
for anything running `vite-plugin-solid`, an SSR build under `node`, and a DOM
build by default. Solid compiles differently per target rather than branching at
runtime, so a consumer handed the wrong one renders nothing — the conditions are
what keep that from happening.

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
