# adder
- n
- lambda x
  - + x n
# use-adder
- let
  - vars
    - f
      - adder `3`
  - f `4`
# capture
- x
- lambda y
  - x
# not-dynamic
- let
  - vars
    - f
      - capture `1`
    - x
      - `2`
  - f `0`
# multi
- let
  - vars
    - f
      - lambda
        - * a b
        - - a b
  - f `5` `3`
# zero
- let
  - vars
    - f
      - lambda *
        - `9`
  - call f
# bad
- lambda `1` `2`
# empty-body
- let
  - vars
    - f
      - lambda x
  - f `1`
