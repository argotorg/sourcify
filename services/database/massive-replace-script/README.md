# Massive Replace Script

This script allows you to call the `/private/replace-contract` endpoint for multiple contracts based on a configuration file.

## Environment Variables

Create a `.env` file or set the following environment variables:

```bash
# Database connection
POSTGRES_HOST=localhost
POSTGRES_DB=sourcify
POSTGRES_USER=sourcify
POSTGRES_PASSWORD=password
POSTGRES_PORT=5432
POSTGRES_SCHEMA=public

# API configuration
API_BASE_URL=http://localhost:5000
API_AUTH_TOKEN=your_bearer_token_here

# Script configuration
CONFIG_FILE_PATH=/path/to/your/config.js
CURRENT_VERIFIED_CONTRACT_PATH=/path/to/counter/directory
```

## Configuration File

The configuration file should export an object with the following structure:

```javascript
module.exports = {
  // Function that executes the query to extract affected contracts
  query: async (sourcePool, sourcifySchema, currentVerifiedContract, n) => {
    return await sourcePool.query(
      `
      SELECT 
          cd.chain_id,
          cd.address,
          cd.transaction_hash,
          -- other fields as needed
          vc.id as verified_contract_id
      FROM ${sourcifySchema}.contract_deployments cd
      -- your joins and conditions
      WHERE vc.id >= $1
      ORDER BY vc.id ASC
      LIMIT $2
    `,
      [currentVerifiedContract, n],
    );
  },

  // The customReplaceMethod to use in the API call
  customReplaceMethod: "replace-creation-information",

  // Optional description
  description: "Description of what this configuration does",
};
```

## Usage

1. Set up your environment variables
2. Choose or create a configuration file
3. Run the script from the database service directory:

```bash
cd services/database
CONFIG_FILE_PATH=./config-replace-creation-information.js npm run massive-replace
```

## How It Works

1. The script loads the configuration file specified by `CONFIG_FILE_PATH`
2. It connects to the database using the provided credentials
3. It runs the configured query to get batches of contracts (200 at a time by default)
4. For each contract, it calls the `/private/replace-contract` API endpoint
5. It tracks progress using a counter file in `CURRENT_VERIFIED_CONTRACT_PATH`
6. The script continues until no more contracts are found
