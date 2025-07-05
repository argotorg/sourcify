import { AuxdataStyle } from '@ethereum-sourcify/bytecode-utils';
import {
  ImmutableReferences,
  LinkReferences,
  Metadata,
} from '@ethereum-sourcify/compilers-types';
import {
  CompiledContractCborAuxdata,
  StringMap,
} from '../Compilation/CompilationTypes';
import { AbiConstructor } from 'abitype';
import { defaultAbiCoder as abiCoder, ParamType } from '@ethersproject/abi';
import { id as keccak256Str } from 'ethers';
import { logError } from '../logger';

export type Transformation = {
  type: 'insert' | 'replace';
  reason:
    | 'constructorArguments'
    | 'library'
    | 'immutable'
    | 'cborAuxdata'
    | 'callProtection';
  offset: number;
  id?: string;
};

// Call protection is always at the start of the runtime bytecode
export const CallProtectionTransformation = (): Transformation => ({
  type: 'replace',
  reason: 'callProtection',
  offset: 1, // 1 byte is always the PUSH20 opcode 0x73
});

// TransformationValues only has one ConstructorTransformatino so no id field is needed
export const ConstructorTransformation = (offset: number): Transformation => ({
  type: 'insert',
  reason: 'constructorArguments',
  offset,
});

export const AuxdataTransformation = (
  offset: number,
  id: string,
): Transformation => ({
  type: 'replace',
  reason: 'cborAuxdata',
  offset,
  id,
});

export const LibraryTransformation = (
  offset: number,
  id: string,
): Transformation => ({
  type: 'replace',
  reason: 'library',
  offset,
  id,
});

export const ImmutablesTransformation = (
  offset: number,
  id: string,
  type: 'replace' | 'insert',
): Transformation => ({
  type,
  reason: 'immutable',
  offset,
  id,
});

export interface TransformationValues {
  constructorArguments?: string;
  callProtection?: string;
  libraries?: {
    [id: string]: string;
  };
  immutables?: {
    [id: string]: string;
  };
  cborAuxdata?: {
    [id: string]: string;
  };
}

// returns the full bytecode with the call protection replaced with the real address
export function extractCallProtectionTransformation(
  populatedRecompiledBytecode: string,
  onchainRuntimeBytecode: string,
) {
  const transformations: Transformation[] = [];
  const transformationValues: TransformationValues = {};
  const template = populatedRecompiledBytecode;
  const real = onchainRuntimeBytecode;

  const push20CodeOp = '73';
  const callProtection = `0x${push20CodeOp}${'00'.repeat(20)}`;

  if (template.startsWith(callProtection)) {
    const replacedCallProtection = real.slice(0, 0 + callProtection.length);
    const callProtectionAddress = replacedCallProtection.slice(4); // remove 0x73
    transformations.push(CallProtectionTransformation());
    transformationValues.callProtection = '0x' + callProtectionAddress;

    return {
      populatedRecompiledBytecode:
        replacedCallProtection + template.substring(callProtection.length),
      transformations,
      transformationValues,
    };
  }
  return {
    populatedRecompiledBytecode: template,
    transformations,
    transformationValues,
  };
}

/**
 * Replaces the values of the immutable variables in the (onchain) deployed bytecode with zeros, so that the bytecode can be compared with the (offchain) recompiled bytecode.
 * Easier this way because we can simply replace with zeros
 * Example immutableReferences: {"97":[{"length":32,"start":137}],"99":[{"length":32,"start":421}]} where 97 and 99 are the AST ids
 */
