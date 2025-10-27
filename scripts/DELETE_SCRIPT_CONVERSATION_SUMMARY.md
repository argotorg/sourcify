# Delete Sourcify Match Script - Development Conversation Summary

## Initial Requirements

**Task**: Create a TypeScript script that deletes a `sourcify_match` entry and all its referenced rows from the database.

**Input**: Chain ID and contract address (not sourcify_match ID directly)

**Key Requirements**:
1. Query `sourcify_match` from chain_id and address
2. Delete referenced rows with proper reference counting
3. For `sources` and `signatures`: only delete if not referenced by other contracts
4. Delete `verification_jobs` entries
5. Use TypeScript
6. Follow patterns from `Database.ts`

## Development Journey

### 1. Understanding the Schema

First, we analyzed the database schema from `sourcify-database.sql` to understand relationships:

- `sourcify_matches` → `verified_contracts` (via `verified_contract_id`)
- `verified_contracts` → `contract_deployments` (via `deployment_id`)
- `verified_contracts` → `compiled_contracts` (via `compilation_id`)
- `compiled_contracts` → `compiled_contracts_sources` → `sources`
- `compiled_contracts` → `compiled_contracts_signatures` → `signatures`
- `compiled_contracts` → `code` (via code hashes)
- `contract_deployments` → `contracts` (via `contract_id`)
- `contracts` → `code` (via code hashes)
- `verification_jobs` → `verified_contracts`
- `verification_jobs_ephemeral` → `verification_jobs`

### 2. Initial Script Creation

Created a comprehensive deletion script with:
- Transaction-based operations (BEGIN/COMMIT/ROLLBACK)
- Reference counting for shared resources
- Detailed logging and progress indicators
- Summary statistics at the end

### 3. Key Refinements

#### Type Corrections
- **Issue**: PostgreSQL's `bigint` returns as string in node-postgres
- **Fix**: Changed `sourcifyMatchId` and `verifiedContractId` types from `number` to `string`

#### Environment Configuration
- **Change**: Modified to use `scripts/.env` first, with fallback to `services/server/.env`
- **Created**: `scripts/.env.example` for documentation
- **Note**: `.gitignore` already protects `.env` files

#### Edge Case: Multiple Verified Contracts
- **Discovery**: Multiple `verified_contracts` can exist for same chain_id + address
- **Initially**: Script assumed one sourcify_match per address
- **Reality**: Each `verified_contract` has at most one `sourcify_match`
- **Fix**: Changed to find all verified_contracts first, then delete their sourcify_matches if they exist

#### Query Structure Change
- **Problem**: Initial query did `LEFT JOIN sourcify_matches` but table might not exist
- **Solution**:
  1. Query only `verified_contracts` initially (no JOIN to sourcify_matches)
  2. Check if `sourcify_matches` table exists
  3. Query for sourcify_match_ids separately when deleting (step 3)

#### Optional Tables Support
Added checks for optional tables:
- `verification_jobs` and `verification_jobs_ephemeral`
- `sourcify_matches`

Script gracefully skips deletion if these tables don't exist.

#### Verification Jobs Ephemeral
- **Discovery**: `verification_jobs_ephemeral` table also needs deletion
- **Fix**: Added loop to delete from ephemeral table first (before parent deletion)
- **Note**: Has `ON DELETE CASCADE` but we delete explicitly for clarity

#### Data Error Check Removal
- **Initial**: Had validation that verified_contracts aren't referenced by other sourcify_matches
- **Decision**: Removed this check as it wasn't needed
- **Result**: Simplified script from 14 steps to 12 steps

#### Warning Logging
- **Enhancement**: Added else clause to log warning if `compiled_contract` not found when retrieving code hashes
- **Purpose**: Helps identify data inconsistencies during debugging

### 4. Final Script Structure

**File**: `scripts/delete-sourcify-match.ts`

**Steps**:
1. Find all verified_contracts for chain_id + address
2. Delete verification_jobs (if table exists)
3. Delete sourcify_matches (if table exists)
4. Delete verified_contracts
5. Get code hashes from compiled_contracts
6. Delete compiled_contracts_sources + orphaned sources
7. Delete compiled_contracts_signatures + orphaned signatures
8. Delete compiled_contracts (if not referenced)
9. Get code hashes from contracts
10. Delete contract_deployments (if not referenced)
11. Delete contracts (if not referenced)
12. Delete orphaned code entries

