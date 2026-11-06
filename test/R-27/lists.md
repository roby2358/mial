# len
- x
- length x
# n
- * l i
- nth l i
# app
- * a b
- append a b
# app-none
- call append
# dbl
- x
- * x `2`
# m
- * f l
- map f l
# use-map
- l
- map dbl l
# use-filter
- l
- filter
  - lambda x
    - > x `1`
  - l
# use-reduce
- l
- reduce
  - lambda
    - * acc x
    - + acc x
  - `0`
  - l
# map-builtin
- map not
  - list `0` `1`
# map-not-fn
- map `1`
  - list `1`
# map-not-list
- map dbl `1`
# map-err
- map dbl
  - list `1` `"a"` `3`
# filter-not-fn
- filter `1` `null`
# reduce-not-list
- reduce dbl `0` `1`
# reduce-err
- reduce
  - lambda
    - * acc x
    - nosuch
  - `0`
  - list `1`
