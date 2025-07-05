import JSZip from 'jszip';
import { logDebug } from '../logger';
import { PathBuffer } from './ValidationTypes';

export async function unzipFiles(files: PathBuffer[]) {
  const allUnzipped: PathBuffer[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (isZip(file.buffer)) {
      logDebug('Unzipping file', {
        path: file.path,
        size: file.buffer.length,
        unzippedFilesCount: allUnzipped.length,
      });
      const unzipped = await unzip(file);
      allUnzipped.push(...unzipped);

      logDebug('Unzipped file', {
        path: file.path,
        size: file.buffer.length,
        unzippedFilesCount: allUnzipped.length,
      });
      // Remove the zip file from the array and decrement the index to check the next file.
      files.splice(i, 1);
      i--;
    }
  }
  // Add unzipped at the end to not check again if the extracted files are zips.
  files.push(...allUnzipped);
}

function isZip(file: Buffer): boolean {
  // How is-zip-file checks https://github.com/luthraG/is-zip-file/blob/master/index.js
  // Also according to this: https://stackoverflow.com/a/18194946/6528944
  const response =
    file[0] === 0x50 &&
    file[1] === 0x4b &&
    (file[2] === 0x03 || file[2] === 0x05 || file[2] === 0x07) &&
    (file[3] === 0x04 || file[3] === 0x06 || file[3] === 0x08);
  return response;
}

/**
 * Unzips the provided file buffer to the provided array.
 *
 * @param zippedFile the buffer containin the zipped file to be unpacked
 * @returns the unzipped files as an array
 */
async function unzip(zippedFile: PathBuffer) {
  const zip = new JSZip();
  const unzipped: PathBuffer[] = [];
  try {
    await zip.loadAsync(zippedFile.buffer);
    for (const filePath in zip.files) {
      const file = zip.files[filePath];
      if (file.dir) {
        continue;
      }
      // Exclude Mac specific files
      if (filePath.includes('__MACOSX')) {
        continue;
      }

      const buffer = await file.async('nodebuffer');
      unzipped.push({
        path: filePath,
        buffer,
      });
    }
  } catch (e: any) {
    throw new Error(`Error while unzipping ${zippedFile.path}: ${e.message}`);
  }
  return unzipped;
}
