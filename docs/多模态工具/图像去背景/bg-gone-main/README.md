# bg gone

Remove the background from any image. Runs locally, in your browser or from the terminal. Nothing is uploaded.

remove.bg is shutting down in December 2026, so here's mine. Live at [bentossell.com/bg-gone](https://bentossell.com/bg-gone/).

## Terminal

Needs Node 20 or newer. The first run downloads the model once (224MB) into `~/.cache/bg-gone`. Set `BG_GONE_CACHE` to move it.

```sh
npx github:bentossell/bg-gone photo.jpg                          # writes photo-no-bg.png next to it
npx github:bentossell/bg-gone a.jpg b.png --bg white --out ./cut # batch, solid background, output folder
npx github:bentossell/bg-gone ./photos --mask                    # every image in a folder, matte only
cat photo.jpg | npx github:bentossell/bg-gone - > cutout.png     # stdin to stdout
```

Or install it once:

```sh
npm i -g github:bentossell/bg-gone
bg-gone photo.jpg
```

```
usage
  bg-gone <input...> [options]
  cat photo.jpg | bg-gone - > cutout.png

inputs
  files, folders (every image inside), http(s) urls, or - for stdin.

options
  -o, --out <path>     output file (one input) or folder (many inputs). - for stdout.
      --bg <colour>    solid background: white, black, any css colour name, or hex.
      --mask           write the matte as a greyscale png instead of a cutout.
      --suffix <text>  added to each output name. default -no-bg (or -mask).
      --model <name>   birefnet (default, best) or rmbg (smaller and faster, rougher edges).
      --dtype <name>   fp32 | fp16 | q8. default fp32 for birefnet, q8 for rmbg.
      --device <name>  cpu (default). cuda or dml if your onnxruntime build has it.
  -q, --quiet          only print errors.
  -h, --help
  -v, --version
```

Output is PNG with alpha. With `--bg` the extension of `--out` decides the format, so `--bg white -o photo.jpg` works. On an M-series Mac, BiRefNet takes about 6s per image on CPU and RMBG about 1s.

## Browser

`index.html` is the whole app, one file with no build step. Drop, paste, or pick images. It uses WebGPU when available and falls back to WASM.

- `?src=<image url>` processes on load. Add `&bg=white`, `&bg=black`, `&bg=<css colour name>` or `&bg=<hex without #>` for a solid background.
- The result renders into `canvas#cv`. `#status` reads `WxH · Ns` when done, or starts with `failed`.
- Headless Chrome works with `--enable-unsafe-webgpu`. Poll `#status`, since the compute runs off the main thread.

Serve it with any static server, for example `npm run dev` then open http://localhost:4173/. The page links to a font and favicon from the parent site, which are optional.

## Models

| | id | size | where |
|---|---|---|---|
| BiRefNet lite | [onnx-community/BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX) | 224MB fp32 | terminal default |
| BiRefNet lite, WebGPU | [jiabins0303/birefnet-lite-1024-webgpu](https://huggingface.co/jiabins0303/birefnet-lite-1024-webgpu) | 110MB fp16 | browser with WebGPU |
| RMBG-1.4 | [briaai/RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) | 44MB q8 | browser fallback, `--model rmbg` |

Everything runs through [transformers.js](https://huggingface.co/docs/transformers.js). BiRefNet is MIT. RMBG-1.4 is [free for non-commercial use](https://huggingface.co/briaai/RMBG-1.4#license), so check before you use it in a product.

## Licence

MIT. See [LICENSE](LICENSE).
