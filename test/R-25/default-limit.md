# down
- n
- if
  - <= n `0`
  - `0`
  - down
    - - n `1`
# forever
- n
- forever n
# via-map
- n
- map
  - lambda x
    - via-map x
  - list n
# via-reduce
- n
- reduce
  - lambda
    - * a x
    - call via-reduce x
  - `0`
  - list n