export function extractImmutablesTransformation(
  populatedRecompiledBytecodeWith0x: string,
  onchainRuntimeBytecodeWith0x: string,
  immutableReferences: ImmutableReferences,
  auxdataStyle: AuxdataStyle,
) {
  const transformations: Transformation[] = [];
  const transformationValues: TransformationValues = {};
  // Remove "0x" from the beginning of both bytecodes.
  const onchainRuntimeBytecode = onchainRuntimeBytecodeWith0x.slice(2);
  let populatedRecompiledBytecode = populatedRecompiledBytecodeWith0x.slice(2);

  Object.keys(immutableReferences).forEach((astId) => {
    immutableReferences[astId].forEach((reference) => {
      const { start, length } = reference;

      // Save the transformation
      transformations.push(
        ImmutablesTransformation(
          start,
          astId,
          auxdataStyle === AuxdataStyle.SOLIDITY ? 'replace' : 'insert',
        ),
      );

      // Extract the immutable value from the onchain bytecode.
      const immutableValue = onchainRuntimeBytecode.slice(
        start * 2,
        start * 2 + length * 2,
      );

      // Save the transformation value
      if (transformationValues.immutables === undefined) {
        transformationValues.immutables = {};
      }
      transformationValues.immutables[astId] = `0x${immutableValue}`;

      if (auxdataStyle === AuxdataStyle.SOLIDITY) {
        // Replace the placeholder in the recompiled bytecode with the onchain immutable value.
        populatedRecompiledBytecode =
          populatedRecompiledBytecode.slice(0, start * 2) +
          immutableValue +
          populatedRecompiledBytecode.slice(start * 2 + length * 2);
      } else if (auxdataStyle === AuxdataStyle.VYPER) {
        // For Vyper, insert the immutable value.
        populatedRecompiledBytecode =
          populatedRecompiledBytecode + immutableValue;
      }
    });
  });
  return {
    populatedRecompiledBytecode: '0x' + populatedRecompiledBytecode,
    transformations,
    transformationValues,
  };
}

export function extractAbiEncodedConstructorArguments(
  populatedRecompiledBytecode: string,
  onchainCreationBytecode: string,
) {
  if (onchainCreationBytecode.length === populatedRecompiledBytecode.length)
    return undefined;

  return (
    '0x' + onchainCreationBytecode.slice(populatedRecompiledBytecode.length)
  );
}

export function extractConstructorArgumentsTransformation(
  populatedRecompiledBytecode: string,
  onchainCreationBytecode: string,
  metadata: Metadata,
) {
  const transformations: Transformation[] = [];
  const transformationValues: TransformationValues = {};
  const abiEncodedConstructorArguments = extractAbiEncodedConstructorArguments(
    populatedRecompiledBytecode,
    onchainCreationBytecode,
  );
  const constructorAbiParamInputs = (
    metadata?.output?.abi?.find(
      (param) => param.type === 'constructor',
    ) as AbiConstructor
  )?.inputs as ParamType[];
  if (abiEncodedConstructorArguments) {
    if (!constructorAbiParamInputs) {
      throw new Error(
        `Failed to match with creation bytecode: constructor ABI Inputs are missing`,
      );
    }
    // abiCoder doesn't break if called with a wrong `abiEncodedConstructorArguments`
    // so in order to successfuly check if the constructor arguments actually match
    // we need to re-encode it and compare them
    const decodeResult = abiCoder.decode(
      constructorAbiParamInputs,
      abiEncodedConstructorArguments,
    );
    const encodeResult = abiCoder.encode(
      constructorAbiParamInputs,
      decodeResult,
    );
    if (encodeResult !== abiEncodedConstructorArguments) {
      throw new Error(
        `Failed to match with creation bytecode: constructor arguments ABI decoding failed ${encodeResult} vs ${abiEncodedConstructorArguments}`,
      );
    }

    transformations.push(
      ConstructorTransformation(
        populatedRecompiledBytecode.substring(2).length / 2,
      ),
    );
    transformationValues.constructorArguments = abiEncodedConstructorArguments;
  }
  return {
    populatedRecompiledBytecode: '0x' + populatedRecompiledBytecode,
    transformations,
    transformationValues,
  };
}

