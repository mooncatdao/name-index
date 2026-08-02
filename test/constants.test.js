import assert from "node:assert/strict";
import test from "node:test";

import {
  CAT_NAMED_EVENT,
  CHAIN_ID,
  MAX_RESCUE_ORDER,
  MIN_RESCUE_ORDER,
  MOONCAT_COUNT,
  MOONCAT_NAMING_ABI,
  MOONCAT_RESCUE_ADDRESS,
  NAMING_START_BLOCK
} from "../src/constants.js";

test("canonical MoonCat naming constants are stable", () => {
  assert.equal(CHAIN_ID, 1);
  assert.equal(
    MOONCAT_RESCUE_ADDRESS,
    "0x60cd862c9C687A9dE49aecdC3A99b74A4fc54aB6"
  );
  assert.equal(NAMING_START_BLOCK, 4_140_409n);
  assert.equal(MOONCAT_COUNT, 25_440);
  assert.equal(MIN_RESCUE_ORDER, 0);
  assert.equal(MAX_RESCUE_ORDER, 25_439);
});

test("naming ABI exposes CatNamed and catNames", () => {
  assert.equal(CAT_NAMED_EVENT.name, "CatNamed");
  assert.deepEqual(
    MOONCAT_NAMING_ABI.map((entry) => entry.name),
    ["CatNamed", "catNames"]
  );
});
