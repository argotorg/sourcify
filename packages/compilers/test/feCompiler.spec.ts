import { expect } from 'chai';
import {
  findFePlatform,
  getFeExecutable,
  useFeCompiler,
} from '../src/lib/feCompiler';
import { CompilerError } from '../src/lib/common';
import path from 'path';

describe('Verify Fe Compiler', () => {
  const feRepoPath = path.join('/tmp', 'compilers-fe-repo');
  const version = '26.0.0-alpha.10';

  it('Should detect Fe platform', () => {
    const platform = findFePlatform();
    expect(platform).to.be.a('string');
    expect(platform).to.not.equal(false);
  });

  it('Should fetch Fe executable', async () => {
    const platform = findFePlatform();
    if (!platform) {
      return;
    }
    const fePath = await getFeExecutable(feRepoPath, platform, version);
    expect(fePath).to.be.a('string');
    expect(fePath).to.not.be.empty;
  });

  it('Should throw an error for an invalid Fe version', async () => {
    const platform = findFePlatform();
    if (!platform) {
      return;
    }
    try {
      await getFeExecutable(feRepoPath, platform, 'invalid-version');
      expect.fail('Expected error was not thrown');
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
    }
  });

  it('Should compile a single-file Fe contract', async () => {
    const compiledJSON = await useFeCompiler(feRepoPath, version, {
      language: 'Fe',
      settings: {},
      sources: {
        'src/lib.fe': {
          content: `use std::abi::sol
use std::evm::{Evm, Call}
use std::evm::effects::assert

msg CounterMsg {
    #[selector = sol("increment()")]
    Increment,
    #[selector = sol("get()")]
    Get -> u256,
}

struct CounterStore {
    value: u256,
}

pub contract Counter {
    mut store: CounterStore

    init() uses (mut store) {
        store.value = 0
    }

    recv CounterMsg {
        Increment uses (mut store) {
            store.value = store.value + 1
        }

        Get -> u256 uses (store) {
            store.value
        }
    }
}`,
        },
      },
    });

    expect(compiledJSON.compiler).to.equal(`fe-${version}`);
    const counter = compiledJSON?.contracts?.['src/lib.fe']?.Counter;
    expect(counter).to.not.be.undefined;
    expect(counter.abi).to.be.null;
    expect(counter.evm.bytecode.object).to.be.a('string').that.is.not.empty;
    expect(counter.evm.deployedBytecode.object).to.be.a('string').that.is.not
      .empty;
  });

  it('Should return a compiler error for invalid source', async () => {
    try {
      await useFeCompiler(feRepoPath, version, {
        language: 'Fe',
        settings: {},
        sources: {
          'src/lib.fe': {
            content: 'this is not valid Fe code',
          },
        },
      });
      expect.fail('Expected error was not thrown');
    } catch (e: any) {
      expect(e).to.be.instanceOf(CompilerError);
      expect(e.errors).to.be.an('array').that.is.not.empty;
      expect(e.errors.some((err: any) => err.severity === 'error')).to.be.true;
    }
  });

  it('Should compile a multi-file Fe ingot', async () => {
    const compiledJSON = await useFeCompiler(feRepoPath, version, {
      language: 'Fe',
      settings: {},
      sources: {
        'src/lib.fe': {
          content: 'use ingot::counter::Counter\n',
        },
        'src/counter.fe': {
          content: `use std::abi::sol
use std::evm::{Evm, Call}
use std::evm::effects::assert

msg CounterMsg {
    #[selector = sol("increment()")]
    Increment,
    #[selector = sol("get()")]
    Get -> u256,
}

struct CounterStore {
    value: u256,
}

pub contract Counter {
    mut store: CounterStore

    init() uses (mut store) {
        store.value = 0
    }

    recv CounterMsg {
        Increment uses (mut store) {
            store.value = store.value + 1
        }

        Get -> u256 uses (store) {
            store.value
        }
    }
}`,
        },
      },
    });

    const counter = compiledJSON?.contracts?.['src/counter.fe']?.Counter;
    expect(counter).to.not.be.undefined;
    expect(counter.evm.bytecode.object).to.be.a('string').that.is.not.empty;
    expect(counter.evm.deployedBytecode.object).to.be.a('string').that.is.not
      .empty;
  });
});
