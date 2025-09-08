import { whatsabi } from "@shazow/whatsabi";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { AbiCoder } from "ethers";

export type ProxyType =
  | "EIP1167Proxy"
  | "FixedProxy"
  | "EIP1967Proxy"
  | "GnosisSafeProxy"
  | "DiamondProxy"
  | "PROXIABLEProxy"
  | "ZeppelinOSProxy"
  | "SequenceWalletProxy";

export type Implementation = { address: string; name?: string };

export interface ProxyDetectionResult {
  isProxy: boolean;
  proxyType: ProxyType | null;
  implementations: Implementation[];
}

export async function detectAndResolveProxy(
  bytecode: string,
  address: string,
  sourcifyChain: SourcifyChain,
): Promise<ProxyDetectionResult> {
  // Pass our bytecode to whatsabi so it does not need to fetch it from an rpc
  const codeCache = {
    [address]: bytecode,
  };
  const cachedCodeProvider = whatsabi.providers.WithCachedCode(
    // This object mocks a provider as it is not needed for detection only
    {
      request: () => {},
    },
    codeCache,
  );

  // Detect proxies but skip other functionalities of whatsabi
  const detectionResult = await whatsabi.autoload(address, {
    provider: cachedCodeProvider,
    abiLoader: false,
    signatureLookup: false,
    followProxies: false,
  });

  // Ignore contracts that have CREATE opcodes as they could falsely be detected as proxies.
  if (detectionResult.isFactory) {
    return { isProxy: false, proxyType: null, implementations: [] };
  }

  const proxyResolvers = detectionResult.proxies;

  // In the following, we check the returned proxy resolvers
  // and resolve the implementation address for the first valid proxy resolver.
  // We first handle FixedProxies and DiamondProxies, as their implementations are resolved differently.
  // Most of the assumptions here are based on the proxy detection experiments in:
  // https://github.com/sourcifyeth/data-analysis-scripts

  const fixedProxy = proxyResolvers.find(
    (proxy) => proxy instanceof whatsabi.proxies.FixedProxyResolver,
  );
  // Only return EIP1167Proxies because whatsabi can falsely detect non-proxy contracts as FixedProxies (e.g. libraries)
  if (fixedProxy && isEIP1167Proxy(bytecode, fixedProxy["resolvedAddress"])) {
    return {
      isProxy: true,
      proxyType: "EIP1167Proxy",
      implementations: [{ address: fixedProxy["resolvedAddress"] }],
    };
  }

  if (
    proxyResolvers.some(
      (proxy) => proxy instanceof whatsabi.proxies.DiamondProxyResolver,
    )
  ) {
    try {
      // Call facetAddresses()
      const encodedFacets = await sourcifyChain.call({
        to: address,
        data: "0x52ef6b2c",
      });
      const facets = AbiCoder.defaultAbiCoder().decode(
        ["address[]"],
        encodedFacets,
      )[0];
      return {
        isProxy: true,
        proxyType: "DiamondProxy",
        implementations: facets.map((facet: string) => ({ address: facet })),
      };
    } catch (e) {
      // Falsely detected as a diamond proxy,
      // ignore and check if there are other proxy resolvers
    }
  }

  // In the following we check all remaining proxy types.
  // As whatsabi might return multiple instances of the same proxy resolver,
  // we keep track of the already checked proxy types to avoid unnecessary rpc calls.
  const checkedProxyTypes: Set<ProxyType> = new Set([
    "FixedProxy",
    "DiamondProxy",
  ]);
  for (const proxy of proxyResolvers) {
    if (checkedProxyTypes.has(proxy.name as ProxyType)) {
      continue;
    }

    // Tries to resolve the implementation address by querying a specific storage slot from the rpc.
    // The storage slot depends on the proxy type.
    const resolvedAddress = await proxy.resolve(sourcifyChain, address);
    if (resolvedAddress !== "0x0000000000000000000000000000000000000000") {
      return {
        isProxy: true,
        proxyType: proxy.name as ProxyType,
        implementations: [{ address: resolvedAddress }],
      };
    }

    checkedProxyTypes.add(proxy.name as ProxyType);
  }

  return { isProxy: false, proxyType: null, implementations: [] };
}

function isEIP1167Proxy(bytecode: string, resolvedAddress: string): boolean {
  return bytecode
    .toLowerCase()
    .endsWith(
      `363d3d373d3d3d363d73${resolvedAddress.slice(2)}5af43d82803e903d91602b57fd5bf3`,
    );
}
