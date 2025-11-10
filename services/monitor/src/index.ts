import { Command } from "commander";
import fs from "fs";
import Monitor from "./Monitor";
import type { PassedMonitorConfig } from "./types";
import path from "path";

// Initialize a new commander object
const program = new Command();

// Setup command line flags
program
  .option(
    "--configPath <path>",
    "Path to the configuration JSON file",
    path.resolve(__dirname, "../config.json"),
  )
  .option(
    "--chainsPath <path>",
    "Path to the chains JSON file",
    path.resolve(__dirname, "../monitorChains.json"),
  );

// Parse the arguments
program.parse(process.argv);

// Access options using program.opts()
const options = program.opts();

// Load JSON with existence check
function loadJSON(filePath: string, throws = true) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (fs.existsSync(absolutePath)) {
    const jsonData = fs.readFileSync(absolutePath, "utf8");
    if (!jsonData) {
      if (throws) throw new Error(`File ${absolutePath} exists but is empty.`);
      console.warn(`File ${absolutePath} exists but is empty.`);
      return undefined;
    }
    let json;

    try {
      json = JSON.parse(jsonData);
    } catch (error) {
      throw new Error(`File ${absolutePath} is not valid JSON.`);
    }
    return json;
  } else {
    if (throws) throw new Error(`File ${absolutePath} does not exist.`);
    console.warn(`File ${absolutePath} does not exist. Using default values.`);
    return undefined;
  }
}

const config = loadJSON(options.configPath, false) as
  | PassedMonitorConfig
  | undefined;
const monitoredChains = loadJSON(options.chainsPath) as
  | { chainId: number; rpc: string[]; name: string }[]
  | undefined;

if (monitoredChains) {
  if (require.main === module) {
    const monitor = new Monitor(monitoredChains, config);
    monitor
      .start()
      .then(() => {
        console.log("Monitor started successfully");
      })
      .catch((error) => {
        console.error("Failed to start monitor", error);
      });
  }
} else {
  console.error("Failed to load config and/or chains.");
}
