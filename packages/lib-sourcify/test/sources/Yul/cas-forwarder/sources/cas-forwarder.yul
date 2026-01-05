// SPDX-License-Identifier: MIT
object "cas-forwarder" {
    code {
        datacopy(0, dataoffset("runtime"), datasize("runtime"))
        return(0, datasize("runtime"))
    }
    object "runtime" {
        code {
            let targetAddress := shr(96, calldataload(0))
            let codeSize := extcodesize(targetAddress)
            extcodecopy(targetAddress, 0, 0, codeSize)
            
            let success := call(gas(), 0xcA11bde05977b3631167028862bE2a173976CA11, 0, 0, codeSize, 0, 0)
            
            let returnSize := returndatasize()
            returndatacopy(0, 0, returnSize)
            
            switch success
            case 0 {
                revert(0, returnSize)
            }
            default {
                return(0, returnSize)
            }
        }
    }
}
