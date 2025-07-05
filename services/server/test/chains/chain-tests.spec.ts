import { ServerFixture } from "../helpers/ServerFixture";
import chai from "chai";
import chaiHttp from "chai-http";
import fs from "fs";
import path from "path";
import addContext from "mochawesome/addContext";
import { assertVerification } from "../helpers/assertions";
import testEtherscanContracts from "../helpers/etherscanInstanceContracts.json";
import type {
  SourcifyChain,
  VerificationStatus,
} from "@ethereum-sourcify/lib-sourcify";
import config from "config";
// @ts-ignore
config["session"].storeType = "memory";

type ChainApiResponse = Pick<
  SourcifyChain,
  "name" | "title" | "chainId" | "rpc" | "supported"
> & { etherscanAPI: boolean };

const TEST_TIME = process.env.TEST_TIME || "60000"; // 30 seconds
const CUSTOM_PORT = 5556;

// Extract the chainId from new chain support pull request, if exists
let newAddedChainIds: string[] = [];
if (process.env.NEW_CHAIN_ID) {
  newAddedChainIds = process.env.NEW_CHAIN_ID.split(",");
}
console.log("newAddedChainIds");
console.log(newAddedChainIds);

let anyTestsPass = false; // Fail when zero tests passing

chai.use(chaiHttp);

