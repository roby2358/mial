# lt
- * a b
- < a b
# le
- * a b
- <= a b
# gt
- * a b
- > a b
# ge
- * a b
- >= a b
# eq2
- * a b
- eq a b
# ne2
- * a b
- != a b
# str-str
- <= `"a"` `"b"`
# gt-null
- > `1` `null`
# sym-str
- eq
  - mial
    - foo
  - `"foo"`
# sym-sym
- eq
  - mial
    - foo
  - mial
    - foo
# deep
- eq
  - list `1`
    - list `2` `"x"`
  - list `1`
    - list `2` `"x"`
# deep-diff
- eq
  - list `1`
  - list `2`
# tree-label
- eq
  - mial
    - + `1`
  - mial
    - - `1`
# zero-negzero
- eq `0`
  - - `0`
# same-fn
- eq lt lt
# diff-fn
- eq lt le
# same-builtin
- eq + +
# diff-builtin
- != + -
# null-empty
- eq `null`
  - call list
