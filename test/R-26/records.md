# base
- record `"a"` `1` `"b"` `2`
# sym-key
- record
  - mial
    - k
  - `1`
# odd
- record `"a"` `1` `"b"`
# bad-key
- record `1` `2`
# empty
- call record
# g
- * r k
- get r k
# p
- * r k v
- put r k v
# h
- * r k
- has? r k
# ks
- r
- keys r
# nomut
- let
  - vars
    - r
      - record `"a"` `1`
    - s
      - put r `"a"` `2`
  - list
    - get r `"a"`
    - get s `"a"`
# quoted
- mial
  - record
    - food `0.5`
    - water `0.25`
# read-quoted
- get
  - call quoted
  - `"water"`
