import { expect } from 'chai';
import { unzipFiles } from '../../src/Validation/zipUtils';
import JSZip from 'jszip';
import { PathBuffer } from '../../src';

describe('zipUtils', () => {
  describe('isZip', () => {
    it('should identify valid ZIP files', async () => {
      // Create a simple ZIP file
      const zip = new JSZip();
      zip.file('test.txt', 'Hello World');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const files: PathBuffer[] = [
        {
          path: 'test.zip',
          buffer: zipBuffer,
        },
      ];

      // The unzipFiles function should process this as a ZIP
      await unzipFiles(files);

      // Original ZIP file should be removed and replaced with contents
      expect(files.length).to.equal(1);
      expect(files[0].path).to.equal('test.txt');
      expect(files[0].buffer.toString()).to.equal('Hello World');
    });

    it('should not process non-ZIP files', async () => {
      const nonZipBuffer = Buffer.from('This is not a ZIP file');
      const files: PathBuffer[] = [
        {
          path: 'test.txt',
          buffer: nonZipBuffer,
        },
      ];

      // The file should remain unchanged
      await unzipFiles(files);
      expect(files.length).to.equal(1);
      expect(files[0].path).to.equal('test.txt');
      expect(files[0].buffer.toString()).to.equal('This is not a ZIP file');
    });
  });

  describe('unzipFiles', () => {
    it('should handle multiple files in ZIP', async () => {
      const zip = new JSZip();
      zip.file('file1.txt', 'Content 1');
      zip.file('file2.txt', 'Content 2');
      zip.file('subfolder/file3.txt', 'Content 3');
      // write file
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const files: PathBuffer[] = [
        {
          path: 'test.zip',
          buffer: zipBuffer,
        },
      ];

      await unzipFiles(files);

      expect(files.length).to.equal(3);
      const paths = files.map((f) => f.path).sort();
      expect(paths).to.deep.equal([
        'file1.txt',
        'file2.txt',
        'subfolder/file3.txt',
      ]);

      const file1 = files.find((f) => f.path === 'file1.txt');
      expect(file1?.buffer.toString()).to.equal('Content 1');
    });

    it('should skip __MACOSX files', async () => {
      const zip = new JSZip();
      zip.file('file1.txt', 'Content 1');
      zip.file('__MACOSX/._file1.txt', 'Mac Resource Fork');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const files: PathBuffer[] = [
        {
          path: 'test.zip',
          buffer: zipBuffer,
        },
      ];

      await unzipFiles(files);

      expect(files.length).to.equal(1);
      expect(files[0].path).to.equal('file1.txt');
      expect(files[0].buffer.toString()).to.equal('Content 1');
    });

    it('should throw error for corrupted ZIP files', async () => {
      const corruptedZipBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]); // Invalid ZIP
      const files: PathBuffer[] = [
        {
          path: 'corrupted.zip',
          buffer: corruptedZipBuffer,
        },
      ];

      try {
        await unzipFiles(files);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Error while unzipping corrupted.zip');
      }
    });
  });
});
