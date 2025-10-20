import { expect } from "chai";
import { FourByteServerFixture } from "../helpers/FourByteServerFixture";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { id as keccak256str } from "ethers";

// This is to test if the signature text parsing works properly for complex and long signatures
describe("Bulk Long Signatures Import", function () {
  const serverFixture = new FourByteServerFixture();
  const baseUrl = `http://localhost:${serverFixture.port}`;

  interface CsvRow {
    signature: string;
    length: string;
    signature_hash_32: string;
  }

  let csvData: CsvRow[];

  before(async function () {
    // Read and parse the CSV file
    const csvPath = path.join(__dirname, "bulkLongSignatures.csv");
    const csvContent = fs.readFileSync(csvPath, "utf-8");
    csvData = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    }) as CsvRow[];

    console.log(`Loaded ${csvData.length} signatures from CSV`);
  });

  it("should successfully import all long signatures from CSV in chunks of 100 with correct hashes", async function () {
    const chunkSize = 100;
    let totalImported = 0;
    let totalDuplicates = 0;
    let totalInvalid = 0;

    // Process CSV data in chunks of 100
    for (let i = 0; i < csvData.length; i += chunkSize) {
      const chunk = csvData.slice(i, i + chunkSize);
      const signatures = chunk.map((row) => row.signature);

      console.log(
        `Processing chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(csvData.length / chunkSize)} (${signatures.length} signatures)`,
      );

      // Send bulk import request for this chunk
      const response = await fetch(`${baseUrl}/signature-database/v1/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          function: signatures,
          event: [],
        }),
      });

      expect(response.status).to.equal(200);
      const result = await response.json();

      // Extract counts from the nested structure
      const chunkImported = Object.keys(result.result.function.imported).length;
      const chunkDuplicates = Object.keys(
        result.result.function.duplicated,
      ).length;
      const chunkInvalid = result.result.function.invalid.length;

      totalImported += chunkImported;
      totalDuplicates += chunkDuplicates;
      totalInvalid += chunkInvalid;

      // Verify all signatures in this chunk were processed
      expect(chunkImported + chunkDuplicates + chunkInvalid).to.equal(
        chunk.length,
      );
      expect(chunkInvalid).to.equal(0);

      // Verify hash calculation for this chunk
      for (const row of chunk) {
        const expectedHash = row.signature_hash_32.toLowerCase();
        const calculatedHash = keccak256str(row.signature).toLowerCase();

        expect(calculatedHash).to.equal(
          expectedHash,
          `Hash mismatch for signature "${row.signature}": expected ${expectedHash}, got ${calculatedHash}`,
        );
      }
    }

    console.log(
      `Total results: ${totalImported} imported, ${totalDuplicates} duplicates, ${totalInvalid} invalid`,
    );

    // Verify all signatures were processed
    expect(totalImported + totalDuplicates).to.equal(csvData.length);
    expect(totalInvalid).to.equal(0);

    for (const row of csvData) {
      const expectedHash = row.signature_hash_32.toLowerCase();

      // Verify the signature can be found in the database
      const lookupResponse = await fetch(
        `${baseUrl}/signature-database/v1/lookup?function=${expectedHash.slice(0, 10)}`,
      );
      expect(lookupResponse.status).to.equal(200);

      const lookupResult = await lookupResponse.json();
      const hash4 = expectedHash.slice(2, 10);
      expect(
        lookupResult.result.function[`0x${hash4}`],
      ).to.have.length.greaterThan(0);

      // Find our specific signature in the results
      const foundSignature = lookupResult.result.function[`0x${hash4}`].find(
        (result: any) => result.name === row.signature,
      );
      expect(foundSignature).to.exist;
    }
  });
});
