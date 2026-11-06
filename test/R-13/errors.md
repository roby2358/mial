# inner
- x
- + x `true`
# outer
- x
- inner x
# caught
- error?
  - nosuch
# not-caught
- error?
  - `1`
# trace-arg
- + `1`
  - nosuch
# loop
- x
- error?
  - loop x
# spin
- x
- if `true`
  - error?
    - spin x
