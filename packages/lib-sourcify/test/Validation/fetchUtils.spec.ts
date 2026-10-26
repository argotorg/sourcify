import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import {
  performFetch,
  fetchWithBackoff,
  assertPublicUrl,
  dnsResolver,
  isPublicIpAddress,
} from '../../src/Validation/fetchUtils';
import { id as keccak256str } from 'ethers';

use(chaiAsPromised);

const PUBLIC_IP = '93.184.216.34';
const PRIVATE_IP = '172.17.0.1';

describe('fetchUtils', () => {
  let originalFetch: typeof fetch;
  let originalEnv: NodeJS.ProcessEnv;
  let lookupStub: sinon.SinonStub;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = process.env;
    process.env = { ...process.env };
    // Resolve every name to a public address unless a test says otherwise
    lookupStub = sinon
      .stub(dnsResolver, 'lookup')
      .resolves([{ address: PUBLIC_IP, family: 4 }] as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    sinon.restore();
  });

  describe('isPublicIpAddress', () => {
    it('accepts public addresses', () => {
      expect(isPublicIpAddress(PUBLIC_IP)).to.be.true;
      expect(isPublicIpAddress('2606:2800:220:1:248:1893:25c8:1946')).to.be
        .true;
    });

    it('rejects loopback, private, link-local and mapped addresses', () => {
      for (const address of [
        '127.0.0.1',
        '10.1.2.3',
        '172.17.0.1',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '0.0.0.0',
        '::1',
        '::',
        'fd00::1',
        'fe80::1',
        '::ffff:127.0.0.1',
        '::ffff:7f00:1',
        'not-an-ip',
      ]) {
        expect(isPublicIpAddress(address), address).to.be.false;
      }
    });
  });

  describe('assertPublicUrl', () => {
    it('accepts a public https host', async () => {
      const url = await assertPublicUrl('https://example.com/file.sol');
      expect(url.hostname).to.equal('example.com');
    });

    it('rejects private IP literals', async () => {
      for (const resource of [
        'http://127.0.0.1:8080/x',
        'http://172.17.0.1/private?x=github.com',
        'http://[::1]/x',
        'http://localhost/x',
      ]) {
        await expect(assertPublicUrl(resource), resource).to.be.rejectedWith(
          /non-public host/,
        );
      }
    });

    it('rejects a hostname that resolves to a private address', async () => {
      lookupStub.resolves([
        { address: PUBLIC_IP, family: 4 },
        { address: PRIVATE_IP, family: 4 },
      ] as any);
      await expect(assertPublicUrl('http://evil.example/x')).to.be.rejectedWith(
        /non-public host/,
      );
    });

    it('rejects non-http schemes and credentials', async () => {
      await expect(assertPublicUrl('file:///etc/passwd')).to.be.rejectedWith(
        /unsupported protocol/,
      );
      await expect(
        assertPublicUrl('https://user:pass@example.com/x'),
      ).to.be.rejectedWith(/credentials/);
      await expect(assertPublicUrl('not a url')).to.be.rejectedWith(
        /invalid URL/,
      );
    });
  });

  describe('performFetch', () => {
    it('should successfully fetch content', async () => {
      const content = 'test content';
      const hash = keccak256str(content);
      global.fetch = async () => new Response(content, { status: 200 });

      const result = await performFetch('https://test.com', hash, 'test.txt');
      expect(result).to.equal(content);
    });

    it('should return null if hash does not match', async () => {
      const content = 'test content';
      const wrongHash = keccak256str('wrong content');
      global.fetch = async () => new Response(content, { status: 200 });

      const result = await performFetch(
        'https://test.com',
        wrongHash,
        'test.txt',
      );
      expect(result).to.be.null;
    });

    it('should return null on failed fetch', async () => {
      global.fetch = async () => new Response('Not Found', { status: 404 });

      const result = await performFetch('https://test.com');
      expect(result).to.be.null;
    });

    it('should return null without fetching for a private host', async () => {
      const fetchSpy = sinon.spy(async () => new Response('secret'));
      global.fetch = fetchSpy as unknown as typeof fetch;

      const result = await performFetch('http://172.17.0.1/private');
      expect(result).to.be.null;
      expect(fetchSpy.called).to.be.false;
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

    it('does not retry a refused private host', async () => {
      const fetchSpy = sinon.spy(async () => new Response('x'));
      global.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        fetchWithBackoff('http://127.0.0.1/x', {}, 100, 3),
      ).to.be.rejectedWith(/non-public host/);
      expect(fetchSpy.called).to.be.false;
      expect(lookupStub.called).to.be.false;
    });

    it('allows a private host when explicitly permitted', async () => {
      global.fetch = async () => new Response('gateway', { status: 200 });

      const response = await fetchWithBackoff(
        'http://ipfs.internal:8080/ipfs/Qm',
        {},
        100,
        0,
        { allowPrivateHosts: true },
      );
      expect(await response.text()).to.equal('gateway');
      expect(lookupStub.called).to.be.false;
    });

    it('follows redirects to public hosts and checks every hop', async () => {
      const requested: string[] = [];
      global.fetch = (async (url: string, init?: RequestInit) => {
        requested.push(url);
        expect(init?.redirect).to.equal('manual');
        if (url === 'https://a.example/x') {
          return new Response(null, {
            status: 302,
            headers: { location: '/y' },
          });
        }
        if (url === 'https://a.example/y') {
          return new Response(null, {
            status: 301,
            headers: { location: 'https://b.example/z' },
          });
        }
        return new Response('final', { status: 200 });
      }) as unknown as typeof fetch;

      const response = await fetchWithBackoff(
        'https://a.example/x',
        {},
        100,
        0,
      );
      expect(await response.text()).to.equal('final');
      expect(requested).to.deep.equal([
        'https://a.example/x',
        'https://a.example/y',
        'https://b.example/z',
      ]);
      expect(lookupStub.callCount).to.equal(3);
    });

    it('refuses a redirect to a private host', async () => {
      const requested: string[] = [];
      global.fetch = (async (url: string) => {
        requested.push(url);
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data' },
        });
      }) as unknown as typeof fetch;

      await expect(
        fetchWithBackoff('https://a.example/x', {}, 100, 2),
      ).to.be.rejectedWith(/non-public host/);
      expect(requested).to.deep.equal(['https://a.example/x']);
    });

    it('gives up after too many redirects', async () => {
      global.fetch = (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://a.example/loop' },
        })) as unknown as typeof fetch;

      await expect(
        fetchWithBackoff('https://a.example/x', {}, 100, 0, {
          maxRedirects: 2,
        }),
      ).to.be.rejectedWith(/Too many redirects/);
    });

    it('aborts a response body that is too slow', async () => {
      global.fetch = (async (_url: string, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            // Drip one byte and never finish unless aborted
            return new Promise<void>((resolve, reject) => {
              controller.enqueue(new Uint8Array([0x20]));
              signal.addEventListener('abort', () =>
                reject(new Error('aborted')),
              );
              setTimeout(resolve, 10_000).unref();
            });
          },
        });
        return new Response(stream, { status: 200 });
      }) as unknown as typeof fetch;

      const response = await fetchWithBackoff(
        'https://a.example/slow',
        {},
        100,
        0,
        {
          bodyTimeout: 50,
        },
      );
      await expect(response.text()).to.be.rejected;
    });
  });
});
