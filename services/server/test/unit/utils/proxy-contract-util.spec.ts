import chai from "chai";
import { detectAndResolveProxy } from "../../../src/server/services/utils/proxy-contract-util";
import sinon from "sinon";
import proxyBytecodes from "./proxy-bytecodes.json";
import { LOCAL_CHAINS } from "../../../src/sourcify-chains";

describe("proxy contract util", function () {
  const mockSourcifyChain = LOCAL_CHAINS[0];
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

  it("should detect EIP1167Proxy with appended immutable args (clone-with-immutable-args)", async function () {
    // "Clones with immutable args" (e.g. OpenZeppelin `Clones.cloneWithImmutableArgs`)
    // append per-clone argument bytes *after* the 45-byte EIP-1167 stub, so the
    // runtime does not *end* with the stub. Based on BSC (chain 56) contract
    // 0xa301f4151baa004979dfb2a8e25a236ff2cf4fa5.
    const result = await detectAndResolveProxy(
      proxyBytecodes.EIP1167ProxyWithImmutableArgs,
      "0x1234567890123456789012345678901234567890",
      mockSourcifyChain,
    );

    chai.expect(result).to.deep.equal({
      isProxy: true,
      proxyType: "EIP1167Proxy",
      implementations: [
        { address: "0x19570da7f9f41d7b406eb5942db28c0e7221eec6" },
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

  it("should detect MaticProxy (Polygon UpgradableProxy)", async function () {
    // Polygon's own proxy pattern stores the implementation at
    // keccak256("matic.network.proxy.implementation") instead of the EIP-1967 slot.
    // solc 0.6.6 does not fold the constant, so the hash never appears in the
    // bytecode; whatsabi finds it via the "matic.network.proxy.implementation"
    // string in the aux-data segment. Based on Polygon DAI (chain 137)
    // 0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063.
    mockSourcifyChain.getStorageAt = sandbox
      .stub()
      .resolves(
        "000000000000000000000000490e379c9cff64944be82b849f8fd5972c7999a7",
      );

    const result = await detectAndResolveProxy(
      proxyBytecodes.MaticProxy,
      "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
      mockSourcifyChain,
    );

    chai.expect(result).to.deep.equal({
      isProxy: true,
      proxyType: "MaticProxy",
      implementations: [
        { address: "0x490e379c9cff64944be82b849f8fd5972c7999a7" },
      ],
    });
  });

  it("should detect MaticProxy from creation bytecode (the path Sourcify uses)", async function () {
    // Sourcify passes creation bytecode preferentially. Its tail is constructor
    // args, not CBOR metadata, so this only works with the CBOR plausibility
    // guard added in whatsabi 0.28.0.
    mockSourcifyChain.getStorageAt = sandbox
      .stub()
      .resolves(
        "000000000000000000000000490e379c9cff64944be82b849f8fd5972c7999a7",
      );

    const result = await detectAndResolveProxy(
      proxyBytecodes.MaticProxyWithSlotOnlyInCreationCode,
      "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
      mockSourcifyChain,
    );

    chai.expect(result).to.deep.equal({
      isProxy: true,
      proxyType: "MaticProxy",
      implementations: [
        { address: "0x490e379c9cff64944be82b849f8fd5972c7999a7" },
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
