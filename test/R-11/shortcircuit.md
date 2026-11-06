# and-guard
- x
- and
  - != x `null`
  - > x `1`
# and-all
- and `1` `"a"` `true`
# or-first
- or `0` `2` nosuch
# or-none
- or `0` `null` `false`
# and-stops
- and `false` nosuch
# and-err
- and nosuch
# or-err
- or nosuch
# no-log
- or `true`
  - print `"never"`
# as-value
- call and `1`
