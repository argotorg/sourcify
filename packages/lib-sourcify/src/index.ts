// Logger exports
import { setLogger, setLevel, ILogger, getLevel } from './logger';
export const setLibSourcifyLogger = setLogger;
export const setLibSourcifyLoggerLevel = setLevel;
export const getLibSourcifyLoggerLevel = getLevel;
export type ILibSourcifyLogger = ILogger;

// Compilation exports
export * from './Compilation/AbstractCompilation';
export * from './Compilation/SolidityCompilation';
export * from './Compilation/VyperCompilation';
export * from './Compilation/PreRunCompilation';
export * from './Compilation/CompilationTypes';

// Verification exports
export * from './Verification/Verification';
export * from './Verification/VerificationTypes';

// Etherscan utils exports
export * from './utils/etherscan/EtherscanTypes';
import * as etherscanUtils from './utils/etherscan/etherscan-util';
export const EtherscanUtils = {
  ...etherscanUtils,
};

// Validation exports
export * from './Validation/SolidityMetadataContract';
export * from './Validation/ValidationTypes';
export * from './Validation/processFiles';
export * from './Verification/Transformations';
export * from './Validation/fetchUtils';
export { unzipFiles } from './Validation/zipUtils';

// SourcifyChain exports
export * from './SourcifyChain/SourcifyChain';
export * from './SourcifyChain/SourcifyChainTypes';

// SourcifyLibError exports
export * from './SourcifyLibError';

// Utils exports
export * from './utils/utils';

// Export all compilers types
export * from '@ethereum-sourcify/compilers-types';
