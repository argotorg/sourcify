import { expect } from 'chai';
import { getContractPathFromSources } from '../../src';

describe('getContractPathFromSources (lib)', () => {
  it('should return the correct contract path', () => {
    const sources = {
      'SolidityContract.sol': { content: 'contract WrongContract {}' },
      'path/file.sol': {
        content: 'contract WrongContract {}\ncontract SolidityContract {}',
      },
    } as any;
    const result = getContractPathFromSources('SolidityContract', sources);
    expect(result).to.equal('path/file.sol');
  });

  it('should return undefined when the contract path is not found in the provided sources', () => {
    const sources = {
      'path/file.sol': { content: 'contract SolidityContract {}' },
    } as any;
    const result = getContractPathFromSources('AnotherSolidityContract', sources);
    expect(result).to.be.undefined;
  });
});

