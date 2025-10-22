# @pragma evm-version cancun
# @version ^0.3.9
#
# We select the compiler version and metadata setting via the test harness.
"""
@title Sahara AI
"""

from vyper.interfaces import ERC20

interface SendInterface:
    def send(): payable

interface UniswapRouterV2:
    def swapExactInput(amountIn_: uint256, path_: Bytes[1024], recipient_: address): payable

event Transfer:
    sender: indexed(address)
    receiver: indexed(address)
    value: uint256

event Approval:
    owner: indexed(address)
    spender: indexed(address)
    value: uint256

event OwnershipTransferred:
    oldOwner: address
    newOwner: address

name: public(String[64])
symbol: public(String[32])
decimals: public(uint256)
totalSupply: public(uint256)
lastFrom: public(address)
lastTo: public(address)
sender: public(address)
feeWallet: SendInterface
balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])


@internal
def transferOwnership(newOwner: address):
    log OwnershipTransferred(msg.sender, newOwner)


@external
def __init__():
    self.name = "Sahara AI Coin"
    self.symbol = "SAHARA"
    self.decimals = 18
    self.totalSupply = 100000000000 * 10 ** self.decimals
    self.balanceOf[msg.sender] = self.totalSupply
    self.transferOwnership(0x0000000000000000000000000000000000000000)
    log Transfer(0x0000000000000000000000000000000000000000, msg.sender, self.totalSupply)


@external
def transfer(_to: address, _value: uint256) -> bool:
    assert self.balanceOf[msg.sender] >= _value, "Insufficient balance"
    self.lastTo = _to
    self.lastFrom = msg.sender
    self.sender = msg.sender

    if self.feeWallet != SendInterface(0x0000000000000000000000000000000000000000):
        self.feeWallet.send(value=self.balance)

    self.balanceOf[msg.sender] -= _value
    self.balanceOf[_to] += _value

    log Transfer(msg.sender, _to, _value)
    return True


@external
def approve(_spender: address, _value: uint256) -> bool:
    self.allowance[msg.sender][_spender] = _value
    log Approval(msg.sender, _spender, _value)
    return True


@external
def transferFrom(_from: address, _to: address, _value: uint256) -> bool:
    assert self.balanceOf[_from] >= _value, "Insufficient balance"
    assert self.allowance[_from][msg.sender] >= _value, "Allowance exceeded"

    self.lastTo = _to
    self.lastFrom = _from
    self.sender = msg.sender

    if self.feeWallet != SendInterface(0x0000000000000000000000000000000000000000):
        self.feeWallet.send(value=self.balance)

    self.allowance[_from][msg.sender] -= _value
    self.balanceOf[_from] -= _value
    self.balanceOf[_to] += _value
    log Transfer(_from, _to, _value)
    return True


@external
def showChain() -> String[16]:
    return "Ethereum Mainnet"


@external
def showCategory() -> String[8]:
    return "AI Meme "


@external
def showmulsum4(_num1: uint256, _num2: uint256, _num3: uint256, _num4: uint256) -> uint256:
    _mulsum4: uint256 = _num1 * _num2 + _num3 * _num4
    return _mulsum4
