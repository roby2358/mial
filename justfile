# All four libraries against the shared corpus.
test: test-js test-ts test-python test-rust

test-js:
    cd js && node --test test/

test-ts:
    cd ts && npm run check && npm test

test-python:
    cd python && uv run --extra dev pytest -q

test-rust:
    cd rust && cargo test --quiet

# Regenerate the R-33 golden matrix from js/mial.js. Review the diff.
cc-matrix:
    node tools/gen_matrix.js

# Measure JS stack headroom against DEPTH_LIMIT (D-11).
cc-depth:
    node tools/depth.js