describe("Test Supported Chains", function () {
  console.log(
    `Set up tests timeout with ${Math.floor(parseInt(TEST_TIME) / 1000)} secs`,
  );
  this.timeout(TEST_TIME);
  const serverFixture = new ServerFixture({
    port: CUSTOM_PORT,
  });

  const testedChains = new Set(); // Track tested chains and make sure all "supported = true" chains are tested
  let supportedChains: ChainApiResponse[];
  before(async function () {
    chai
      .request(serverFixture.server.app)
      .get("/chains")
      .end((err, res) => {
        if (err !== null) {
          throw new Error("Cannot fetch supportedChains");
        }
        supportedChains = res.body.filter(
          (chain: ChainApiResponse) => chain.supported,
        );
      });
  });

  after(() => {
    if (!anyTestsPass && newAddedChainIds.length) {
      throw new Error(
        "There needs to be at least one passing test. Did you forget to add a test for your new chain with the id(s) " +
          newAddedChainIds.join(",") +
          "?",
      );
    }
  });
  // exSat Mainnet
  verifyContract(
    "0xb0A32eBb9CD221d2FD91149195d87bE97552A90c",
    "7200",
    "exSat Mainnet",
    "shared/",
  );
  // exSat Testnet
  verifyContract(
    "0xb0A32eBb9CD221d2FD91149195d87bE97552A90c",
    "839999",
    "exSat Testnet",
    "shared/",
  );
  // Taraxa Mainnet
  verifyContract(
    "0xDDb119FaD25d6320c62A205A8d74ae9895E822EA",
    "841",
    "Taraxa Mainnet",
    "shared/",
  );
  // // Taraxa Testnet
  // verifyContract(
  //   "0x98edEa58C0500287B973348ec315f3d26D0e189A",
  //   "842",
  //   "Taraxa Testnet",
  //   "shared/",
  // );

  // Symplexia Smart Chain
  verifyContract(
    "0x968fd0BADc643B0A7b088f4b6aA2CE5FA65db622",
    "1149",
    "Symplexia Smart Chain",
    "shared/",
  );

  verifyContract(
    "0x801f3983c7baBF5E6ae192c84E1257844aDb4b4D",
    "1",
    "Ethereum Mainnet",
    "1",
  );

  // verifyContract(
  //   "0x1EFFEbE8B0bc20f2Dc504AA16dC76FF1AB2297A3",
  //   "4",
  //   "Rinkeby",
  //   "shared/"
  //
  // );

  // verifyContract(
  //   "0xc24381dB2a5932B5D1c424f567A95F9966834cE0",
  //   "5",
  //   "Goerli",
  //   "shared/"
  // );

  // // Ethereum Mekong Testnet
  // verifyContract(
  //   "0x247a8A599c99336dF37af1975661b32f7A26a88E",
  //   "7078815900",
  //   "Ethereum Mekong Testnet",
  //   "shared/",
  // );

  verifyContract(
    "0x7ecedB5ca848e695ee8aB33cce9Ad1E1fe7865F8",
    "17000",
    "Holesky",
    "shared/",
  );

  verifyContract(
    "0x8F78b9c92a68DdF719849a40702cFBfa4EB60dD0",
    "11155111",
    "Sepolia",
    "shared/",
  );

  verifyContract(
    "0x247a8A599c99336dF37af1975661b32f7A26a88E",
    "560048",
    "Ethereum Hoodi Testnet",
    "shared/",
  );

  verifyContract(
    "0x43C0A11653F57a96d1d3b6A5A6be453444558A5E",
    "369",
    "PulseChain",
    "shared/",
  );

  verifyContract(
    "0x7f185202a630F09e05b6C2b51618b4f6Af728c7B",
    "100",
    "xDai",
    "100",
  );

  // verifyContract(
  //   "0x2e4088DcA1aE2e098e322562ab1fEb83b3a303CD",
  //   "300",
  //   "Optimism on Gnosis",
  //   "shared/"
  //
  // );
  verifyContract(
    "0xbe4e03bebf828c8b7104841096a2ef19e587ae1d",
    "50",
    "XDC Network",
    "shared/",
  );

  verifyContract(
    "0x1eb067d61e9cf30ede5190ddde2f4096c6417ec1",
    "51",
    "XDC Apothem Testnet",
    "shared/",
  );

  verifyContract(
    "0xED5405Ba038587c06979374f8a595F41F5841216",
    "56",
    "Binance Smart Chain Mainnet",
    "56/",
  );

  verifyContract(
    "0x7a57a7117cD525c217AC09113A38E9362A092A0E",
    "2020",
    "Ronin Mainnet",
    "shared/",
  );

  verifyContract(
    "0x8F78b9c92a68DdF719849a40702cFBfa4EB60dD0",
    "44787",
    "Celo Alfajores Testnet",
    "shared/",
  );

  verifyContract(
    "0xd46fd24ea21F04459407Fb0B518451e54d0b07a1",
    "97",
    "Binance Smart Chain Testnet",
    "shared/",
  );

  verifyContract(
    "0x9969150c2AA0140F5109Ae29A51FA109Fe1d1d9C",
    "137",
    "Polygon (Matic)",
    "137/",
  );

  // verifyContract(
  //   "0x5D40b45C202531d040e0CCD51C48554109197cD3",
  //   "80001",
  //   "Polygon Mumbai Testnet",
  //   "shared/"
  // );

  verifyContract(
    "0x03943C3ef00d92e130185CeBC0bcc435Def2cC94",
    "42220",
    "Celo Mainnet",
    "42220/",
  );

  verifyContract(
    "0xdd5FFA1DF887D5A42931a746BaAd62574501A5Aa",
    "62320",
    "Celo Baklava Testnet",
    "62320/",
  );

  verifyContract(
    "0x03943C3ef00d92e130185CeBC0bcc435Def2cC94",
    "43114",
    "Avalanche Mainnet",
    "42220/",
  );

  verifyContract(
    "0x35C671Ea8e4Fd1e922157D48EABD5ab6b8CC408E",
    "43113",
    "Avalanche Fuji Testnet",
    "shared/",
  );

  verifyContract(
    "0x54Add02fC1664435c38BA49e5553F5952F777bD9",
    "216",
    "Happychain Testnet",
    "shared/",
  );

  verifyContract(
    "0x8F78b9c92a68DdF719849a40702cFBfa4EB60dD0",
    "41",
    "Telos EVM Testnet",
    "shared/",
  );

  verifyContract(
    "0x059611daEdBA5Fe0875aC7c76d7cE47FfE5c39C5",
    "40",
    "Telos EVM Mainnet",
    "40/",
  );

  // verifyContract(
  //   "0x68107Fb54f5f29D8e0B3Ac44a99f4444D1F22a68",
  //   "77",
  //   "Sokol",
  //   "shared/"
  //
  // );

  verifyContract(
    "0x0e9b6C08Fe70Aac8fd08a74a076c2B1C9f7c7d14",
    "42161",
    "Arbitrum Mainnet",
    "42161/",
  );

  // verifyContract(
  //   "0xd46fd24ea21F04459407Fb0B518451e54d0b07a1",
  //   "421613",
  //   "Arbitrum Görli",
  //   "shared/"
  //
  // );

  verifyContract(
    "0xaBe8cf2Dacb0053C1ebd5881392BD17Ec2402a4F",
    "421614",
    "Arbitrum Sepolia",
    "shared/",
  );

  verifyContract(
    "0x34626f85F7Ff1B8546E3d0A2b3c84B9e0aA44dCF",
    "37714555429",
    "Xai Testnet",
    "shared/",
  );

  verifyContract(
    "0x46151F59ED4d2021E3946B1d8Ab75780A1FDA2c6",
    "660279",
    "Xai Mainnet",
    "shared/",
  );

  verifyContract(
    "0xA25b72DADEB96E166D1a225C61b54CA29C45EBD1",
    "8",
    "Ubiq",
    "8/",
  );

  // Oneledger
  verifyContract(
    "0x774081ECDDb30F96EB5Bb21DcAB17C73F29f5eF3",
    "311752642",
    "OneLedger Mainnet",
    "shared/",
  );

  // verifyContract(
  //   "0x34eC0cBd5E33e7323324333434fe978f1000d9cd",
  //   "4216137055",
  //   "OneLedger Frankenstein Testnet",
  //   ["4216137055/SigmaToken.sol"],
  //   "4216137055/SigmaToken.json"
  // );

  // Has contracts to be fetched from IPFS
  verifyContract(
    "0xB2d0641fc8863514B6533b129fD744200eE17D29",
    "57",
    "Syscoin Mainnet",
    "57/",
  );

  // Has contracts to be fetched from IPFS
  verifyContract(
    "0x68107Fb54f5f29D8e0B3Ac44a99f4444D1F22a68",
    "5700",
    "Syscoin Tanenbaum Testnet",
    "shared/",
  );

  // Rollux Mainnet
  // verifyContract(
  //   "0x1187124eC74e2A2F420540C338186dD702cF6340",
  //   "570",
  //   "Rollux Mainnet",
  //   "shared/",
  // );

  // Rollux Tanenbaum (testnet)
  // verifyContract(
  //   "0x736bfcA6a599bF0C3D499F8a0bC5ab2bA2030AC6",
  //   "57000",
  //   "Rollux Tanenbaum",
  //   "shared/",
  // );

  verifyContract(
    "0xE295aD71242373C37C5FdA7B57F26f9eA1088AFe",
    "10",
    "Optimism Mainnet",
    "10/",
  );

  // verifyContract(
  //   "0xB5FAD02EbF6edffbdf206d2C1ad815bcDdb380f8",
  //   "420",
  //   "Optimism Goerli Testnet",
  //   "shared/"
  //
  // );

  verifyContract(
    "0xaBe8cf2Dacb0053C1ebd5881392BD17Ec2402a4F",
    "11155420",
    "Optimism Sepolia Testnet",
    "shared/",
  );

  verifyContract(
    "0x43f980475B9eb5D93A19dfA84511ECE7b330c226",
    "288",
    "Boba Network",
    "288/",
  );

  // verifyContract(
  //   "0x8F78b9c92a68DdF719849a40702cFBfa4EB60dD0",
  //   "28",
  //   "Boba Network Rinkeby Testnet",
  //   "shared/"
  //
  // );

  verifyContract(
    "0xd8A08AFf1B0585Cad0E173Ce0E93551Ac59D3530",
    "106",
    "Velas Mainnet",
    "106/",
  );

  verifyContract(
    "0x084c77e84853B960aEB0a0BD4Fc6689aC9c6d76E",
    "82",
    "Meter Mainnet",
    "82/",
  );

  verifyContract(
    "0x736D468Bc8F868a80A0F9C4Ca24dacf8a5A3a684",
    "83",
    "Meter Testnet",
    "shared/",
  );

  verifyContract(
    "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
    "1313161554",
    "Aurora Mainnet",
    "1313161554/",
  );

  verifyContract(
    "0xd46fd24ea21F04459407Fb0B518451e54d0b07a1",
    "1313161555",
    "Aurora Testnet",
    "shared/",
  );

  verifyContract(
    "0xc975C9C57641E6Ac3ca32c1ceaE9A88135Fe9C30",
    "5845",
    "Tangle",
    "shared/",
  );

  verifyContract(
    "0x08BB0D7fCe37dD766d13DC19A00c95878ed2E68c",
    "1284",
    "Moonbeam",
    "incrementer/",
  );
  verifyContract(
    "0x460947bD434b4FF90Af62f3F389b39aab0d6A77D",
    "1285",
    "Moonriver",
    "incrementer/",
  );
  verifyContract(
    "0x08BB0D7fCe37dD766d13DC19A00c95878ed2E68c",
    "1287",
    "Moonbase",
    "incrementer/",
  );

  // // Candle
  // verifyContract(
  //   "0xaa80bC172F3275B837C0515d3d50AcC4EC0cC96b",
  //   "534",
  //   "Candle Mainnet",
  //   "shared/"
  //
  // );

  // Palm
  verifyContract(
    "0xd46fd24ea21F04459407Fb0B518451e54d0b07a1",
    "11297108109",
    "Palm Mainnet",
    "shared/",
  );

  // Palm Testnet
  verifyContract(
    "0x68107Fb54f5f29D8e0B3Ac44a99f4444D1F22a68",
    "11297108099",
    "Palm Testnet",
    "shared/",
  );

  // Fuse Mainnet
  verifyContract(
    "0xCaFC1F87E4cabD59fAB26d02D09207147Aae3F1E",
    "122",
    "Fuse Mainnet",
    "shared/",
  );

  // // Darwinia Pangolin Testnet
  // verifyContract(
  //   "0x7de04a7596958D44baB52F4e5D0c9e79cB16ef8B",
  //   "43",
  //   "Darwinia Pangolin Testnet",
  //   "shared/"
  //
  // );

  // Crab Mainnet
  verifyContract(
    "0x2369ccbde92c65986ec708ae293a5df6c7148ec9",
    "44",
    "Crab Mainnet",
    "shared/",
  );

  // Darwinia mainnet
  verifyContract(
    "0x572059a7947727f3d093dac66a00c77ed4ea77d4",
    "46",
    "Darwinia Mainnet",
    "shared/",
  );

  // Evmos Testnet
  verifyContract(
    "0x07Eb2490cEfc74bAEb4B13c2dB9119CA0c38959B",
    "9000",
    "Evmos Testnet",
    "shared/",
  );

  // Evmos Mainnet
  verifyContract(
    "0x1d897A65A4fa98BBdfc2e94ad2357cE051Bf4a21",
    "9001",
    "Evmos Mainnet",
    "shared/",
  );

  // MultiVAC Mainnet
  verifyContract(
    "0x411925A3B2Ed99cD29DF76822D6419163d80858f",
    "62621",
    "MultiVAC Mainnet",
    "shared/",
  );

  // WAGMI Testnet
  // verifyContract(
  //   "0x5974BF3196fc03A20cEB196270307707e0158BbD",
  //   "11111",
  //   "WAGMI",
  //   "shared/",
  // );

  // // Gather Mainnet
  // verifyContract(
  //   "0x5b470D7B8165D109E3Fd2e2B4E7a30Cb89C051e5",
  //   "192837465",
  //   "GTH",
  //   "shared/",
  // );

  // // Gather Testnet
  // verifyContract(
  //   "0x08Da5501c22AE1ce2621724Ca1A03383d6C12c4d",
  //   "356256156",
  //   "GTH",
  //   "shared/"
  // );

  // // Gather Devnet
  // verifyContract(
  //   "0xEeE72e2295E181BaB1ef049bFEAaf5fC348998C5",
  //   "486217935",
  //   "GTH",
  //   "shared/"
  //
  // );

  // DFK Chain Testnet
  verifyContract(
    "0x276946F2453538E882281d5A36ad6d19BBDfdaA7",
    "335",
    "DFK Chain Testnet",
    "shared/",
  );

  // DFK Chain Mainnet
  verifyContract(
    "0xB98EBF39148D39536C7f312E059990Dc59Aa26B5",
    "53935",
    "DFK Chain",
    "shared/",
  );
  verifyContract(
    "0xA3b8eB7A6C4EE5902Ef66d455da98973B55B9f8a",
    "9996",
    "Mind Smart Chain Mainnet",
    "shared/",
  );
  // verifyContract(
  //   "0x6720b7a5974373C3F6bdE96c09bA4ffdddEEAeD7",
  //   "9977",
  //   "Mind Smart Chain Testnet",
  //   "shared/",
  // );
  // Energy Web Volta Testnet
  verifyContract(
    "0x4667b7ce62e56B71146885555c68d2DDdf63349A",
    "73799",
    "Energy Web Volta Testnet",
    "shared/",
  );

  // Energy Web Chain
  verifyContract(
    "0xd07BECd1b2FE97924a2d4A0cF2d96e499ce28cA9",
    "246",
    "Energy Web Chain",
    "shared/",
  );

  // Godwoken testnet v1.1
  verifyContract(
    "0xc8D69B4D58bb79D03C0b83DbBAE509DAF3135e74",
    "71401",
    "Godwoken Testnet (V1.1)",
    "shared/",
  );

  // Godwoken mainnet v1.1
  verifyContract(
    "0x0aEF0854bCD792cb37FA0e75c27a1bC326d11725",
    "71402",
    "Godwoken Mainnet",
    "shared/",
  );

  // Dexalot Testnet
  verifyContract(
    "0xfa5a1E7788514Ae2B879377cF08a9CF2901d3A21",
    "432201",
    "Dexalot Testnet",
    "shared/",
  );

  // Dexalot Mainnet
  verifyContract(
    "0x1c799C32a6cF228D0656f3B87D60224afaB45903",
    "432204",
    "Dexalot Subnet",
    "shared/",
  );

  // //Crystaleum
  // verifyContract(
  //   "0x8Ab612E257534b7d5a6E315444f1C45c434eAaCf",
  //   "103090",
  //   "Crystaleum",
  //   "shared/"
  //
  // );

  //Kekchain (testnet)
  // verifyContract(
  //   "0x6FCe618B0677EdFCca9d38ed48Af89a8c056C938",
  //   "420666",
  //   "Kekchain",
  //   "shared/"
  // );

  //Kekchain Main Net (kekistan)
  // verifyContract(
  //   "0xbc0103404476AF674756911553b7A45B55e989e5",
  //   "420420",
  //   "Kekchain",
  //   "shared/"
  // );

  // Canto
  verifyContract(
    "0x65ec06aF7b8A6cBa7E7226e70dd2eBd117b823Cd",
    "7700",
    "Canto",
    "shared/",
  );

  // Canto Testnet
  verifyContract(
    "0x37e12c98b4663DcE9ab1460073D9Fe82A7bFD0d8",
    "7701",
    "Canto Testnet",
    "shared/",
  );

  // // POA Network Core
  // verifyContract(
  //   "0x3b2e3383AeE77A58f252aFB3635bCBd842BaeCB3",
  //   "99",
  //   "POA Core",
  //   "shared/"
  //
  // );

  // // Astar (EVM)
  // verifyContract(
  //   "0xA7e70Be8A6563DCe75299c30D1566A83fC63BC37",
  //   "592",
  //   "Astar (EVM)",
  //   "shared/"
  //
  // );

  // Gnosis Chiado Testnet
  verifyContract(
    "0xd46fd24ea21F04459407Fb0B518451e54d0b07a1",
    "10200",
    "Gnosis Chiado Testnet",
    "shared/",
  );

  // Kaia Kairos Testnet
  verifyContract(
    "0x662749a392CeB1b5973a90FB2c388a2C18B8812c",
    "1001",
    "Kaia Kairos Testnet",
    "shared/",
  );

  // Kaia Mainnet
  verifyContract(
    "0x3b2e3383AeE77A58f252aFB3635bCBd842BaeCB3",
    "8217",
    "Kaia Mainnet",
    "shared/",
  );

  // Shiden (EVM)
  verifyContract(
    "0x3b2e3383AeE77A58f252aFB3635bCBd842BaeCB3",
    "336",
    "Shiden (EVM)",
    "shared/",
  );

  // Chain support turned off
  // // Optimism Bedrock: Goerli Alpha Testnet
  // verifyContract(
  //   "0xA7e70Be8A6563DCe75299c30D1566A83fC63BC37",
  //   "28528",
  //   "Optimism Bedrock: Goerli Alpha Testnet",
  //   "shared/"
  //
  // );

  // ZetaChain: Athens Testnet
  verifyContract(
    "0x52ef49D23630EF439a8177E1e966F1953f37473f",
    "7001",
    "ZetaChain Athens Testnet",
    "shared/",
  );

  // ZetaChain: Athens Mainnet
  verifyContract(
    "0x5f5a064761A416919A60939DB85AeFD487e6cB3A",
    "7000",
    "ZetaChain Athens Mainnet",
    "shared/",
  );

  // Oasis Emerald Mainnet
  verifyContract(
    "0x7228Ab1F57e6fFd9F85930b9a9C2E9DD2307E4D0",
    "42262",
    "Oasis Emerald Mainnet",
    "shared/",
  );

  // Oasis Emerald Testnet
  verifyContract(
    "0x70D7603cAc831A9f23Fc7cAc301db300D55EA921",
    "42261",
    "Oasis Emerald Testnet",
    "shared/",
  );

  // Songbird Canary Network
  verifyContract(
    "0x024829b4A91fB78437A854380c89A3fFc966c2D1",
    "19",
    "Songbird Canary Network",
    "shared/",
  );

  // Flare Mainnet
  verifyContract(
    "0x24AaDc3168a88a0058DF9437CAD3275170CDd581",
    "14",
    "Flare Mainnet",
    "shared/",
  );

  // Oasis Sapphire Mainnet
  verifyContract(
    "0xFBcb580DD6D64fbF7caF57FB0439502412324179",
    "23294",
    "Oasis Sapphire",
    "shared/",
  );

  // Oasis Sapphire Testnet
  verifyContract(
    "0xFBcb580DD6D64fbF7caF57FB0439502412324179",
    "23295",
    "Oasis Sapphire Testnet",
    "shared/",
  );

  // Stratos Testnet (Mesos)
  verifyContract(
    "0xA049F14E503A489E6f72603034CBe4d6835C8393",
    "2047",
    "Stratos Testnet",
    "shared/",
  );

  // Stratos Mainnet
  verifyContract(
    "0x9004804c4306d0eF7687Bce0C193A94C7593013F",
    "2048",
    "Stratos Mainnet",
    "shared/",
  );

  // Bear Network Chain Mainnet
  verifyContract(
    "0x115B83FE885D2Acf6099B6f3aAa75502CEBBA154",
    "641230",
    "Bear Network Chain Mainnet",
    "shared/",
  );

  // Lyra Mainnet
  verifyContract(
    "0xA46418a787312558453D79037f83b1319ae62c62",
    "957",
    "Lyra Mainnet",
    "shared/",
  );

  // // Base Goerli Testnet
  // verifyContract(
  //   "0x8F78b9c92a68DdF719849a40702cFBfa4EB60dD0",
  //   "84531",
  //   "Base Goerli Testnet",
  //   "shared/"
  // );

  // Base Mainnet
  verifyContract(
    "0x5e357053DDa704D059D146444cCC81afC1B2a662",
    "8453",
    "Base Mainnet",
    "shared/",
  );

  // Fraxtal
  verifyContract(
    "0xEe44D634f97d8eE09850Ed04559E068D30276FE7",
    "252",
    "Fraxtal",
    "252/",
    "partial",
  );

  verifyContract(
    "0x31D982ebd82Ad900358984bd049207A4c2468640",
    "2522",
    "Fraxtal Testnet",
    "252/",
    "partial",
  );

  // Wanchain Mainnet
  verifyContract(
    "0xC3649123BCa36c0c38A71bDbd2F508AB4f939f47",
    "888",
    "Wanchain Mainnet",
    "shared/",
  );

  // Wanchain Testnet
  verifyContract(
    "0x500E12a948E9Fc594bC6Fe86B3B270B5a67332D8",
    "999",
    "Wanchain Testnet",
    "shared/",
  );

  // The Root Network Mainnet
  verifyContract(
    "0x6C0cE8d62F1D81464F6F4DecB62f97aa83B8Df89",
    "7668",
    "The Root Network Mainnet",
    "shared/",
  );

  // The Root Network Porcini (Testnet)
  verifyContract(
    "0x225F2cD344c61152F8E7200E62e03dEfD683f2c4",
    "7672",
    "The Root Network Porcini",
    "shared/",
  );

  // Hedera Mainnet
  verifyContract(
    "0x00000000000000000000000000000000002265bb",
    "295",
    "Hedera Mainnet",
    "shared/",
  );

  // DogeChain Mainnet
  verifyContract(
    "0x2a35F4AA0d3e417e8896E972f35dba4b39b6305e",
    "2000",
    "DogeChain Mainnet",
    "shared/",
  );

  // // Telcoin Network
  // verifyContract(
  //   "0x25E8aB38013CB30D74992Aa5d1a74B65409Dc6b1",
  //   "2017",
  //   "Telcoin Network",
  //   "shared/",
  // );

  // Bitkub Chain Testnet
  verifyContract(
    "0x58909Ef2F2b167F52cF46575f1582500287cCE48",
    "25925",
    "Bitkub Chain Testnet",
    "shared/",
  );

  // Bitkub Chain
  verifyContract(
    "0xC75f4D89A0DdA70Ad613908D9976E90dAb42035c",
    "96",
    "Bitkub Chain",
    "shared/",
  );

  // Cronos Mainnet Beta
  verifyContract(
    "0xEdE2053329D203E8261B47A10540Ee4b7a596667",
    "25",
    "Cronos Mainnet Beta",
    "25/",
  );

  // Elysium Mainnet Chain
  verifyContract(
    "0x20563837F7423465699D7675BCB82f886a761c25",
    "1339",
    "Elysium Mainnet",
    "shared/",
  );

  // Taiko Grimsvotn L2
  // verifyContract(
  //   "0x68107Fb54f5f29D8e0B3Ac44a99f4444D1F22a68",
  //   "167005",
  //   "Taiko Grimsvotn L2",
  //   "shared/"
  // );

  // Taiko Eldfell L3
  // verifyContract(
  //   "0x270a7521B3678784f96848D441fE1B2dc2f040D8",
  //   "167006",
  //   "Taiko Eldfell L3",
  //   "shared/",
  //   "partial"
  // );

  // ZORA Mainnet
  verifyContract(
    "0x090734f94FA67590702421A9B61892509b7CE80A",
    "7777777",
    "ZORA MAinnet",
    "shared/",
  );

  // ZORA Sepolia Testnet
  verifyContract(
    "0x9788C590bd201b80091Bca6A322BeB903b8190Dd",
    "999999999",
    "ZORA Sepolia Testnet",
    "shared/",
  );

  // UPTN Chain Mainnet
  verifyContract(
    "0x212F6222fB4937978A806b14FB2725169825078F",
    "6119",
    "UPTN Chain",
    "6119/",
  );

  // BEAM Chain Testnet
  verifyContract(
    "0x9BF49b704EE2A095b95c1f2D4EB9010510c41C9E",
    "13337",
    "BEAM Chain",
    "multicall/",
    "partial",
  );

  // Kanazawa Chain Testnet
  // verifyContract(
  //   "0x24c456Fb4c450208366B1f8322c3241aA013758e",
  //   "222000222",
  //   "Kanazawa Chain",
  //   "multicall-literal-contents/",
  // );

  // // MELD Chain Testnet
  // verifyContract(
  //   "0x769eE5A8e82C15C1b6E358f62aC8eb6E3AbE8dC5",
  //   "333000333",
  //   "MELD Chain",
  //   "multicall-literal-contents/",
  // );

  // Kiwi Subnet
  verifyContract(
    "0xe89a85b79e64b35829625A7EEf70F8915d32F75f",
    "2037",
    "Kiwi Subnet",
    "multicall-avalabs/",
  );

  // KAVA EVM
  verifyContract(
    "0xAdFa11e737ec8fA6e91091468aEF33a66Ae0044c",
    "2222",
    "Kava EVM",
    "shared/",
  );

  // Siberium Testnet
  verifyContract(
    "0x60E9b3CD8C160Ce6408dD6E2Fa938895cfF7E087",
    "111000",
    "Siberium Testnet",
    "shared/",
  );

  // Ethereum Classic Mainnet
  verifyContract(
    "0x45a82B987a4e5d7D00eD5aB325DF00850cDAbBAC",
    "61",
    "Ethereum Classic Mainnet",
    "shared/",
  );

  // Filecoin Mainnet
  verifyContract(
    "0x23396626F2C9c0b31cC6C2729172103961Ae2A26",
    "314",
    "Filecoin Mainnet",
    "shared/",
  );

  // Filecoin Calibration Testnet
  verifyContract(
    "0xB34d5e2Eb6eCFDe11cC63955b43335A2407A4683",
    "314159",
    "Filecoin Calibration Testnet",
    "shared/",
  );

  // Zilliqa EVM
  verifyContract(
    "0x6F85669808e20b121980DE8E7a794a0cc90fDc77",
    "32769",
    "Zilliqa EVM",
    "shared/",
  );
  // Zilliqa EVM Testnet
  verifyContract(
    "0xeb6Ea260eDFb9837ed100B09c559081AfA5b0785",
    "33101",
    "Zilliqa EVM Testnet",
    "shared/",
  );
  // Zilliqa 2 EVM proto-mainnet
  verifyContract(
    "0xf2Dfea00e0AFB068eb2F861039F40af8eF14ead2",
    "32770",
    "Zilliqa 2 EVM proto-mainnet",
    "shared/",
  );
  // Zilliqa 2 EVM proto-testnet
  verifyContract(
    "0xCCA8678D48D028Ba9AF201345c608DfDB0D64f83",
    "33103",
    "Zilliqa 2 EVM proto-testnet",
    "shared/",
  );

  // KAVA EVM Testnet
  verifyContract(
    "0x40b4f95C3bafc8d690B4c3fDD1E8303c4817Cd9C",
    "2221",
    "Kava EVM Testnet",
    "shared/",
  );
  // MAP Testnet Makalu
  verifyContract(
    "0xAbdE047dD5861E163830Ad57e1E51990035E1F44",
    "212",
    "MAP Testnet Makalu",
    "shared/",
  );
  // map-relay-chain mainnet
  verifyContract(
    "0xAbdE047dD5861E163830Ad57e1E51990035E1F44",
    "22776",
    "Map Mainnet",
    "shared/",
  );

  // Edgeware EdgeEVM Mainnet
  verifyContract(
    "0xCc21c38A22918a86d350dF9aB9c5A60314A01e06",
    "2021",
    "Edgeware EdgeEVM Mainnet",
    "shared/",
  );

  // Arbitrum Nova
  verifyContract(
    "0xC2141cb30Ef8cE403569D59964eaF3D66848822F",
    "42170",
    "Arbitrum Nova",
    "shared/",
  );

  // FTM Fantom Opera Mainnet
  verifyContract(
    "0xc47856bEBCcc2BBB23E7a5E1Ba8bB4Fffa5C5476",
    "250",
    "Fantom Opera",
    "shared/",
  );

  verifyContract(
    "0x4956f15efdc3dc16645e90cc356eafa65ffc65ec",
    "4337",
    "Beam Subnet",
    "multicall-avalabs/",
  );

  // verifyContract(
  //   "0x72Ed1E3E3A68DfB7495FAfb19C0de1A0B7Ec5524",
  //   "78432",
  //   "Conduit Subnet",
  //   "78432/"
  // );

  // verifyContract(
  //   "0xa785B911a79B0d5d8895c567663c29F0f7B93321",
  //   "78431",
  //   "Bulletin Subnet",
  //   "78431/"
  // );

  // // Amplify Subnet
  // verifyContract(
  //   "0xB19f81cA2141ACd6F2Cc39bAFAD2a613bC4c9592",
  //   "78430",
  //   "Amplify Subnet",
  //   "78430/"
  // );

  // Shrapnel Subnet Testnet
  verifyContract(
    "0x8Bb9d0Dd48B7a54B248D2d386AfF253DA7856479",
    "2038",
    "Shrapnel Testnet",
    "multicall-avalabs/",
  );

  // Shrapnel Subnet
  verifyContract(
    "0xb9D27a0D61392566b92E08937a6C6E798F197ADF",
    "2044",
    "Shrapnel Subnet",
    "multicall-avalabs/",
  );
  verifyContract(
    "0xD5bB0035a178d56Abd23a39fB3666031084b2cb5",
    "1116",
    "Core Blockchain Mainnet",
    "shared/",
  );

  verifyContract(
    "0xfABd9a36bF07A3190859f819638E0A49adEa6C41",
    "10242",
    "Arthera Mainnet",
    "shared/",
  );

  // verifyContract(
  //   "0xE115Ef16e46bbF46591170D712140eC553C43553",
  //   "10243",
  //   "Arthera Testnet",
  //   "shared/",
  // );

  // Q Mainnet
  verifyContract(
    "0xc8AeB7206D1AD1DD5fC202945401303b3A7b72e0",
    "35441",
    "Q Mainnet",
    "shared/",
  );

  // Q Testnet
  verifyContract(
    "0xc8AeB7206D1AD1DD5fC202945401303b3A7b72e0",
    "35443",
    "Q Testnet",
    "shared/",
  );

  verifyContract(
    "0xbF33D2dA0F875D826ce1bA250F66b2785d48C113",
    "11235",
    "Haqq Mainnet",
    "shared/",
  );

  verifyContract(
    "0xbF33D2dA0F875D826ce1bA250F66b2785d48C113",
    "54211",
    "Haqq Testnet",
    "shared/",
  );

  verifyContract(
    "0xbC3559436348f1D96029b2Ccc16d2bBDE8016865",
    "1114",
    "Core Blockchain Testnet2",
    "shared/",
  );

  verifyContract(
    "0x612C7dE4039655B9C9aE9A9B41f3A22319F0dF65",
    "1115",
    "Core Blockchain Testnet",
    "shared/",
  );

  verifyContract(
    "0xFe392C04b7879f28D9F966239F3e3646fe048863",
    "30",
    "Rootstock",
    "shared/",
  );

  verifyContract(
    "0x10fB58BBd3c4F580aC4be0600221850FDF33BEdF",
    "49797",
    "Energi Testnet",
    "shared/",
  );

  verifyContract(
    "0xA9CD2d159ca8ab30711e9d9331D5229476e8a2d5",
    "39797",
    "Energi Mainnet",
    "shared/",
  );

  // Mantle Mainnet
  verifyContract(
    "0x77cD62e4D8d7b9dA83A2B6a15Ca6c702E83eCE44",
    "5000",
    "Mantle Mainnet",
    "shared/",
  );
  // Mantle Sepolia Testnet
  verifyContract(
    "0xd8EFfb6C21e926E1d71440A2b6e8E1566fAf62D6",
    "5003",
    "Mantle Sepolia Testnet",
    "shared/",
  );

  // Crossbell Mainnet
  verifyContract(
    "0xaa028312440DFd72A33053932150aE5e35017f6A",
    "3737",
    "Crossbell Mainnet",
    "shared/",
  );

  // Rikeza Network
  // verifyContract(
  //   "0xa8c07c66d0458e8c6e442a8827f4bc3fad036407",
  //   "1433",
  //   "Rikeza Network",
  //   "1433/",
  // );

  // Zeniq Mainnet
  verifyContract(
    "0xCf16669c144989409D439262F2BfBFa31BD6cd2a",
    "383414847825",
    "Zeniq",
    "shared/",
  );

  // // Tiltyard Subnet
  // verifyContract(
  //   "0xfd52e1A54442aC8d6a7C54713f99D0dc113df220",
  //   "1127469",
  //   "Tiltyard Subnet",
  //   "multicall-src/",
  // );

  // Polygon zkEVM Mainnet
  verifyContract(
    "0xaa50c265da4552db6e8983317e3b5510727db132",
    "1101",
    "Polygon zkEVM",
    "shared/",
  );

  // Scroll Sepolia Testnet
  verifyContract(
    "0xce478ef16eb34438463513c48da4f31269fa8b6a",
    "534351",
    "Scroll Sepolia Testnet",
    "shared/",
  );

  // Scroll
  verifyContract(
    "0x1685d11a2EDce8d2C8015f4cB0Cd197839b761f5",
    "534352",
    "Scroll",
    "shared/",
  );

  // Mode Testnet
  verifyContract(
    "0x4d5f06cC2A7d3a625C95D04Cfaec5AEb5eCfA33D",
    "919",
    "Mode Testnet",
    "shared/",
  );

  // Mode
  verifyContract(
    "0x4d5f06cC2A7d3a625C95D04Cfaec5AEb5eCfA33D",
    "34443",
    "Mode",
    "shared/",
  );

  // Conflux eSpace
  verifyContract(
    "0x4d5f06cc2a7d3a625c95d04cfaec5aeb5ecfa33d",
    "1030",
    "Conflux eSpace",
    "shared/",
  );

  // Lightlink Pegasus Testnet
  verifyContract(
    "0x948a02ABB83ED54D8908F6725d2a9cEE6B6B582a",
    "1891",
    "Lightlink Pegasus Testnet",
    "shared/",
  );

  // Lightlink Phoenix Mainnet
  verifyContract(
    "0x948a02ABB83ED54D8908F6725d2a9cEE6B6B582a",
    "1890",
    "Lightlink Phoenix Mainnet",
    "shared/",
  );

  // ZKFair Mainnet
  verifyContract(
    "0xc3a9766e07754cC1894E5c0A2459d23A676dDD0D",
    "42766",
    "ZKFair Mainnet",
    "shared/",
  );

  // Kroma Sepolia
  verifyContract(
    "0x4d5f06cC2A7d3a625C95D04Cfaec5AEb5eCfA33D",
    "2358",
    "Kroma Sepolia",
    "shared/",
  );

  // Kroma
  verifyContract(
    "0x270236c25d28a2cd85ed9a1ef0b31835fb9e4ff6",
    "255",
    "Kroma",
    "shared/",
  );

  // Ozone Chain Mainnet
  verifyContract(
    "0xf776d21c74BEde463E0Ac7aD7cF12a9b2c904D03",
    "4000",
    "Ozone Chain Mainnet",
    "shared/",
  );

  // Endurance Smart Chain Mainnet
  verifyContract(
    "0x9e5b6c4F1080a4cb5bFD84816375c25E3B26d11A",
    "648",
    "Endurance Smart Chain Mainnet",
    "shared/",
  );

  // CrossFi Chain Testnet
  verifyContract(
    "0x684F57Dd731EB2F7Bab0f9b077C41C256CB4eb17",
    "4157",
    "CrossFi Chain Testnet",
    "shared/",
  );

  // Tiltyard Mainnet
  verifyContract(
    "0xbBB3e01361604EB1884b3f1Cf3524b73966E8Ef9",
    "710420",
    "Tiltyard Mainnet",
    "shared/",
  );

  // Phoenix Mainnet
  verifyContract(
    "0x4aE9a333D2Bfb5754fEa6aA24c17026EbD411e2f",
    "13381",
    "Phoenix Mainnet",
    "shared/",
  );

  // // YMTECH-BESU Testnet
  // verifyContract(
  //   "0x37A01685de21e2d459fE3c6AEDe86A94B4bb8d9C",
  //   "202401",
  //   "YMTECH-BESU Testnet",
  //   "shared/",
  // );

  // Swisstronik Testnet
  verifyContract(
    "0xd9FeCAb5f83F381c15Fa1420DB7F1647a966016E",
    "1291",
    "Swisstronik Testnet",
    "shared/",
  );

  // Polygon Amoy Testnet
  verifyContract(
    "0x8A4eBAEB1319623Aebda7c0F77b22263893f286B",
    "80002",
    "Polygon Amoy Testnet",
    "shared/",
  );

  // DEGEN chain
  verifyContract(
    "0x61A4Bc8a6F81f3A6B0677dd1e5CB4671d0734Cb3",
    "666666666",
    "DEGEN chain",
    "shared/",
  );

  // Stratis Mainnet
  verifyContract(
    "0x2FaCD0B78210f27B70d75a2F17dcE133C07C0Ab4",
    "105105",
    "Stratis Mainnet",
    "shared/",
  );

  // Auroria Testnet
  verifyContract(
    "0xe446f231A55e8a376ec7cF5Ae7345f91BBAb5D8E",
    "205205",
    "Auroria Testnet",
    "shared/",
  );

  // Merlin Mainnet
  verifyContract(
    "0x5C45f386FD1346FE80a1A0dA6c889384372E4580",
    "4200",
    "Merlin Mainnet",
    "shared/",
  );

  // Aura Euphoria Testnet
  verifyContract(
    "0xF24b6C8a9A658260F2BF019E85BB081fFAf2e590",
    "6321",
    "Aura Euphoria Testnet",
    "shared/",
  );

  // Aura Xstaxy Mainnet
  verifyContract(
    "0x6Da592Fb9E71342050511AC50E610EA24004F3ec",
    "6322",
    "Aura Xstaxy Mainnet",
    "shared/",
  );

  // Bitlayer Mainnet
  verifyContract(
    "0x3eBC948d4E3E1dACAd8fcAB719937b6264222718",
    "200901",
    "Bitlayer Mainnet",
    "shared/",
  );

  // Bitlayer Testnet
  verifyContract(
    "0x0E05574850f8a70B40df4A665Eb438EA9a359615",
    "200810",
    "Bitlayer Testnet",
    "shared/",
  );

  // Redstone
  verifyContract(
    "0x81EbbEDEd806Dbaa6ccD5a9D6D88D0d90B70dfc9",
    "690",
    "Redstone",
    "shared/",
  );

  // // Garnet Holesky
  // verifyContract(
  //   "0x81EbbEDEd806Dbaa6ccD5a9D6D88D0d90B70dfc9",
  //   "17069",
  //   "Garnet Holesky",
  //   "shared/",
  // );

  // // PlayFair Testnet Subnet
  // verifyContract(
  //   "0x9be71dB4693657625F92359d046c513Bb35F96db",
  //   "12898",
  //   "PlayFair Testnet Subnet",
  //   "shared/",
  // );

  // HOME Verse Mainnet
  verifyContract(
    "0x988d819a6103f0a9a693BE7Ffd90fe7b499592f5",
    "19011",
    "HOME Verse Mainnet",
    "shared/",
  );

  // Lamina1
  verifyContract(
    "0x61ACA050011D091A5790de774190cCdD42Ab882F",
    "10849",
    "Lamina1",
    "shared/",
  );

  // Lamina1 Identity
  verifyContract(
    "0x61ACA050011D091A5790de774190cCdD42Ab882F",
    "10850",
    "Lamina1 Identity",
    "shared/",
  );

  // Lamina1 Testnet
  verifyContract(
    "0x61ACA050011D091A5790de774190cCdD42Ab882F",
    "764984",
    "Lamina1 Testnet",
    "shared/",
  );

  // Lamina1 Identity Testnet
  verifyContract(
    "0x61ACA050011D091A5790de774190cCdD42Ab882F",
    "767368",
    "Lamina1 Identity Testnet",
    "shared/",
  );

  // Base Sepolia Testnet
  verifyContract(
    "0xaBe8cf2Dacb0053C1ebd5881392BD17Ec2402a4F",
    "84532",
    "Base Sepolia Testnet",
    "shared/",
  );

  // Linea
  verifyContract(
    "0x1e80eAc9B0f143d1eC8f877AF07aC40E9aE65DBc",
    "59144",
    "Linea Mainnet",
    "shared/",
  );

  // Linea Testnet
  verifyContract(
    "0xD20631457f3c80f77e10C9cCEC11229b5774DB35",
    "59141",
    "Linea Sepolia Testnet",
    "shared/",
  );

  // PLYR PHI
  verifyContract(
    "0xf1CFa02d6561C4b71DC3dEd08F7A14c0753E08a3",
    "16180",
    "PLYR PHI",
    "shared/",
  );

  // PLYR TAU Testnet
  verifyContract(
    "0xe440a9C3eCACac255533e4C8d6EDFDBc082304f1",
    "62831",
    "PLYR TAU Testnet",
    "shared/",
  );

  // Vechain Mainnet
  verifyContract(
    "0x85D2b3129aA0b6BB215734efC92a2c8f1cC9B3Aa",
    "100009",
    "VeChain Mainnet",
    "shared/",
  );

  // Vechain Testnet
  verifyContract(
    "0x0De8cD785Bb7a8c3eF67F07dB9fe11160215B0bC",
    "100010",
    "VeChain Testnet",
    "shared/",
  );

  // // Vechain Testnet
  // verifyContract(
  //   "0x393207E1019e4114EE4E9c633D09418252217e22",
  //   "16350",
  //   "Incentiv Devnet",
  //   "shared/",
  // );

  // Curtis Testnet
  verifyContract(
    "0xF4574BEcc73d834566389453577742Ad1C97DA16",
    "33111",
    "Curtis",
    "shared/",
  );

  //TixChain Testnet
  verifyContract(
    "0x6dbE8dA3D34cb97aF6ADf15fC98fDAD3a8E62Bd7",
    "723107",
    "TixChain Testnet",
    "shared/",
  );
  //OORT Mainnet
  verifyContract(
    "0x90166E6D26cda2aae4126F2A82744697DC90D306",
    "970",
    "OORT Mainnet",
    "shared/",
  );

  //B2 Mainnet
  verifyContract(
    "0x3A3a009856AC673D91892b05068EB82080ff8744",
    "223",
    "B2 Mainnet",
    "shared/",
  );

  // Polygon zkEVM Cardona Testnet
  verifyContract(
    "0x0c18F206943DD4dbE2Ab2af28c6062AE7EDba5ED",
    "2442",
    "Polygon zkEVM Cardona Testnet",
    "shared/",
  );

  // Metis Andromeda Mainnet
  verifyContract(
    "0xaCe60DF34CEeb11B52B0901Be3F58871A5E83D64",
    "1088",
    "Metis Andromeda Mainnet",
    "shared/",
  );

  // Metis Sepolia Testnet
  verifyContract(
    "0xF282C3784C0187C48747c779C362eCBaddB5F020",
    "59902",
    "Metis Sepolia Testnet",
    "shared/",
  );

  // Zircuit Testnet
  verifyContract(
    "0x0cfE351147DEb353a57623859F7b2A4984645433",
    "48899",
    "Zircuit Testnet",
    "shared/",
  );

  // Zircuit Garfield Testnet
  verifyContract(
    "0x0cfE351147DEb353a57623859F7b2A4984645433",
    "48898",
    "Zircuit Garfield Testnet",
    "shared/",
  );

  // Zircuit Mainnet
  verifyContract(
    "0x0cfE351147DEb353a57623859F7b2A4984645433",
    "48900",
    "Zircuit Mainnet",
    "shared/",
  );

  // Bitrock Mainnet
  verifyContract(
    "0x391D6076D64E3f716F48d7a74959958751C432e3",
    "7171",
    "Bitrock Mainnet",
    "shared/",
  );

  // Bitrock Testnet
  verifyContract(
    "0x3b89e156B7835c02a7C60aC93a64A3a785727b5B",
    "7771",
    "Bitrock Testnet",
    "shared/",
  );

  // // Story Odyssey
  // verifyContract(
  //   "0x78418e6efE946a65900E354e949C5dF0317dd411",
  //   "1516",
  //   "Story Odyssey",
  //   "shared/",
  // );

  // // Quantum Portal Network
  // verifyContract(
  //   "0x511f9B726559384f10371Bc7f19A925F864a9997",
  //   "26100",
  //   "Quantum Portal Network",
  //   "shared/",
  // );

  // Citrea Testnet
  verifyContract(
    "0xad90c25cA57A3871241D88c42dca829ae59EC144",
    "5115",
    "Citrea Testnet",
    "shared/",
  );

  // Citrea Testnet
  verifyContract(
    "0xF32a986F3741cC19Cfe05B806b3ECBAe7eB5F4eA",
    "180",
    "AME Chain Mainnet",
    "shared/",
  );

  // Superseed Mainnet
  verifyContract(
    "0xaa0b508D986702650e4D3AaB253f5E97e2cF86A8",
    "5330",
    "Superseed Mainnet",
    "shared/",
  );

  // Corn Mainnet
  verifyContract(
    "0xCFeE055Bf4deC42563F023cA097edf0C48Cc357F",
    "21000000",
    "Corn Mainnet",
    "shared/",
  );

  // Etherlink
  verifyContract(
    "0xec5504BcE3BCE4F1c4088a6A150A4A8C840945a7",
    "42793",
    "Etherlink",
    "shared/",
  );

  // Etherlink Testnet
  verifyContract(
    "0x5827317D75D53E7a7901657307209bC684B8EcDc",
    "128123",
    "Etherlink Testnet",
    "shared/",
  );
  // peaq
  verifyContract(
    "0x3ef7f3E38704eD3702D105094Bbb8562BE51b569",
    "3338",
    "peaq Mainnet",
    "shared/",
  );

  it("should have included Etherscan contracts for all testedChains having etherscanAPI", function (done) {
    const missingEtherscanTests: ChainApiResponse[] = [];
    supportedChains
      .filter((chain) => testedChains.has(`${chain.chainId}`))
      .forEach((chain) => {
        if (chain.chainId == 1337 || chain.chainId == 31337) return; // Skip LOCAL_CHAINS: Ganache and Hardhat
        if (
          chain.etherscanAPI &&
          !Object.prototype.hasOwnProperty.call(
            testEtherscanContracts,
            chain.chainId.toString(),
          )
        ) {
          missingEtherscanTests.push(chain);
        }
      });

    chai.assert(
      missingEtherscanTests.length == 0,
      `There are missing Etherscan tests for chains: ${missingEtherscanTests
        .map((chain) => `${chain.name} (${chain.chainId})`)
        .join(",\n")}`,
    );

    done();
  });

  // Finally check if all the "supported: true" chains have been tested
  it("should have tested all supported chains", function (done) {
    if (newAddedChainIds.length) {
      // Don't test all chains if it is a pull request for adding new chain support
      return this.skip();
    }

    const untestedChains: ChainApiResponse[] = [];
    supportedChains.forEach((chain) => {
      if (chain.chainId == 1337 || chain.chainId == 31337) return; // Skip LOCAL_CHAINS: Ganache and Hardhat
      if (!testedChains.has(chain.chainId.toString())) {
        untestedChains.push(chain);
      }
    });
    chai.assert(
      untestedChains.length == 0,
      `There are untested chains!: ${untestedChains
        .map((chain) => `${chain.name} (${chain.chainId})`)
        .join(",\n")}`,
    );

    done();
  });

  //////////////////////
  // Helper functions //
  //////////////////////

  function verifyContract(
    address: string,
    chainId: string,
    chainName: string,
    sourceAndMetadataDir: string, // folder
    expectedStatus: VerificationStatus = "perfect",
  ) {
    // If it is a pull request for adding new chain support, only test the new chain
    if (newAddedChainIds.length && !newAddedChainIds.includes(chainId)) return;
    it(`should verify a contract on ${chainName} (${chainId})`, function (done) {
      // Context for the test report
      addContext(this, {
        title: "Test identifier",
        value: {
          chainId: chainId,
          testType: "normal",
        },
      });

      const fullDir = path.join(__dirname, "sources", sourceAndMetadataDir);
      const files = {};
      readFilesRecursively(fullDir, files);

      chai
        .request(serverFixture.server.app)
        .post("/")
        .send({
          address: address,
          chain: chainId,
          files: files,
        })
        .end(async (err, res) => {
          await assertVerification(
            null,
            err,
            res,
            done,
            address,
            chainId,
            expectedStatus,
          );
          anyTestsPass = true;
        });
    });
    testedChains.add(chainId);
  }
});

function readFilesRecursively(
  directoryPath: string,
  files: Record<string, string>,
) {
  const filesInDirectory = fs.readdirSync(directoryPath);

  filesInDirectory.forEach((file) => {
    const filePath = path.join(directoryPath, file);

    if (fs.statSync(filePath).isDirectory()) {
      readFilesRecursively(filePath, files);
    } else {
      files[filePath] = fs.readFileSync(filePath).toString();
    }
  });
}
