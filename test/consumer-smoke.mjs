import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "dsh-time-machine-consumer-"),
);

try {
  const packed = await exec(
    npm,
    ["pack", "--ignore-scripts", "--pack-destination", temporary, "--json"],
    { cwd: root, shell: process.platform === "win32" },
  );
  const metadata = JSON.parse(packed.stdout);
  const filename = metadata[0]?.filename;
  if (typeof filename !== "string")
    throw new Error("npm pack did not return a tarball filename");
  const tarball = path.join(temporary, filename);

  await exec(npm, ["init", "--yes"], {
    cwd: temporary,
    shell: process.platform === "win32",
  });
  await exec(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--omit=peer",
      "--no-package-lock",
      "--no-save",
      tarball,
    ],
    { cwd: temporary, shell: process.platform === "win32" },
  );
  const probe = [
    "const core = await import('dsh-plugin-time-machine');",
    "const client = await import('dsh-plugin-time-machine/client');",
    "if (typeof core.apply !== 'function' || typeof client.TimeMachineClient !== 'function') throw new Error('published package exports are incomplete');",
    "console.log('core consumer exports ok (main + ./client)');",
  ].join(" ");
  const imported = await exec(
    process.execPath,
    ["--input-type=module", "-e", probe],
    { cwd: temporary },
  );
  process.stdout.write(imported.stdout);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
