/**
 * Given bytecode as a Buffer, parse the blueprint preamble and
 * deconstruct the bytecode into:
 *   the ERC version, preamble data and initCode.
 * Throws an exception if the bytecode is not a valid blueprint contract
 * according to this ERC.
 *
 * @param {Buffer} bytecode - A Buffer representing the bytecode
 * @returns {Object} {ercVersion, preambleData, initCode}
 *   - ercVersion: number
 *   - preambleData: null if <length encoding bits> is 0, otherwise Buffer of the data section
 *   - initCode: Buffer of the initCode
 *
 *  Example usage:
 *  const bytecode = Buffer.from('fe710c03010203aabbcc', 'hex');
 *  const result = parseBlueprintPreamble(bytecode);
 *  console.log(result);
 */
export function parseBlueprintPreamble(bytecode: Buffer): {
  ercVersion: number;
  preambleData: Buffer | null;
  initCode: Buffer;
} {
  // Check blueprint magic bytes
  if (bytecode.length < 2 || bytecode[0] !== 0xfe || bytecode[1] !== 0x71) {
    throw new Error("Not a blueprint!");
  }

  if (bytecode.length < 3) {
    throw new Error("Incomplete blueprint header");
  }

  const thirdByte = bytecode[2];
  const ercVersion = (thirdByte & 0b11111100) >> 2;

  const nLengthBytes = thirdByte & 0b11;
  if (nLengthBytes === 0b11) {
    throw new Error("Reserved bits are set");
  }

  let dataLength = 0;
  let preambleData = null;
  let dataStart = 3;

  if (nLengthBytes > 0) {
    if (bytecode.length < 3 + nLengthBytes) {
      throw new Error("Incomplete length field");
    }

    dataLength = bytecode.readUIntBE(3, nLengthBytes);
    dataStart = 3 + nLengthBytes;

    if (bytecode.length < dataStart + dataLength) {
      throw new Error("Incomplete data section");
    }

    preambleData = bytecode.slice(dataStart, dataStart + dataLength);
  }

  const initCodeStart = dataStart + dataLength;
  if (bytecode.length <= initCodeStart) {
    throw new Error("Empty initCode!");
  }

  const initCode = bytecode.slice(initCodeStart);

  return { ercVersion, preambleData, initCode };
}

/**
 * Example usage:
 * const initcode = Buffer.from('...your initcode bytecode...', 'hex');
 * const deployerBytecode = blueprintDeployerBytecode(initcode);
 * console.log(deployerBytecode.toString('hex'));
 */
export function blueprintDeployerBytecode(initcode: Buffer) {
  // ERC5202 preamble (0xFE7100)
  const blueprintPreamble = Buffer.from("fe7100", "hex");
  const blueprintBytecode = Buffer.concat([blueprintPreamble, initcode]);

  // get bytecode length(2byte in big endian)
  const lenBytes = Buffer.alloc(2);
  lenBytes.writeUInt16BE(blueprintBytecode.length, 0);

  // build deploy bytecode
  // opcode explain:
  // 0x61 PUSH2 <len> - push len into stack
  // 0x3d RETURNDATASIZE - return data size(0)
  // 0x81 DUP2 - copy lenth
  // 0x60 0x0a PUSH1 0x0a - push code start pos(10bytes)
  // 0x3d RETURNDATASIZE - retrun data size(0)
  // 0x39 CODECOPY - copy code mem
  // 0xf3 RETURN - return code in mem
  const deployOpcodes = Buffer.concat([
    Buffer.from("61", "hex"), // PUSH2
    lenBytes,
    Buffer.from("3d81", "hex"), // RETURNDATASIZE DUP2
    Buffer.from("600a", "hex"), // PUSH1 10
    Buffer.from("3d39", "hex"), // RETURNDATASIZE CODECOPY
    Buffer.from("f3", "hex"), // RETURN
  ]);

  return Buffer.concat([deployOpcodes, blueprintBytecode]);
}
