# pragma version ^0.4.0

OWNER: public(immutable(address))
MY_IMMUTABLE: public(immutable(uint256))
MY_IMMUTABLE_2: public(immutable(uint256))

@deploy
def __init__(val: uint256):
    OWNER = msg.sender
    MY_IMMUTABLE = val
    MY_IMMUTABLE_2 = 66612412897398127


@external
@view
def get_my_immutable() -> uint256:
  return MY_IMMUTABLE