import chai from "chai";
import { detectAndResolveProxy } from "../../../services/utils/proxy-contract-util";
import sinon from "sinon";
import proxyBytecodes from "./proxy-bytecodes.json";
import { loadConfig } from "../../../config/Loader";
import { Chain } from "../../../services/chain/Chain";
import { ChainMap } from "../../../server";

describe("proxy contract util", function () {
  const config = loadConfig()
  const chainMap: ChainMap  = {}
  for (const [_, chainObj] of Object.entries(config.chains)) {
    chainMap[chainObj.chainId.toString()]= new Chain(chainObj)
  }

  const mockSourcifyChain = chainMap[31337];
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it("should detect EIP1167Proxy", async function () {
    const result = await detectAndResolveProxy(
      proxyBytecodes.EIP1167Proxy,
      "0x1234567890123456789012345678901234567890",
      mockSourcifyChain,
    );

    chai.expect(result).to.deep.equal({
      isProxy: true,
      proxyType: "EIP1167Proxy",
      implementations: [
        { address: "0x9ec1c3dcf667f2035fb4cd2eb42a1566fd54d2b7" },
      ],
    });
  });

  it("should detect DiamondProxy", async function () {
    mockSourcifyChain.call = sandbox
      .stub()
      .resolves(
        "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000005000000000000000000000000798c3dfb0f66b7f6be23b1aef54f95a2c07ca82e000000000000000000000000f77c3c52b615a477dd434c876ab87a93736ed2540000000000000000000000003ba37715ee934cf160a5ed88d1b8c0cea6ea839f00000000000000000000000044a3f16cb323d54d393f06526d6e661fe9282cfa000000000000000000000000c965aef3625ad80873001d238eae5e5dfb93b529",
      );

    const result = await detectAndResolveProxy(
      proxyBytecodes.DiamondProxy,
      "0x00000AD847dc7b2F6c352dE22cAf2965bE5e29f6",
      mockSourcifyChain,
    );

    chai.expect(result).to.deep.equal({
      isProxy: true,
      proxyType: "DiamondProxy",
      implementations: [
        { address: "0x798c3DFb0F66B7f6be23B1aef54F95A2C07ca82E" },
        { address: "0xf77C3c52B615a477Dd434C876ab87A93736ed254" },
        { address: "0x3BA37715Ee934cf160A5ed88D1B8C0cea6Ea839F" },
        { address: "0x44A3F16cB323d54d393f06526D6E661FE9282CFA" },
        { address: "0xc965AeF3625ad80873001D238EaE5e5dfb93B529" },
      ],
    });
  });

  it("should detect EIP1967Proxy", async function () {
    mockSourcifyChain.getStorageAt = sandbox
      .stub()
      .resolves(
        "000000000000000000000000ac805a864be8b5c6727a7ecd502c287a20c91379",
      );

    const result = await detectAndResolveProxy(
      proxyBytecodes.EIP1967Proxy,
      "0x65C234D041F9ef96e2F126263727dfa582206d82",
      mockSourcifyChain,
    );

    chai.expect(result).to.deep.equal({
      isProxy: true,
      proxyType: "EIP1967Proxy",
      implementations: [
        { address: "0xac805a864be8b5c6727a7ecd502c287a20c91379" },
      ],
    });
  });

  it("should detect EIP1967Proxy when the storage slot is only referenced in the creation code", async function () {
    mockSourcifyChain.getStorageAt = sandbox
      .stub()
      .resolves(
        "000000000000000000000000ac805a864be8b5c6727a7ecd502c287a20c91379",
      );

    const result = await detectAndResolveProxy(
      proxyBytecodes.EIP1967ProxyWithSlotOnlyInCreationCode,
      "0x6f943318b05AD7c6EE596A220510A6D64B518dd8",
      mockSourcifyChain,
    );

    chai.expect(result).to.deep.equal({
      isProxy: true,
      proxyType: "EIP1967Proxy",
      implementations: [
        { address: "0xac805a864be8b5c6727a7ecd502c287a20c91379" },
      ],
    });
  });

  it("should return false for factories that deploy proxies", async function () {
    // Based on 0x7dB8637A5fd20BbDab1176BdF49C943A96F2E9c6 deployed on ETH Mainnet
    const result = await detectAndResolveProxy(
      proxyBytecodes.FactoryDeployingProxies,
      "0x7dB8637A5fd20BbDab1176BdF49C943A96F2E9c6",
      mockSourcifyChain,
    );

    chai.expect(result).to.deep.equal({
      isProxy: false,
      proxyType: null,
      implementations: [],
    });
  });

  it("should return false for non-proxy contracts", async function () {
    const result = await detectAndResolveProxy(
      proxyBytecodes.NoProxy,
      "0xd9145CCE52D386f254917e481eB44e9943F39138",
      mockSourcifyChain,
    );

    chai.expect(result).to.deep.equal({
      isProxy: false,
      proxyType: null,
      implementations: [],
    });
  });
});
