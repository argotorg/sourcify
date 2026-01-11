// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.23;

/**
 * @title CreateX Factory Smart Contract
 * @author pcaversaccio (https://web.archive.org/web/20230921103111/https://pcaversaccio.com/)
 * @custom:coauthor Matt Solomon (https://web.archive.org/web/20230921103335/https://mattsolomon.dev/)
 * @notice Factory smart contract to make easier and safer usage of the
 * `CREATE` (https://web.archive.org/web/20230921103540/https://www.evm.codes/#f0?fork=shanghai) and `CREATE2`
 * (https://web.archive.org/web/20230921103540/https://www.evm.codes/#f5?fork=shanghai) EVM opcodes as well as of
 * `CREATE3`-based (https://web.archive.org/web/20230921103920/https://github.com/ethereum/EIPs/pull/3171) contract creations.
 * @dev To simplify testing of non-public variables and functions, we use the `internal`
 * function visibility specifier `internal` for all variables and functions, even though
 * they could technically be `private` since we do not expect anyone to inherit from
 * the `CreateX` contract.
 * @custom:security-contact See https://web.archive.org/web/20230921105029/https://raw.githubusercontent.com/pcaversaccio/createx/main/SECURITY.md.
 */
contract CreateX {
    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                         IMMUTABLES                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @dev Caches the contract address at construction, to be used for the custom errors.
     */
    address internal immutable _SELF = address(this);

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                            TYPES                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @dev Struct for the `payable` amounts in a deploy-and-initialise call.
     */
    struct Values {
        uint256 constructorAmount;
        uint256 initCallAmount;
    }

    /**
     * @dev Enum for the selection of a permissioned deploy protection.
     */
    enum SenderBytes {
        MsgSender,
        ZeroAddress,
        Random
    }

    /**
     * @dev Enum for the selection of a cross-chain redeploy protection.
     */
    enum RedeployProtectionFlag {
        True,
        False,
        Unspecified
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                           EVENTS                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @dev Event that is emitted when a contract is successfully created.
     * @param newContract The address of the new contract.
     * @param salt The 32-byte random value used to create the contract address.
     */
    event ContractCreation(address indexed newContract, bytes32 indexed salt);

    /**
     * @dev Event that is emitted when a contract is successfully created.
     * @param newContract The address of the new contract.
     */
    event ContractCreation(address indexed newContract);

    /**
     * @dev Event that is emitted when a `CREATE3` proxy contract is successfully created.
     * @param newContract The address of the new proxy contract.
     * @param salt The 32-byte random value used to create the proxy address.
     */
    event Create3ProxyContractCreation(address indexed newContract, bytes32 indexed salt);

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        CUSTOM ERRORS                       */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @dev Error that occurs when the contract creation failed.
     * @param emitter The contract that emits the error.
     */
    error FailedContractCreation(address emitter);

    /**
     * @dev Error that occurs when the contract initialisation call failed.
     * @param emitter The contract that emits the error.
     * @param revertData The data returned by the failed initialisation call.
     */
    error FailedContractInitialisation(address emitter, bytes revertData);

    /**
     * @dev Error that occurs when the salt value is invalid.
     * @param emitter The contract that emits the error.
     */
    error InvalidSalt(address emitter);

    /**
     * @dev Error that occurs when the nonce value is invalid.
     * @param emitter The contract that emits the error.
     */
    error InvalidNonceValue(address emitter);

    /**
     * @dev Error that occurs when transferring ether has failed.
     * @param emitter The contract that emits the error.
     * @param revertData The data returned by the failed ether transfer.
     */
    error FailedEtherTransfer(address emitter, bytes revertData);

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                           CREATE                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @dev Deploys a new contract via calling the `CREATE` opcode and using the creation
     * bytecode `initCode` and `msg.value` as inputs. In order to save deployment costs,
     * we do not sanity check the `initCode` length. Note that if `msg.value` is non-zero,
     * `initCode` must have a `payable` constructor.
     * @param initCode The creation bytecode.
     * @return newContract The 20-byte address where the contract was deployed.
     */
    function deployCreate(bytes memory initCode) public payable returns (address newContract) {
        assembly ("memory-safe") {
            newContract := create(callvalue(), add(initCode, 0x20), mload(initCode))
        }
        _requireSuccessfulContractCreation({newContract: newContract});
        emit ContractCreation({newContract: newContract});
    }

    /**
     * @dev Deploys and initialises a new contract via calling the `CREATE` opcode and using the
     * creation bytecode `initCode`, the initialisation code `data`, the struct for the `payable`
     * amounts `values`, the refund address `refundAddress`, and `msg.value` as inputs. In order to
     * save deployment costs, we do not sanity check the `initCode` length. Note that if `values.constructorAmount`
     * is non-zero, `initCode` must have a `payable` constructor.
     * @param initCode The creation bytecode.
     * @param data The initialisation code that is passed to the deployed contract.
     * @param values The specific `payable` amounts for the deployment and initialisation call.
     * @param refundAddress The 20-byte address where any excess ether is returned to.
     * @return newContract The 20-byte address where the contract was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     */
    function deployCreateAndInit(
        bytes memory initCode,
        bytes memory data,
        Values memory values,
        address refundAddress
    ) public payable returns (address newContract) {
        assembly ("memory-safe") {
            newContract := create(mload(values), add(initCode, 0x20), mload(initCode))
        }
        _requireSuccessfulContractCreation({newContract: newContract});
        emit ContractCreation({newContract: newContract});

        (bool success, bytes memory returnData) = newContract.call{value: values.initCallAmount}(data);
        if (!success) {
            revert FailedContractInitialisation({emitter: _SELF, revertData: returnData});
        }

        if (_SELF.balance != 0) {
            // Any wei amount previously forced into this contract (e.g. by using the `SELFDESTRUCT`
            // opcode) will be part of the refund transaction.
            (success, returnData) = refundAddress.call{value: _SELF.balance}("");
            if (!success) {
                revert FailedEtherTransfer({emitter: _SELF, revertData: returnData});
            }
        }
    }

    /**
     * @dev Deploys and initialises a new contract via calling the `CREATE` opcode and using the
     * creation bytecode `initCode`, the initialisation code `data`, the struct for the `payable`
     * amounts `values`, and `msg.value` as inputs. In order to save deployment costs, we do not
     * sanity check the `initCode` length. Note that if `values.constructorAmount` is non-zero,
     * `initCode` must have a `payable` constructor, and any excess ether is returned to `msg.sender`.
     * @param initCode The creation bytecode.
     * @param data The initialisation code that is passed to the deployed contract.
     * @param values The specific `payable` amounts for the deployment and initialisation call.
     * @return newContract The 20-byte address where the contract was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     */
    function deployCreateAndInit(
        bytes memory initCode,
        bytes memory data,
        Values memory values
    ) public payable returns (address newContract) {
        newContract = deployCreateAndInit({initCode: initCode, data: data, values: values, refundAddress: msg.sender});
    }

    /**
     * @dev Deploys a new EIP-1167 minimal proxy contract using the `CREATE` opcode, and initialises
     * the implementation contract using the implementation address `implementation`, the initialisation
     * code `data`, and `msg.value` as inputs. Note that if `msg.value` is non-zero, the initialiser
     * function called via `data` must be `payable`.
     * @param implementation The 20-byte implementation contract address.
     * @param data The initialisation code that is passed to the deployed proxy contract.
     * @return proxy The 20-byte address where the clone was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     */
    function deployCreateClone(address implementation, bytes memory data) public payable returns (address proxy) {
        bytes20 implementationInBytes = bytes20(implementation);
        assembly ("memory-safe") {
            let clone := mload(0x40)
            mstore(
                clone,
                hex"3d_60_2d_80_60_0a_3d_39_81_f3_36_3d_3d_37_3d_3d_3d_36_3d_73_00_00_00_00_00_00_00_00_00_00_00_00"
            )
            mstore(add(clone, 0x14), implementationInBytes)
            mstore(
                add(clone, 0x28),
                hex"5a_f4_3d_82_80_3e_90_3d_91_60_2b_57_fd_5b_f3_00_00_00_00_00_00_00_00_00_00_00_00_00_00_00_00_00"
            )
            proxy := create(0, clone, 0x37)
        }
        if (proxy == address(0)) {
            revert FailedContractCreation({emitter: _SELF});
        }
        emit ContractCreation({newContract: proxy});

        (bool success, bytes memory returnData) = proxy.call{value: msg.value}(data);
        _requireSuccessfulContractInitialisation({
            success: success,
            returnData: returnData,
            implementation: implementation
        });
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via `deployer` using
     * the `CREATE` opcode. For the specification of the Recursive Length Prefix (RLP) encoding
     * scheme, please refer to p. 19 of the Ethereum Yellow Paper (https://web.archive.org/web/20230921110603/https://ethereum.github.io/yellowpaper/paper.pdf)
     * and the Ethereum Wiki (https://web.archive.org/web/20230921112807/https://ethereum.org/en/developers/docs/data-structures-and-encoding/rlp/).
     * For further insights also, see the following issue: https://web.archive.org/web/20230921112943/https://github.com/transmissions11/solmate/issues/207.
     *
     * Based on the EIP-161 (https://web.archive.org/web/20230921113207/https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-161.md) specification,
     * all contract accounts on the Ethereum mainnet are initiated with `nonce = 1`. Thus, the
     * first contract address created by another contract is calculated with a non-zero nonce.
     * @param deployer The 20-byte deployer address.
     * @param nonce The next 32-byte nonce of the deployer address.
     * @return computedAddress The 20-byte address where a contract will be stored.
     */
    function computeCreateAddress(address deployer, uint256 nonce) public view returns (address computedAddress) {
        bytes memory data;
        bytes1 len = bytes1(0x94);

        // The theoretical allowed limit, based on EIP-2681, for an account nonce is 2**64-2:
        // https://web.archive.org/web/20230921113252/https://eips.ethereum.org/EIPS/eip-2681.
        if (nonce > type(uint64).max - 1) {
            revert InvalidNonceValue({emitter: _SELF});
        }

        // The integer zero is treated as an empty byte string and therefore has only one length prefix,
        // 0x80, which is calculated via 0x80 + 0.
        if (nonce == 0x00) {
            data = abi.encodePacked(bytes1(0xd6), len, deployer, bytes1(0x80));
        }
        // A one-byte integer in the [0x00, 0x7f] range uses its own value as a length prefix, there is no
        // additional "0x80 + length" prefix that precedes it.
        else if (nonce <= 0x7f) {
            data = abi.encodePacked(bytes1(0xd6), len, deployer, uint8(nonce));
        }
        // In the case of `nonce > 0x7f` and `nonce <= type(uint8).max`, we have the following encoding scheme
        // (the same calculation can be carried over for higher nonce bytes):
        // 0xda = 0xc0 (short RLP prefix) + 0x1a (= the bytes length of: 0x94 + address + 0x84 + nonce, in hex),
        // 0x94 = 0x80 + 0x14 (= the bytes length of an address, 20 bytes, in hex),
        // 0x84 = 0x80 + 0x04 (= the bytes length of the nonce, 4 bytes, in hex).
        else if (nonce <= type(uint8).max) {
            data = abi.encodePacked(bytes1(0xd7), len, deployer, bytes1(0x81), uint8(nonce));
        } else if (nonce <= type(uint16).max) {
            data = abi.encodePacked(bytes1(0xd8), len, deployer, bytes1(0x82), uint16(nonce));
        } else if (nonce <= type(uint24).max) {
            data = abi.encodePacked(bytes1(0xd9), len, deployer, bytes1(0x83), uint24(nonce));
        } else if (nonce <= type(uint32).max) {
            data = abi.encodePacked(bytes1(0xda), len, deployer, bytes1(0x84), uint32(nonce));
        } else if (nonce <= type(uint40).max) {
            data = abi.encodePacked(bytes1(0xdb), len, deployer, bytes1(0x85), uint40(nonce));
        } else if (nonce <= type(uint48).max) {
            data = abi.encodePacked(bytes1(0xdc), len, deployer, bytes1(0x86), uint48(nonce));
        } else if (nonce <= type(uint56).max) {
            data = abi.encodePacked(bytes1(0xdd), len, deployer, bytes1(0x87), uint56(nonce));
        } else {
            data = abi.encodePacked(bytes1(0xde), len, deployer, bytes1(0x88), uint64(nonce));
        }

        computedAddress = address(uint160(uint256(keccak256(data))));
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via this contract
     * using the `CREATE` opcode. For the specification of the Recursive Length Prefix (RLP)
     * encoding scheme, please refer to p. 19 of the Ethereum Yellow Paper (https://web.archive.org/web/20230921110603/https://ethereum.github.io/yellowpaper/paper.pdf)
     * and the Ethereum Wiki (https://web.archive.org/web/20230921112807/https://ethereum.org/en/developers/docs/data-structures-and-encoding/rlp/).
     * For further insights also, see the following issue: https://web.archive.org/web/20230921112943/https://github.com/transmissions11/solmate/issues/207.
     *
     * Based on the EIP-161 (https://web.archive.org/web/20230921113207/https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-161.md) specification,
     * all contract accounts on the Ethereum mainnet are initiated with `nonce = 1`. Thus, the
     * first contract address created by another contract is calculated with a non-zero nonce.
     * @param nonce The next 32-byte nonce of this contract.
     * @return computedAddress The 20-byte address where a contract will be stored.
     */
    function computeCreateAddress(uint256 nonce) public view returns (address computedAddress) {
        computedAddress = computeCreateAddress({deployer: _SELF, nonce: nonce});
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                           CREATE2                          */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @dev Deploys a new contract via calling the `CREATE2` opcode and using the salt value `salt`,
     * the creation bytecode `initCode`, and `msg.value` as inputs. In order to save deployment costs,
     * we do not sanity check the `initCode` length. Note that if `msg.value` is non-zero, `initCode`
     * must have a `payable` constructor.
     * @param salt The 32-byte random value used to create the contract address.
     * @param initCode The creation bytecode.
     * @return newContract The 20-byte address where the contract was deployed.
     */
    function deployCreate2(bytes32 salt, bytes memory initCode) public payable returns (address newContract) {
        bytes32 guardedSalt = _guard({salt: salt});
        assembly ("memory-safe") {
            newContract := create2(callvalue(), add(initCode, 0x20), mload(initCode), guardedSalt)
        }
        _requireSuccessfulContractCreation({newContract: newContract});
        emit ContractCreation({newContract: newContract, salt: guardedSalt});
    }

    /**
     * @dev Deploys a new contract via calling the `CREATE2` opcode and using the creation bytecode
     * `initCode` and `msg.value` as inputs. The salt value is calculated pseudo-randomly using a
     * diverse selection of block and transaction properties. This approach does not guarantee true
     * randomness! In order to save deployment costs, we do not sanity check the `initCode` length.
     * Note that if `msg.value` is non-zero, `initCode` must have a `payable` constructor.
     * @param initCode The creation bytecode.
     * @return newContract The 20-byte address where the contract was deployed.
     */
    function deployCreate2(bytes memory initCode) public payable returns (address newContract) {
        // Note that the safeguarding function `_guard` is called as part of the overloaded function
        // `deployCreate2`.
        newContract = deployCreate2({salt: _generateSalt(), initCode: initCode});
    }

    /**
     * @dev Deploys and initialises a new contract via calling the `CREATE2` opcode and using the
     * salt value `salt`, the creation bytecode `initCode`, the initialisation code `data`, the struct
     * for the `payable` amounts `values`, the refund address `refundAddress`, and `msg.value` as inputs.
     * In order to save deployment costs, we do not sanity check the `initCode` length. Note that if
     * `values.constructorAmount` is non-zero, `initCode` must have a `payable` constructor.
     * @param salt The 32-byte random value used to create the contract address.
     * @param initCode The creation bytecode.
     * @param data The initialisation code that is passed to the deployed contract.
     * @param values The specific `payable` amounts for the deployment and initialisation call.
     * @param refundAddress The 20-byte address where any excess ether is returned to.
     * @return newContract The 20-byte address where the contract was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     */
    function deployCreate2AndInit(
        bytes32 salt,
        bytes memory initCode,
        bytes memory data,
        Values memory values,
        address refundAddress
    ) public payable returns (address newContract) {
        bytes32 guardedSalt = _guard({salt: salt});
        assembly ("memory-safe") {
            newContract := create2(mload(values), add(initCode, 0x20), mload(initCode), guardedSalt)
        }
        _requireSuccessfulContractCreation({newContract: newContract});
        emit ContractCreation({newContract: newContract, salt: guardedSalt});

        (bool success, bytes memory returnData) = newContract.call{value: values.initCallAmount}(data);
        if (!success) {
            revert FailedContractInitialisation({emitter: _SELF, revertData: returnData});
        }

        if (_SELF.balance != 0) {
            // Any wei amount previously forced into this contract (e.g. by using the `SELFDESTRUCT`
            // opcode) will be part of the refund transaction.
            (success, returnData) = refundAddress.call{value: _SELF.balance}("");
            if (!success) {
                revert FailedEtherTransfer({emitter: _SELF, revertData: returnData});
            }
        }
    }

    /**
     * @dev Deploys and initialises a new contract via calling the `CREATE2` opcode and using the
     * salt value `salt`, creation bytecode `initCode`, the initialisation code `data`, the struct for
     * the `payable` amounts `values`, and `msg.value` as inputs. In order to save deployment costs,
     * we do not sanity check the `initCode` length. Note that if `values.constructorAmount` is non-zero,
     * `initCode` must have a `payable` constructor, and any excess ether is returned to `msg.sender`.
     * @param salt The 32-byte random value used to create the contract address.
     * @param initCode The creation bytecode.
     * @param data The initialisation code that is passed to the deployed contract.
     * @param values The specific `payable` amounts for the deployment and initialisation call.
     * @return newContract The 20-byte address where the contract was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     */
    function deployCreate2AndInit(
        bytes32 salt,
        bytes memory initCode,
        bytes memory data,
        Values memory values
    ) public payable returns (address newContract) {
        // Note that the safeguarding function `_guard` is called as part of the overloaded function
        // `deployCreate2AndInit`.
        newContract = deployCreate2AndInit({
            salt: salt,
            initCode: initCode,
            data: data,
            values: values,
            refundAddress: msg.sender
        });
    }

    /**
     * @dev Deploys and initialises a new contract via calling the `CREATE2` opcode and using the
     * creation bytecode `initCode`, the initialisation code `data`, the struct for the `payable`
     * amounts `values`, the refund address `refundAddress`, and `msg.value` as inputs. The salt value
     * is calculated pseudo-randomly using a diverse selection of block and transaction properties.
     * This approach does not guarantee true randomness! In order to save deployment costs, we do not
     * sanity check the `initCode` length. Note that if `values.constructorAmount` is non-zero, `initCode`
     * must have a `payable` constructor.
     * @param initCode The creation bytecode.
     * @param data The initialisation code that is passed to the deployed contract.
     * @param values The specific `payable` amounts for the deployment and initialisation call.
     * @param refundAddress The 20-byte address where any excess ether is returned to.
     * @return newContract The 20-byte address where the contract was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     */
    function deployCreate2AndInit(
        bytes memory initCode,
        bytes memory data,
        Values memory values,
        address refundAddress
    ) public payable returns (address newContract) {
        // Note that the safeguarding function `_guard` is called as part of the overloaded function
        // `deployCreate2AndInit`.
        newContract = deployCreate2AndInit({
            salt: _generateSalt(),
            initCode: initCode,
            data: data,
            values: values,
            refundAddress: refundAddress
        });
    }

    /**
     * @dev Deploys and initialises a new contract via calling the `CREATE2` opcode and using the
     * creation bytecode `initCode`, the initialisation code `data`, the struct for the `payable` amounts
     * `values`, and `msg.value` as inputs. The salt value is calculated pseudo-randomly using a
     * diverse selection of block and transaction properties. This approach does not guarantee true
     * randomness! In order to save deployment costs, we do not sanity check the `initCode` length.
     * Note that if `values.constructorAmount` is non-zero, `initCode` must have a `payable` constructor,
     * and any excess ether is returned to `msg.sender`.
     * @param initCode The creation bytecode.
     * @param data The initialisation code that is passed to the deployed contract.
     * @param values The specific `payable` amounts for the deployment and initialisation call.
     * @return newContract The 20-byte address where the contract was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     */
    function deployCreate2AndInit(
        bytes memory initCode,
        bytes memory data,
        Values memory values
    ) public payable returns (address newContract) {
        // Note that the safeguarding function `_guard` is called as part of the overloaded function
        // `deployCreate2AndInit`.
        newContract = deployCreate2AndInit({
            salt: _generateSalt(),
            initCode: initCode,
            data: data,
            values: values,
            refundAddress: msg.sender
        });
    }

    /**
     * @dev Deploys a new EIP-1167 minimal proxy contract using the `CREATE2` opcode and the salt
     * value `salt`, and initialises the implementation contract using the implementation address
     * `implementation`, the initialisation code `data`, and `msg.value` as inputs. Note that if
     * `msg.value` is non-zero, the initialiser function called via `data` must be `payable`.
     * @param salt The 32-byte random value used to create the proxy contract address.
     * @param implementation The 20-byte implementation contract address.
     * @param data The initialisation code that is passed to the deployed proxy contract.
     * @return proxy The 20-byte address where the clone was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     */
    function deployCreate2Clone(
        bytes32 salt,
        address implementation,
        bytes memory data
    ) public payable returns (address proxy) {
        bytes32 guardedSalt = _guard({salt: salt});
        bytes20 implementationInBytes = bytes20(implementation);
        assembly ("memory-safe") {
            let clone := mload(0x40)
            mstore(
                clone,
                hex"3d_60_2d_80_60_0a_3d_39_81_f3_36_3d_3d_37_3d_3d_3d_36_3d_73_00_00_00_00_00_00_00_00_00_00_00_00"
            )
            mstore(add(clone, 0x14), implementationInBytes)
            mstore(
                add(clone, 0x28),
                hex"5a_f4_3d_82_80_3e_90_3d_91_60_2b_57_fd_5b_f3_00_00_00_00_00_00_00_00_00_00_00_00_00_00_00_00_00"
            )
            proxy := create2(0, clone, 0x37, guardedSalt)
        }
        if (proxy == address(0)) {
            revert FailedContractCreation({emitter: _SELF});
        }
        emit ContractCreation({newContract: proxy, salt: guardedSalt});

        (bool success, bytes memory returnData) = proxy.call{value: msg.value}(data);
        _requireSuccessfulContractInitialisation({
            success: success,
            returnData: returnData,
            implementation: implementation
        });
    }

    /**
     * @dev Deploys a new EIP-1167 minimal proxy contract using the `CREATE2` opcode and the salt
     * value `salt`, and initialises the implementation contract using the implementation address
     * `implementation`, the initialisation code `data`, and `msg.value` as inputs. The salt value is
     * calculated pseudo-randomly using a diverse selection of block and transaction properties. This
     * approach does not guarantee true randomness! Note that if `msg.value` is non-zero, the initialiser
     * function called via `data` must be `payable`.
     * @param implementation The 20-byte implementation contract address.
     * @param data The initialisation code that is passed to the deployed proxy contract.
     * @return proxy The 20-byte address where the clone was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     */
    function deployCreate2Clone(address implementation, bytes memory data) public payable returns (address proxy) {
        // Note that the safeguarding function `_guard` is called as part of the overloaded function
        // `deployCreate2Clone`.
        proxy = deployCreate2Clone({salt: _generateSalt(), implementation: implementation, data: data});
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via `deployer` using
     * the `CREATE2` opcode. Any change in the `initCodeHash` or `salt` values will result in a new
     * destination address. This implementation is based on OpenZeppelin:
     * https://web.archive.org/web/20230921113703/https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/181d518609a9f006fcb97af63e6952e603cf100e/contracts/utils/Create2.sol.
     * @param salt The 32-byte random value used to create the contract address.
     * @param initCodeHash The 32-byte bytecode digest of the contract creation bytecode.
     * @param deployer The 20-byte deployer address.
     * @return computedAddress The 20-byte address where a contract will be stored.
     */
    function computeCreate2Address(
        bytes32 salt,
        bytes32 initCodeHash,
        address deployer
    ) public pure returns (address computedAddress) {
        assembly ("memory-safe") {
            // |                      | ↓ ptr ...  ↓ ptr + 0x0B (start) ...  ↓ ptr + 0x20 ...  ↓ ptr + 0x40 ...   |
            // |----------------------|---------------------------------------------------------------------------|
            // | initCodeHash         |                                                        CCCCCCCCCCCCC...CC |
            // | salt                 |                                      BBBBBBBBBBBBB...BB                   |
            // | deployer             | 000000...0000AAAAAAAAAAAAAAAAAAA...AA                                     |
            // | 0xFF                 |            FF                                                             |
            // |----------------------|---------------------------------------------------------------------------|
            // | memory               | 000000...00FFAAAAAAAAAAAAAAAAAAA...AABBBBBBBBBBBBB...BBCCCCCCCCCCCCC...CC |
            // | keccak256(start, 85) |            ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑ |
            let ptr := mload(0x40)
            mstore(add(ptr, 0x40), initCodeHash)
            mstore(add(ptr, 0x20), salt)
            mstore(ptr, deployer)
            let start := add(ptr, 0x0b)
            mstore8(start, 0xff)
            computedAddress := keccak256(start, 85)
        }
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via this contract using
     * the `CREATE2` opcode. Any change in the `initCodeHash` or `salt` values will result in a new
     * destination address.
     * @param salt The 32-byte random value used to create the contract address.
     * @param initCodeHash The 32-byte bytecode digest of the contract creation bytecode.
     * @return computedAddress The 20-byte address where a contract will be stored.
     */
    function computeCreate2Address(bytes32 salt, bytes32 initCodeHash) public view returns (address computedAddress) {
        computedAddress = computeCreate2Address({salt: salt, initCodeHash: initCodeHash, deployer: _SELF});
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                           CREATE3                          */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @dev Deploys a new contract via employing the `CREATE3` pattern (i.e. without an initcode
     * factor) and using the salt value `salt`, the creation bytecode `initCode`, and `msg.value`
     * as inputs. In order to save deployment costs, we do not sanity check the `initCode` length.
     * Note that if `msg.value` is non-zero, `initCode` must have a `payable` constructor. This
     * implementation is based on Solmate:
     * https://web.archive.org/web/20230921113832/https://raw.githubusercontent.com/transmissions11/solmate/e8f96f25d48fe702117ce76c79228ca4f20206cb/src/utils/CREATE3.sol.
     * @param salt The 32-byte random value used to create the proxy contract address.
     * @param initCode The creation bytecode.
     * @return newContract The 20-byte address where the contract was deployed.
     * @custom:security We strongly recommend implementing a permissioned deploy protection by setting
     * the first 20 bytes equal to `msg.sender` in the `salt` to prevent maliciously intended frontrun
     * proxy deployments on other chains.
     */
    function deployCreate3(bytes32 salt, bytes memory initCode) public payable returns (address newContract) {
        bytes32 guardedSalt = _guard({salt: salt});
        bytes memory proxyChildBytecode = hex"67_36_3d_3d_37_36_3d_34_f0_3d_52_60_08_60_18_f3";
        address proxy;
        assembly ("memory-safe") {
            proxy := create2(0, add(proxyChildBytecode, 32), mload(proxyChildBytecode), guardedSalt)
        }
        if (proxy == address(0)) {
            revert FailedContractCreation({emitter: _SELF});
        }
        emit Create3ProxyContractCreation({newContract: proxy, salt: guardedSalt});

        newContract = computeCreate3Address({salt: guardedSalt});
        (bool success, ) = proxy.call{value: msg.value}(initCode);
        _requireSuccessfulContractCreation({success: success, newContract: newContract});
        emit ContractCreation({newContract: newContract});
    }

    /**
     * @dev Deploys a new contract via employing the `CREATE3` pattern (i.e. without an initcode
     * factor) and using the salt value `salt`, the creation bytecode `initCode`, and `msg.value`
     * as inputs. The salt value is calculated pseudo-randomly using a diverse selection of block
     * and transaction properties. This approach does not guarantee true randomness! In order to save
     * deployment costs, we do not sanity check the `initCode` length. Note that if `msg.value` is
     * non-zero, `initCode` must have a `payable` constructor. This implementation is based on Solmate:
     * https://web.archive.org/web/20230921113832/https://raw.githubusercontent.com/transmissions11/solmate/e8f96f25d48fe702117ce76c79228ca4f20206cb/src/utils/CREATE3.sol.
     * @param initCode The creation bytecode.
     * @return newContract The 20-byte address where the contract was deployed.
     */
    function deployCreate3(bytes memory initCode) public payable returns (address newContract) {
        // Note that the safeguarding function `_guard` is called as part of the overloaded function
        // `deployCreate3`.
        newContract = deployCreate3({salt: _generateSalt(), initCode: initCode});
    }

    /**
     * @dev Deploys and initialises a new contract via employing the `CREATE3` pattern (i.e. without
     * an initcode factor) and using the salt value `salt`, the creation bytecode `initCode`, the
     * initialisation code `data`, the struct for the `payable` amounts `values`, the refund address
     * `refundAddress`, and `msg.value` as inputs. In order to save deployment costs, we do not sanity
     * check the `initCode` length. Note that if `values.constructorAmount` is non-zero, `initCode` must
     * have a `payable` constructor. This implementation is based on Solmate:
     * https://web.archive.org/web/20230921113832/https://raw.githubusercontent.com/transmissions11/solmate/e8f96f25d48fe702117ce76c79228ca4f20206cb/src/utils/CREATE3.sol.
     * @param salt The 32-byte random value used to create the proxy contract address.
     * @param initCode The creation bytecode.
     * @param data The initialisation code that is passed to the deployed contract.
     * @param values The specific `payable` amounts for the deployment and initialisation call.
     * @param refundAddress The 20-byte address where any excess ether is returned to.
     * @return newContract The 20-byte address where the contract was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     * Furthermore, we strongly recommend implementing a permissioned deploy protection by setting
     * the first 20 bytes equal to `msg.sender` in the `salt` to prevent maliciously intended frontrun
     * proxy deployments on other chains.
     */
    function deployCreate3AndInit(
        bytes32 salt,
        bytes memory initCode,
        bytes memory data,
        Values memory values,
        address refundAddress
    ) public payable returns (address newContract) {
        bytes32 guardedSalt = _guard({salt: salt});
        bytes memory proxyChildBytecode = hex"67_36_3d_3d_37_36_3d_34_f0_3d_52_60_08_60_18_f3";
        address proxy;
        assembly ("memory-safe") {
            proxy := create2(0, add(proxyChildBytecode, 32), mload(proxyChildBytecode), guardedSalt)
        }
        if (proxy == address(0)) {
            revert FailedContractCreation({emitter: _SELF});
        }
        emit Create3ProxyContractCreation({newContract: proxy, salt: guardedSalt});

        newContract = computeCreate3Address({salt: guardedSalt});
        (bool success, ) = proxy.call{value: values.constructorAmount}(initCode);
        _requireSuccessfulContractCreation({success: success, newContract: newContract});
        emit ContractCreation({newContract: newContract});

        bytes memory returnData;
        (success, returnData) = newContract.call{value: values.initCallAmount}(data);
        if (!success) {
            revert FailedContractInitialisation({emitter: _SELF, revertData: returnData});
        }

        if (_SELF.balance != 0) {
            // Any wei amount previously forced into this contract (e.g. by using the `SELFDESTRUCT`
            // opcode) will be part of the refund transaction.
            (success, returnData) = refundAddress.call{value: _SELF.balance}("");
            if (!success) {
                revert FailedEtherTransfer({emitter: _SELF, revertData: returnData});
            }
        }
    }

    /**
     * @dev Deploys and initialises a new contract via employing the `CREATE3` pattern (i.e. without
     * an initcode factor) and using the salt value `salt`, the creation bytecode `initCode`, the
     * initialisation code `data`, the struct for the `payable` amounts `values`, and `msg.value` as
     * inputs. In order to save deployment costs, we do not sanity check the `initCode` length. Note
     * that if `values.constructorAmount` is non-zero, `initCode` must have a `payable` constructor,
     * and any excess ether is returned to `msg.sender`. This implementation is based on Solmate:
     * https://web.archive.org/web/20230921113832/https://raw.githubusercontent.com/transmissions11/solmate/e8f96f25d48fe702117ce76c79228ca4f20206cb/src/utils/CREATE3.sol.
     * @param salt The 32-byte random value used to create the proxy contract address.
     * @param initCode The creation bytecode.
     * @param data The initialisation code that is passed to the deployed contract.
     * @param values The specific `payable` amounts for the deployment and initialisation call.
     * @return newContract The 20-byte address where the contract was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     * Furthermore, we strongly recommend implementing a permissioned deploy protection by setting
     * the first 20 bytes equal to `msg.sender` in the `salt` to prevent maliciously intended frontrun
     * proxy deployments on other chains.
     */
    function deployCreate3AndInit(
        bytes32 salt,
        bytes memory initCode,
        bytes memory data,
        Values memory values
    ) public payable returns (address newContract) {
        // Note that the safeguarding function `_guard` is called as part of the overloaded function
        // `deployCreate3AndInit`.
        newContract = deployCreate3AndInit({
            salt: salt,
            initCode: initCode,
            data: data,
            values: values,
            refundAddress: msg.sender
        });
    }

    /**
     * @dev Deploys and initialises a new contract via employing the `CREATE3` pattern (i.e. without
     * an initcode factor) and using the creation bytecode `initCode`, the initialisation code `data`,
     * the struct for the `payable` amounts `values`, the refund address `refundAddress`, and `msg.value`
     * as inputs. The salt value is calculated pseudo-randomly using a diverse selection of block and
     * transaction properties. This approach does not guarantee true randomness! In order to save deployment
     * costs, we do not sanity check the `initCode` length. Note that if `values.constructorAmount` is non-zero,
     * `initCode` must have a `payable` constructor. This implementation is based on Solmate:
     * https://web.archive.org/web/20230921113832/https://raw.githubusercontent.com/transmissions11/solmate/e8f96f25d48fe702117ce76c79228ca4f20206cb/src/utils/CREATE3.sol.
     * @param initCode The creation bytecode.
     * @param data The initialisation code that is passed to the deployed contract.
     * @param values The specific `payable` amounts for the deployment and initialisation call.
     * @param refundAddress The 20-byte address where any excess ether is returned to.
     * @return newContract The 20-byte address where the contract was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     */
    function deployCreate3AndInit(
        bytes memory initCode,
        bytes memory data,
        Values memory values,
        address refundAddress
    ) public payable returns (address newContract) {
        // Note that the safeguarding function `_guard` is called as part of the overloaded function
        // `deployCreate3AndInit`.
        newContract = deployCreate3AndInit({
            salt: _generateSalt(),
            initCode: initCode,
            data: data,
            values: values,
            refundAddress: refundAddress
        });
    }

    /**
     * @dev Deploys and initialises a new contract via employing the `CREATE3` pattern (i.e. without
     * an initcode factor) and using the creation bytecode `initCode`, the initialisation code `data`,
     * the struct for the `payable` amounts `values`, `msg.value` as inputs. The salt value is calculated
     * pseudo-randomly using a diverse selection of block and transaction properties. This approach does
     * not guarantee true randomness! In order to save deployment costs, we do not sanity check the `initCode`
     * length. Note that if `values.constructorAmount` is non-zero, `initCode` must have a `payable` constructor,
     * and any excess ether is returned to `msg.sender`. This implementation is based on Solmate:
     * https://web.archive.org/web/20230921113832/https://raw.githubusercontent.com/transmissions11/solmate/e8f96f25d48fe702117ce76c79228ca4f20206cb/src/utils/CREATE3.sol.
     * @param initCode The creation bytecode.
     * @param data The initialisation code that is passed to the deployed contract.
     * @param values The specific `payable` amounts for the deployment and initialisation call.
     * @return newContract The 20-byte address where the contract was deployed.
     * @custom:security This function allows for reentrancy, however we refrain from adding
     * a mutex lock to keep it as use-case agnostic as possible. Please ensure at the protocol
     * level that potentially malicious reentrant calls do not affect your smart contract system.
     */
    function deployCreate3AndInit(
        bytes memory initCode,
        bytes memory data,
        Values memory values
    ) public payable returns (address newContract) {
        // Note that the safeguarding function `_guard` is called as part of the overloaded function
        // `deployCreate3AndInit`.
        newContract = deployCreate3AndInit({
            salt: _generateSalt(),
            initCode: initCode,
            data: data,
            values: values,
            refundAddress: msg.sender
        });
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via `deployer` using
     * the `CREATE3` pattern (i.e. without an initcode factor). Any change in the `salt` value will
     * result in a new destination address. This implementation is based on Solady:
     * https://web.archive.org/web/20230921114120/https://raw.githubusercontent.com/Vectorized/solady/1c1ac4ad9c8558001e92d8d1a7722ef67bec75df/src/utils/CREATE3.sol.
     * @param salt The 32-byte random value used to create the proxy contract address.
     * @param deployer The 20-byte deployer address.
     * @return computedAddress The 20-byte address where a contract will be stored.
     */
    function computeCreate3Address(bytes32 salt, address deployer) public pure returns (address computedAddress) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(0x00, deployer)
            mstore8(0x0b, 0xff)
            mstore(0x20, salt)
            mstore(
                0x40,
                hex"21_c3_5d_be_1b_34_4a_24_88_cf_33_21_d6_ce_54_2f_8e_9f_30_55_44_ff_09_e4_99_3a_62_31_9a_49_7c_1f"
            )
            mstore(0x14, keccak256(0x0b, 0x55))
            mstore(0x40, ptr)
            mstore(0x00, 0xd694)
            mstore8(0x34, 0x01)
            computedAddress := keccak256(0x1e, 0x17)
        }
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via this contract using
     * the `CREATE3` pattern (i.e. without an initcode factor). Any change in the `salt` value will
     * result in a new destination address. This implementation is based on Solady:
     * https://web.archive.org/web/20230921114120/https://raw.githubusercontent.com/Vectorized/solady/1c1ac4ad9c8558001e92d8d1a7722ef67bec75df/src/utils/CREATE3.sol.
     * @param salt The 32-byte random value used to create the proxy contract address.
     * @return computedAddress The 20-byte address where a contract will be stored.
     */
    function computeCreate3Address(bytes32 salt) public view returns (address computedAddress) {
        computedAddress = computeCreate3Address({salt: salt, deployer: _SELF});
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      HELPER FUNCTIONS                      */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @dev Implements different safeguarding mechanisms depending on the encoded values in the salt
     * (`||` stands for byte-wise concatenation):
     *   => salt (32 bytes) = 0xbebebebebebebebebebebebebebebebebebebebe||ff||1212121212121212121212
     *   - The first 20 bytes (i.e. `bebebebebebebebebebebebebebebebebebebebe`) may be used to
     *     implement a permissioned deploy protection by setting them equal to `msg.sender`,
     *   - The 21st byte (i.e. `ff`) may be used to implement a cross-chain redeploy protection by
     *     setting it equal to `0x01`,
     *   - The last random 11 bytes (i.e. `1212121212121212121212`) allow for 2**88 bits of entropy
     *     for mining a salt.
     * @param salt The 32-byte random value used to create the contract address.
     * @return guardedSalt The guarded 32-byte random value used to create the contract address.
     */
    function _guard(bytes32 salt) internal view returns (bytes32 guardedSalt) {
        (SenderBytes senderBytes, RedeployProtectionFlag redeployProtectionFlag) = _parseSalt({salt: salt});

        if (senderBytes == SenderBytes.MsgSender && redeployProtectionFlag == RedeployProtectionFlag.True) {
            // Configures a permissioned deploy protection as well as a cross-chain redeploy protection.
            guardedSalt = keccak256(abi.encode(msg.sender, block.chainid, salt));
        } else if (senderBytes == SenderBytes.MsgSender && redeployProtectionFlag == RedeployProtectionFlag.False) {
            // Configures solely a permissioned deploy protection.
            guardedSalt = _efficientHash({a: bytes32(uint256(uint160(msg.sender))), b: salt});
        } else if (senderBytes == SenderBytes.MsgSender) {
            // Reverts if the 21st byte is greater than `0x01` in order to enforce developer explicitness.
            revert InvalidSalt({emitter: _SELF});
        } else if (senderBytes == SenderBytes.ZeroAddress && redeployProtectionFlag == RedeployProtectionFlag.True) {
            // Configures solely a cross-chain redeploy protection. In order to prevent a pseudo-randomly
            // generated cross-chain redeploy protection, we enforce the zero address check for the first 20 bytes.
            guardedSalt = _efficientHash({a: bytes32(block.chainid), b: salt});
        } else if (
            senderBytes == SenderBytes.ZeroAddress && redeployProtectionFlag == RedeployProtectionFlag.Unspecified
        ) {
            // Reverts if the 21st byte is greater than `0x01` in order to enforce developer explicitness.
            revert InvalidSalt({emitter: _SELF});
        } else {
            // For the non-pseudo-random cases, the salt value `salt` is hashed to prevent the safeguard mechanisms
            // from being bypassed. Otherwise, the salt value `salt` is not modified.
            guardedSalt = (salt != _generateSalt()) ? keccak256(abi.encode(salt)) : salt;
        }
    }

    /**
     * @dev Returns the enum for the selection of a permissioned deploy protection as well as a
     * cross-chain redeploy protection.
     * @param salt The 32-byte random value used to create the contract address.
     * @return senderBytes The 8-byte enum for the selection of a permissioned deploy protection.
     * @return redeployProtectionFlag The 8-byte enum for the selection of a cross-chain redeploy
     * protection.
     */
    function _parseSalt(
        bytes32 salt
    ) internal view returns (SenderBytes senderBytes, RedeployProtectionFlag redeployProtectionFlag) {
        if (address(bytes20(salt)) == msg.sender && bytes1(salt[20]) == hex"01") {
            (senderBytes, redeployProtectionFlag) = (SenderBytes.MsgSender, RedeployProtectionFlag.True);
        } else if (address(bytes20(salt)) == msg.sender && bytes1(salt[20]) == hex"00") {
            (senderBytes, redeployProtectionFlag) = (SenderBytes.MsgSender, RedeployProtectionFlag.False);
        } else if (address(bytes20(salt)) == msg.sender) {
            (senderBytes, redeployProtectionFlag) = (SenderBytes.MsgSender, RedeployProtectionFlag.Unspecified);
        } else if (address(bytes20(salt)) == address(0) && bytes1(salt[20]) == hex"01") {
            (senderBytes, redeployProtectionFlag) = (SenderBytes.ZeroAddress, RedeployProtectionFlag.True);
        } else if (address(bytes20(salt)) == address(0) && bytes1(salt[20]) == hex"00") {
            (senderBytes, redeployProtectionFlag) = (SenderBytes.ZeroAddress, RedeployProtectionFlag.False);
        } else if (address(bytes20(salt)) == address(0)) {
            (senderBytes, redeployProtectionFlag) = (SenderBytes.ZeroAddress, RedeployProtectionFlag.Unspecified);
        } else if (bytes1(salt[20]) == hex"01") {
            (senderBytes, redeployProtectionFlag) = (SenderBytes.Random, RedeployProtectionFlag.True);
        } else if (bytes1(salt[20]) == hex"00") {
            (senderBytes, redeployProtectionFlag) = (SenderBytes.Random, RedeployProtectionFlag.False);
        } else {
            (senderBytes, redeployProtectionFlag) = (SenderBytes.Random, RedeployProtectionFlag.Unspecified);
        }
    }

    /**
     * @dev Returns the `keccak256` hash of `a` and `b` after concatenation.
     * @param a The first 32-byte value to be concatenated and hashed.
     * @param b The second 32-byte value to be concatenated and hashed.
     * @return hash The 32-byte `keccak256` hash of `a` and `b`.
     */
    function _efficientHash(bytes32 a, bytes32 b) internal pure returns (bytes32 hash) {
        assembly ("memory-safe") {
            mstore(0x00, a)
            mstore(0x20, b)
            hash := keccak256(0x00, 0x40)
        }
    }

    /**
     * @dev Generates pseudo-randomly a salt value using a diverse selection of block and
     * transaction properties.
     * @return salt The 32-byte pseudo-random salt value.
     */
    function _generateSalt() internal view returns (bytes32 salt) {
        unchecked {
            salt = keccak256(
                abi.encode(
                    // We don't use `block.number - 256` (the maximum value on the EVM) to accommodate
                    // any chains that may try to reduce the amount of available historical block hashes.
                    // We also don't subtract 1 to mitigate any risks arising from consecutive block
                    // producers on a PoS chain. Therefore, we use `block.number - 32` as a reasonable
                    // compromise, one we expect should work on most chains, which is 1 epoch on Ethereum
                    // mainnet. Please note that if you use this function between the genesis block and block
                    // number 31, the block property `blockhash` will return zero, but the returned salt value
                    // `salt` will still have a non-zero value due to the hashing characteristic and the other
                    // remaining properties.
                    blockhash(block.number - 32),
                    block.coinbase,
                    block.number,
                    block.timestamp,
                    block.prevrandao,
                    block.chainid,
                    msg.sender
                )
            );
        }
    }

    /**
     * @dev Ensures that `newContract` is a non-zero byte contract.
     * @param success The Boolean success condition.
     * @param newContract The 20-byte address where the contract was deployed.
     */
    function _requireSuccessfulContractCreation(bool success, address newContract) internal view {
        // Note that reverting if `newContract == address(0)` isn't strictly necessary here, as if
        // the deployment fails, `success == false` should already hold. However, since the `CreateX`
        // contract should be usable and safe on a wide range of chains, this check is cheap enough
        // that there is no harm in including it (security > gas optimisations). It can potentially
        // protect against unexpected chain behaviour or a hypothetical compiler bug that doesn't surface
        // the call success status properly.
        if (!success || newContract == address(0) || newContract.code.length == 0) {
            revert FailedContractCreation({emitter: _SELF});
        }
    }

    /**
     * @dev Ensures that `newContract` is a non-zero byte contract.
     * @param newContract The 20-byte address where the contract was deployed.
     */
    function _requireSuccessfulContractCreation(address newContract) internal view {
        if (newContract == address(0) || newContract.code.length == 0) {
            revert FailedContractCreation({emitter: _SELF});
        }
    }

    /**
     * @dev Ensures that the contract initialisation call to `implementation` has been successful.
     * @param success The Boolean success condition.
     * @param returnData The return data from the contract initialisation call.
     * @param implementation The 20-byte address where the implementation was deployed.
     */
    function _requireSuccessfulContractInitialisation(
        bool success,
        bytes memory returnData,
        address implementation
    ) internal view {
        if (!success || implementation.code.length == 0) {
            revert FailedContractInitialisation({emitter: _SELF, revertData: returnData});
        }
    }
}
