import { serve } from "bun";
import index from "./index.html";

const server = serve({
  // 3001 so the tuning grid and the landing page (apps/site, on 3000) can run
  // side by side — comparing them is most of what the grid is for now.
  port: 3001,
  routes: { "/*": index },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`blobatar tuning grid → ${server.url}`);
