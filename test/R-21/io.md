# p
- print `"a"` `1` `true` `null`
# p-none
- call print
# p-list
- print
  - list `1` `2`
# p-tree
- print
  - mial
    - + `1`
      - g `2`
# p-sym
- print
  - mial
    - foo
# pm
- print-mial
  - mial
    - + `1`
      - g `"s"`
# pm-list
- print-mial
  - list `2` `3`
# pm-null
- print-mial `null`
# parse-it
- parse-mial `"# a"`
# parse-bad
- parse-mial `5`
# parse-lines
- parse-mial
  - text `"# f"` `"- + 1"` `"# g"`
