import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import "blobatar/motion.css";
// Order here is not load-bearing — `candidates.css` outranks `motion.css` on
// specificity, deliberately, because Bun emits these two in opposite orders
// under `bun build` and under `bun --hot`. It sits beside the other stylesheets
// rather than inside `App.tsx` only so all three are visible in one place.
import "./candidates.css";

createRoot(document.getElementById("root")!).render(<App />);
