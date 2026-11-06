# tag-tree
- tag
  - mial
    - + `1` `2`
# tag-list
- tag
  - list `1`
# tag-lit
- tag `5`
# kids
- children
  - mial
    - + `1` `2`
# kids-atom
- children `5`
# make-str
- make-mial `"*"`
  - list `2` `3`
# make-sym
- make-mial
  - mial
    - foo
  - list `1`
# make-null-kids
- make-mial `"x"` `null`
# make-num
- make-mial `5` `null`
# make-bad
- make-mial `"x"` `5`
# surgery
- eval
  - make-mial `"*"`
    - children
      - mial
        - + `2` `3`
# roundtrip
- let
  - vars
    - x
      - mial
        - f `1`
          - g `2`
  - eq x
    - make-mial
      - tag x
      - children x
# one-body
- `1`
- `2`
# single
- + `1` `2`
# with-param
- x
- + x `1`
# with-params
- * a b
- + a b
# of-one-body
- mial-of one-body
# of-single
- mial-of single
# of-param
- mial-of with-param
# of-params
- mial-of with-params
# of-builtin
- mial-of +
# of-data
- mial-of `5`
# of-rerun
- eval
  - mial-of single
