# @version 0.3.7

TARGET: immutable(address)


@external
def __init__(_target: address):
    TARGET = _target


@external
@view
def target() -> address:
    return TARGET
