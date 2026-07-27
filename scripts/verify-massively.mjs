/**
 * This program verifies all the contracts in repository/contracts/{MATCH_TYPE}/{CHAIN_ID} one after the other
 * 
 * You need to give as input:
 *  - the repository folder: path
 *  - the MATCH_TYPE: full_match | partial_match
 *  - the CHAIN_ID: number
 * 
 * You can set the environment variable "API_URL" to change the sourcify host, default: https://staging.sourcify.dev/server
 *
 * example:
 * node ./scripts/test-high-demand.mjs /home/user/sourcify/repository/contracts full_match 421613
 */

import fs from 'fs'
import path from 'path'

const API_URL = (process.env.API_URL || 'https://staging.sourcify.dev/server').replace(/\/+$/, '');
const POLL_INTERVAL_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// API v2 is async: submit returns a verificationId, the outcome is polled from
// the job endpoint.
const verifyFiles = async (address, chain, metadata, sources) => {
  const headers = { 'Content-Type': 'application/json' };
  const submission = await fetch(`${API_URL}/v2/verify/metadata/${chain}/${address}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ metadata, sources }),
  })

  if (submission.status === 409) {
    return { status: 'already_verified' }
  }
  if (submission.status !== 202) {
    throw new Error(`Request failed for ${address} with status ${submission.status}, body:

${await submission.text()}
    `)
  }

  const { verificationId } = await submission.json()

  for (;;) {
    const jobResponse = await fetch(`${API_URL}/v2/verify/${verificationId}`)
    if (!jobResponse.ok) {
      throw new Error(`Failed to fetch job ${verificationId} for ${address} with status ${jobResponse.status}`)
    }

    const job = await jobResponse.json()
    if (job.isJobCompleted) {
      return { status: job.error ? job.error.customCode : 'verified' }
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

function exploreDirectory(dir, obj) {
  // Get a list of all files in the directory
  const files = fs.readdirSync(dir);

  // Loop through each file in the directory
  for (const file of files) {
    // Get the full path of the file
    const filepath = `${dir}/${file}`;

    // Check if the file is a directory or a regular file
    if (fs.statSync(filepath).isDirectory()) {
      // If it's a directory, recursively explore it
      exploreDirectory(filepath, obj);
    } else {
      // If it's a regular file, read its contents and add it to the object
      obj[filepath] = fs.readFileSync(filepath, 'utf8');
    }
  }
}

export async function listFolders(dir) {
  const files = await fs.promises.readdir(dir);

  const folders = files.filter(file => {
    const filePath = path.join(dir, file);
    return fs.promises.stat(filePath).then(stat => stat.isDirectory());
  });

  return folders;
}


export async function verifyContractInPath(address, chain, contractPath) {
  // create an empty object to hold the file contents
  const files = {};

  // start exploring the target directory
  const targetDir = contractPath;
  exploreDirectory(targetDir, files);


  // Split the RepositoryV1 folder into the metadata and sources the v2 API
  // expects. Sources live under sources/ there; the prefix is stripped so the
  // paths line up with the ones in metadata.
  let metadata
  const sources = {}
  for (const key of Object.keys(files)) {
    const relativePath = key.replace(targetDir, '').replace(/^\/+/, '')
    if (relativePath === 'metadata.json') {
      metadata = JSON.parse(files[key])
    } else {
      sources[relativePath.replace(/^sources\//, '')] = files[key]
    }
  }

  if (!metadata) {
    throw new Error(`No metadata.json found for ${address} in ${targetDir}`)
  }

  const { status } = await verifyFiles(address, chain, metadata, sources)

  console.log(status, address)
}

if (process.argv?.length < 5) {
  console.log("Provide all arguments")
  process.exit()
}

const args = process.argv.slice(2);

const contractPath = args[0]
const matchType = args[1]
const chainId = args[2]

if (!fs.existsSync(contractPath)) {
  console.log("Path doesn't exists")
  process.exit()
}

if (matchType !== "partial_match" && matchType !== "full_match") {
  console.log("matchType should be partial_match or full_match")
  process.exit()
}

const chainFolder = `${contractPath}/${matchType}/${chainId}/`
if (!fs.existsSync(chainFolder)) {
  console.log("chainId doesn't exists in repo")
  process.exit()
}

const contracts = await listFolders(chainFolder)

for (const contract of contracts) {
  await verifyContractInPath(contract, chainId, `${chainFolder}${contract}`)
}