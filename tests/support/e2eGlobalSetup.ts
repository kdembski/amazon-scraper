import { execSync } from "child_process";
import { fileURLToPath } from "url";

// E2E tests run what gets deployed, so build it first
export default function setup() {
  const cwd = fileURLToPath(new URL("../..", import.meta.url));
  execSync("npm run build", { cwd, stdio: "inherit" });
}
