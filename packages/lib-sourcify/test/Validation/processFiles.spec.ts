import { expect } from 'chai';
import { extractHardhatMetadataAndSources } from '../../src';
import fs from 'fs';
import path from 'path';

describe('processFiles', () => {
  it('Should extractHardhatMetadataAndSources', async function () {
    const hardhatOutputPath = path.join(
      __dirname,
      '../validationFiles/files/hardhat-output/output.json',
    );
    const hardhatOutput = await fs.promises.readFile(hardhatOutputPath, 'utf8');
    const pathContent = {
      path: hardhatOutputPath,
      content: hardhatOutput,
    };
    const { hardhatMetadataFiles, hardhatSourceFiles } =
      extractHardhatMetadataAndSources(pathContent);
    expect(hardhatMetadataFiles).lengthOf(6);
    expect(hardhatSourceFiles).lengthOf(6);
  });
});