**Features**:
- ✅ Transaction safety (full rollback on error)
- ✅ Reference counting (only deletes orphaned resources)
- ✅ Optional table support
- ✅ Multiple verified_contracts per address
- ✅ Detailed logging and progress indicators
- ✅ Comprehensive summary report
- ✅ Type-safe with proper TypeScript types
- ✅ Buffer handling for bytea columns
- ✅ snake_case matching SQL column names

### 5. Supporting Files Created

1. **`scripts/.env.example`**
   - Template for environment variables
   - Documents required database connection settings

2. **`scripts/delete-sourcify-match.README.md`**
   - Comprehensive documentation
   - Usage instructions
   - Safety features explanation
   - Troubleshooting guide
   - Development notes

3. **`scripts/DELETE_SCRIPT_CONVERSATION_SUMMARY.md`** (this file)
   - Complete conversation summary
   - Development journey
   - All design decisions and changes

## Key Design Decisions

### 1. Transaction-Based Approach
**Why**: Ensures atomicity - either everything succeeds or nothing changes
**Implementation**: PostgreSQL `BEGIN`/`COMMIT`/`ROLLBACK`

### 2. Reference Counting
**Why**: Prevent deletion of shared resources still in use
**Implementation**: Check COUNT(*) before deleting sources, signatures, code, etc.

### 3. Optional Table Support
**Why**: Work with different database schema versions (legacy/new)
**Implementation**: Check `information_schema.tables` before operations

### 4. Query Structure (No Early JOIN)
**Why**: Avoid querying tables that might not exist
**Implementation**: Query verified_contracts first, check tables, then query matches

### 5. Snake Case in Interfaces
**Why**: Match PostgreSQL column naming directly
**Alternative Considered**: camelCase with mapping - rejected for simplicity

### 6. Set<string> for Unique IDs
**Why**: Avoid redundant deletions when multiple verified_contracts share resources
**Implementation**: Collect unique compilation_ids, deployment_ids, etc.

### 7. Buffer Type for Bytea
**Why**: PostgreSQL bytea columns return as Buffer in node-postgres
**Implementation**: Use Buffer.from() and Buffer types throughout

## Testing Considerations

The script should be tested with:

1. **Single verified_contract with sourcify_match**
2. **Multiple verified_contracts with different sourcify_matches**
3. **Verified_contracts without sourcify_matches**
4. **Database without sourcify_matches table**
5. **Database without verification_jobs tables**
6. **Shared resources** (same source/signature used by multiple contracts)
7. **Orphaned resources** (sources/signatures not used by any other contract)

## Potential Future Enhancements

1. **Dry-run mode**: Show what would be deleted without actually deleting
2. **Confirmation prompt**: Ask user to confirm before deletion
3. **Backup option**: Create backup before deletion
4. **Batch deletion**: Accept multiple chain_id + address pairs
5. **JSON output**: Machine-readable summary for automation
6. **Performance metrics**: Time taken for each step

## Lessons Learned

1. **PostgreSQL types matter**: bigint returns as string in node-postgres
2. **Table existence checks**: Important for flexible schema support
3. **LEFT JOIN caution**: Can fail if joined table doesn't exist
4. **Reference integrity**: Always check references before cascading deletes
5. **Transaction scope**: Keep all operations in single transaction for atomicity
6. **Clear logging**: Essential for debugging and user confidence
7. **Edge cases**: Real-world data can have unexpected patterns (multiple verified_contracts)

## Command Examples

```bash
# Setup
cd /home/manuel/Projects/sourcify/sourcify/scripts
cp .env.example .env
# Edit .env with your database credentials

# Run script
npx tsx delete-sourcify-match.ts 1 0x1234567890123456789012345678901234567890

# Expected output:
# - Progress messages with ✓/⊘/⚠️ indicators
# - Final summary with deletion counts
# - Success or error message
```

## Files Modified/Created

### Created:
- `/scripts/delete-sourcify-match.ts` - Main deletion script
- `/scripts/.env.example` - Environment variables template
- `/scripts/delete-sourcify-match.README.md` - User documentation
- `/scripts/DELETE_SCRIPT_CONVERSATION_SUMMARY.md` - This summary

### Referenced:
- `/services/database/sourcify-database.sql` - Schema reference
- `/services/server/src/server/services/utils/Database.ts` - Query patterns
- `/services/server/src/server/services/utils/database-util.ts` - Type definitions
- `.gitignore` - Already includes `**/.env`

## Conclusion

Created a robust, production-ready script for deleting verified contracts and their dependencies from the Sourcify database. The script handles edge cases, optional tables, shared resources, and provides comprehensive feedback to users. All operations are transaction-safe with proper reference counting to prevent orphaned or incorrectly deleted data.
