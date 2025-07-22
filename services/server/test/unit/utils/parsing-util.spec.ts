import { getContractPathFromSources } from "../../../src/server/services/utils/parsing-util";
import { expect } from "chai";

describe("getContractPathFromSources", () => {
  it("should return the correct contract path", () => {
    const sources = {
      // It should not derive it from the path
      "SolidityContract.sol": {
        content: "contract WrongContract {}",
      },
      "path/file.sol": {
        content: "contract WrongContract {}\ncontract SolidityContract {}",
      },
    };

    const result = getContractPathFromSources("SolidityContract", sources);
    expect(result).to.equal("path/file.sol");
  });

  it("should return undefined when the contract path is not found in the provided sources", () => {
    const sources = {
      "path/file.sol": {
        content: "contract SolidityContract {}",
      },
    };

    const result = getContractPathFromSources(
      "AnotherSolidityContract",
      sources,
    );
    expect(result).to.be.undefined;
  });
});
