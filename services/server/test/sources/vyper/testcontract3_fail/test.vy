# @version >=0.3.2

# @notice Simple greeting contract

# @notice Returns the string "Hello Vyper!"
# @notice The @external decorator means this function can only be called by external parties ie. by other contracts or by a wallet making a transaction
# @notice The @view decorator means that this function can read the contract state but not alter it. Cannot consume gas.
@external
@view
def helloWorld() -> String[24]:
    error_in_the_code!
    return "Hello Vyper!"
