import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import {
  performFetch,
  fetchWithBackoff,
  getFetchableSourceUrl,
} from '../../src/Validation/fetchUtils';
import { id as keccak256str } from 'ethers';

const RAW =
  'https://raw.githubusercontent.com/test/repo/main/contracts/Storage.sol';

describe('fetchUtils', () => {
  let originalFetch: typeof fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = process.env;
    process.env = { ...process.env };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    sinon.restore();
  });

  describe('getFetchableSourceUrl', () => {
    it('rewrites a github.com file URL to raw.githubusercontent.com', () => {
      expect(
        getFetchableSourceUrl(
          'https://github.com/test/repo/blob/main/contracts/Storage.sol',
        ),
      ).to.equal(RAW);
      expect(
        getFetchableSourceUrl(
          'https://www.github.com/test/repo/blob/v1.0/a/b.sol',
        ),
      ).to.equal('https://raw.githubusercontent.com/test/repo/v1.0/a/b.sol');
    });

    it('accepts an allowlisted host as is, dropping query and fragment', () => {
      expect(getFetchableSourceUrl(`${RAW}?x=1#y`)).to.equal(RAW);
      expect(getFetchableSourceUrl(RAW.replace('https', 'http'))).to.equal(RAW);
    });

    it('returns null for everything else', () => {
      for (const fileName of [
        'contracts/Storage.sol',
        'github.com/test/repo/blob/main/Storage.sol',
        'https://github.com/test/repo/main/Storage.sol',
        'https://github.com/test/repo/src/Storage.sol',
        'https://notgithub.com/test/repo/blob/main/Storage.sol',
        'https://github.com.evil.example/test/repo/blob/main/Storage.sol',
        'https://github.com:8080/test/repo/blob/main/Storage.sol',
        'https://user:pw@github.com/test/repo/blob/main/Storage.sol',
        'http://172.17.0.1:9000/private-endpoint?x=github.com',
        'http://localhost/github.com/test/repo/blob/main/Storage.sol',
        'https://cdn.jsdelivr.net/npm/@openzeppelin/contracts/token/ERC20/ERC20.sol',
        'ftp://github.com/test/repo/blob/main/Storage.sol',
      ]) {
        expect(getFetchableSourceUrl(fileName), fileName).to.be.null;
      }
    });
  });

  describe('performFetch', () => {
    it('should successfully fetch content', async () => {
      const content = 'test content';
      const hash = keccak256str(content);
      global.fetch = async () => new Response(content, { status: 200 });

      const result = await performFetch(RAW, hash, 'test.txt');
      expect(result).to.equal(content);
    });

    it('should return null if hash does not match', async () => {
      const content = 'test content';
      const wrongHash = keccak256str('wrong content');
      global.fetch = async () => new Response(content, { status: 200 });

      const result = await performFetch(RAW, wrongHash, 'test.txt');
      expect(result).to.be.null;
    });

    it('should return null on failed fetch', async () => {
      global.fetch = async () => new Response('Not Found', { status: 404 });

      const result = await performFetch(RAW);
      expect(result).to.be.null;
    });

    it('refuses hosts that are not allowlisted without fetching', async () => {
      const fetchSpy = sinon.spy(async () => new Response('secret'));
      global.fetch = fetchSpy as unknown as typeof fetch;

      for (const url of [
        'http://172.17.0.1/private?x=github.com',
        'https://github.com/test/repo/blob/main/Storage.sol',
        'https://example.com/Storage.sol',
        'not a url',
      ]) {
        expect(await performFetch(url), url).to.be.null;
      }
      expect(fetchSpy.called).to.be.false;
    });

    it('allows any host and follows redirects when trusted', async () => {
      const fetchSpy = sinon.spy(async (_url: string, init?: RequestInit) => {
        expect(init?.redirect).to.equal('follow');
        return new Response('gateway', { status: 200 });
      });
      global.fetch = fetchSpy as unknown as typeof fetch;

      const result = await performFetch(
        'http://ipfs.internal:8080/ipfs/Qm',
        undefined,
        undefined,
        {},
        { trusted: true },
      );
      expect(result).to.equal('gateway');
      expect(fetchSpy.calledOnce).to.be.true;
    });

    it('does not follow redirects for allowlisted hosts', async () => {
      global.fetch = (async (_url: string, init?: RequestInit) => {
        expect(init?.redirect).to.equal('error');
        return new Response('ok', { status: 200 });
      }) as unknown as typeof fetch;

      expect(await performFetch(RAW)).to.equal('ok');
    });

    it('returns null when the body is larger than the limit', async () => {
      global.fetch = async () => new Response('x'.repeat(100), { status: 200 });

      expect(
        await performFetch(RAW, undefined, undefined, {}, { maxBodyBytes: 50 }),
      ).to.be.null;
      expect(
        await performFetch(
          RAW,
          undefined,
          undefined,
          {},
          { maxBodyBytes: 100 },
        ),
      ).to.equal('x'.repeat(100));
    });

    it('returns null when the body is too slow', async () => {
      global.fetch = (async () => {
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            // Drip one byte and then stall
            return new Promise<void>((resolve) => {
              controller.enqueue(new Uint8Array([0x20]));
              setTimeout(resolve, 10_000).unref();
            });
          },
        });
        return new Response(stream, { status: 200 });
      }) as unknown as typeof fetch;

      expect(
        await performFetch(RAW, undefined, undefined, {}, { bodyTimeout: 50 }),
      ).to.be.null;
    });
  });

  describe('fetchWithBackoff', () => {
    it('should succeed on first attempt', async () => {
      global.fetch = async () => new Response('success', { status: 200 });

      const response = await fetchWithBackoff('https://test.com');
      expect(response.status).to.equal(200);
      const text = await response.text();
      expect(text).to.equal('success');
    });

    it('should retry on failure and succeed eventually', async () => {
      let attempts = 0;
      global.fetch = async () => {
        attempts++;
        if (attempts < 2) throw new Error('Temporary failure');
        return new Response('success', { status: 200 });
      };

      const response = await fetchWithBackoff('https://test.com', {}, 100, 2);
      expect(response.status).to.equal(200);
      expect(attempts).to.equal(2);
    });

    it('should throw after max retries', async () => {
      global.fetch = async () => {
        throw new Error('Persistent failure');
      };

      try {
        await fetchWithBackoff('https://test.com', {}, 100, 2);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).to.include('Failed fetching');
      }
    });
  });
});
