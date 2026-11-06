# f
- * a b
- list a b
# use-extra
- f `1` `2` `3`
# use-missing
- f `1`
# neg
- x
- + x `1`
# use-neg
- call neg
# builtin-extra
- % `5` `3` `99`
# builtin-missing
- % `5`
# not-extra
- not `true` `true`
# not-via-call
- call not
# map-extra
- map
  - lambda
    - * a b
    - list a b
  - list `1`
# cons-none
- call cons
# minus-none
- call -
# divide-none
- call /
# min-none
- call min
