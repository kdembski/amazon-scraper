import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { image } from "@@tests/support/e2e";

// Builds the production image the e2e-docker project runs
export default function setup() {
  const cwd = fileURLToPath(new URL("../..", import.meta.url));
  execSync(`docker build -t ${image} .`, { cwd, stdio: "inherit" });
}
