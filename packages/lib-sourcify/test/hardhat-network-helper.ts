import treeKill from 'tree-kill';
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';

export function startHardhatNetwork(port: number) {
  return new Promise<ChildProcess>((resolve) => {
    const hardhatNodeProcess = spawn('npx', [
      'hardhat',
      'node',
      '--port',
      port.toString(),
    ]);

    hardhatNodeProcess.stderr.on('data', (data: Buffer) => {
      console.error(`Hardhat Network Error: ${data.toString()}`);
    });

    hardhatNodeProcess.stdout.on('data', (data: Buffer) => {
      console.log(data.toString());
      if (
        data
          .toString()
          .includes('Started HTTP and WebSocket JSON-RPC server at')
      ) {
        resolve(hardhatNodeProcess);
      }
    });
  });
}

export function stopHardhatNetwork(hardhatNodeProcess: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    treeKill(hardhatNodeProcess.pid!, 'SIGTERM', (err) => {
      if (err) {
        console.error(`Failed to kill process tree: ${err}`);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
