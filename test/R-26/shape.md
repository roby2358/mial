# no-field-name
- mial
  - record `1` `2`
# no-value
- mial
  - record
    - a
# two-values
- mial
  - record
    - a `1` `2`
# keys-bad
- keys
  - call no-field-name
# get-bad
- get
  - call no-value
  - `"a"`
# has-bad
- has?
  - call two-values
  - `"a"`
# put-bad
- put
  - call no-field-name
  - `"a"`
  - `1`
