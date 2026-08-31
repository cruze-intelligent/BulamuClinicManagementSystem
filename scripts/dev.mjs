import { spawn } from "node:child_process";

const services = [
  { name: "backend", script: "dev:backend" },
  { name: "frontend", script: "dev:frontend" },
];

let shuttingDown = false;
const children = services.map(({ name, script }) => {
  const command =
    process.platform === "win32"
      ? { bin: "cmd.exe", args: ["/d", "/s", "/c", `npm run ${script}`] }
      : { bin: "npm", args: ["run", script] };

  const child = spawn(command.bin, command.args, {
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`${name} dev server exited with ${reason}`);
    shutdown(code || 1);
  });

  return child;
});

function stopProcessTree(child) {
  if (!child.pid || child.killed) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    return;
  }

  child.kill("SIGTERM");
}

function shutdown(code = 0) {
  shuttingDown = true;
  children.forEach(stopProcessTree);
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
