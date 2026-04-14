# pragma version ~=0.4.0

a: public(uint256)
b: public(uint256)

@deploy
def __init__():
    self.a = 1
    self.b = 2

@external
@view
def get_a() -> uint256:
    return self.a

@external
@view
def get_b() -> uint256:
    return self.b
