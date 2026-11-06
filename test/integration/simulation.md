# DECAY
- mial
  - record
    - food `0.15`
    - water `0.24`
# initial
- record `"tick"` `0` `"meters"`
  - record `"food"` `80` `"water"` `80`
# decay-meter
- * meters name
- put meters name
  - max `0`
    - -
      - get meters name
      - get
        - call DECAY
        - name
# step
- state
- put
  - put state `"tick"`
    - +
      - get state `"tick"`
      - `1`
  - `"meters"`
  - reduce decay-meter
    - get state `"meters"`
    - keys
      - call DECAY
# run-steps
- * state n
- if
  - <= n `0`
  - state
  - run-steps
    - step state
    - - n `1`
# go
- run-steps
  - call initial
  - `50`
# report
- state
- text
  - + `"tick "`
    - get state `"tick"`
  - map
    - lambda k
      - + k `": "`
        - round
          - get
            - get state `"meters"`
            - k
    - keys
      - get state `"meters"`
# main
- report
  - call go
