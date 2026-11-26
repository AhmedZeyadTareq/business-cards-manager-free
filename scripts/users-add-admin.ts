// npm run users:add-admin -- <username> --name "Full Name"
// Creates the first admin (and the High Management department). The password is asked
// for in the terminal, so it never lands in the shell history.
import { CreateUserBody } from "@/modules/accounts/account.schema";
import { ensureHighManagement } from "@/modules/accounts/departments.repo";
import { createUser } from "@/modules/accounts/users.repo";
import { withDb } from "@/modules/db/mongo";

function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  // Piped input (tests, CI): read one line.
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => (data += chunk));
      stdin.on("end", () => resolve(data.split(/\r?\n/)[0] ?? ""));
    });
  }
  return new Promise((resolve) => {
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (key: string) => {
      for (const char of key) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") process.exit(130);
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const nameAt = args.indexOf("--name");
  const name = nameAt >= 0 ? args[nameAt + 1] : undefined;
  const username = args.find((arg, index) => !arg.startsWith("--") && index !== nameAt + 1);
  if (!username || !name) {
    console.error('Usage: npm run users:add-admin -- <username> --name "Full Name"');
    process.exit(1);
  }

  const password = await askHidden("Password (at least 8 characters): ");
  await withDb(async () => {
    const department = await ensureHighManagement();
    const input = CreateUserBody.safeParse({
      username,
      name,
      password,
      departmentId: department._id.toHexString(),
      role: "admin",
    });
    if (!input.success) {
      for (const issue of input.error.issues) {
        console.error(`${issue.path.join(".")}: ${issue.message}`);
      }
      process.exit(1);
    }
    const user = await createUser(input.data);
    console.log(`Admin "${user.username}" created in ${department.name}.`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