export function extractLibrariesTransformation(
  template: string,
  real: string,
  linkReferences: LinkReferences,
) {
  const transformations: Transformation[] = [];
  const transformationValues: TransformationValues = {};
  const libraryMap: StringMap = {};
  for (const file in linkReferences) {
    for (const lib in linkReferences[file]) {
      for (const linkRefObj of linkReferences[file][lib]) {
        const fqn = `${file}:${lib}`; // Fully Qualified (FQ) name

        const { start, length } = linkRefObj;
        const strStart = start * 2 + 2; // Each byte 2 chars and +2 for 0x
        const strLength = length * 2;
        const placeholder = template.slice(strStart, strStart + strLength);

        // slice(2) removes 0x
        const calculatedPlaceholder =
          '__$' + keccak256Str(fqn).slice(2).slice(0, 34) + '$__';
        // Placeholder format was different pre v0.5.0 https://docs.soliditylang.org/en/v0.4.26/contracts.html#libraries
        const trimmedFQN = fqn.slice(0, 36); // in case the fqn is too long
        const calculatedPreV050Placeholder = '__' + trimmedFQN.padEnd(38, '_');

        // We support the placeholder to be zeroed out to accept bytecodes coming from the DB
        // (In our database we store bytecodes with the placeholder zeroed out)
        const calculatedZeroedPlaceholder = '0'.repeat(40);

        if (
          !(
            placeholder === calculatedPlaceholder ||
            placeholder === calculatedPreV050Placeholder ||
            placeholder === calculatedZeroedPlaceholder
          )
        )
          throw new Error(
            `Library placeholder mismatch: ${placeholder} vs ${calculatedPlaceholder} or ${calculatedPreV050Placeholder}`,
          );

        const address = real.slice(strStart, strStart + strLength);
        libraryMap[placeholder] = address;

        // Replace the specific occurrence of the placeholder
        template =
          template.slice(0, strStart) +
          address +
          template.slice(strStart + strLength);

        transformations.push(LibraryTransformation(start, fqn));

        if (!transformationValues.libraries) {
          transformationValues.libraries = {};
        }
        // Prepend the library addresses with "0x", this is the format for the DB. FS library-map is without "0x"
        transformationValues.libraries[fqn] = '0x' + address;
      }
    }
  }

  return {
    populatedRecompiledBytecode: template,
    libraryMap,
    transformations,
    transformationValues,
  };
}

export function extractAuxdataTransformation(
  recompiledBytecode: string,
  onchainBytecode: string,
  cborAuxdataPositions: CompiledContractCborAuxdata,
) {
  try {
    let populatedRecompiledBytecode = recompiledBytecode;
    const transformations: Transformation[] = [];
    const transformationValues: TransformationValues = {};
    // Instead of normalizing the onchain bytecode, we use its auxdata values to replace the corresponding sections in the recompiled bytecode.
    Object.values(cborAuxdataPositions).forEach((auxdataValues, index) => {
      const offsetStart = auxdataValues.offset * 2 + 2;
      const offsetEnd =
        auxdataValues.offset * 2 + 2 + auxdataValues.value.length - 2;
      // Instead of zeroing out this segment, get the value from the onchain bytecode.
      const onchainAuxdata = onchainBytecode.slice(offsetStart, offsetEnd);
      populatedRecompiledBytecode =
        populatedRecompiledBytecode.slice(0, offsetStart) +
        onchainAuxdata +
        populatedRecompiledBytecode.slice(offsetEnd);
      const transformationIndex = `${index + 1}`;
      transformations.push(
        AuxdataTransformation(auxdataValues.offset, transformationIndex),
      );
      if (!transformationValues.cborAuxdata) {
        transformationValues.cborAuxdata = {};
      }
      transformationValues.cborAuxdata[transformationIndex] =
        `0x${onchainAuxdata}`;
    });
    return {
      populatedRecompiledBytecode,
      transformations,
      transformationValues,
    };
  } catch (error: any) {
    logError('Cannot populate bytecodes with the auxdata', { error });
    throw new Error('Cannot populate bytecodes with the auxdata');
  }
}
