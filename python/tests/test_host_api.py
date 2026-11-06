"""Host-facing behaviour the shared corpus can't express: it goes through Python host values."""

import math

import pytest

import mial as M


@pytest.mark.parametrize("n", [math.nan, math.inf, -math.inf])
def test_non_finite_numbers_become_errors(n):
    assert M.show(M.num(n)) == "<error: num: non-finite number>"
    assert M.show(M.from_plain(n)) == "<error: num: non-finite number>"


def test_from_plain_rejects_non_string_keys():
    with pytest.raises(TypeError, match="from_plain: object keys must be strings"):
        M.from_plain({1: 2})
