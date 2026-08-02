import assert from "node:assert/strict";
import test from "node:test";

import mapping from "../data/reference/cat-id-to-rescue-order.json" with {
  type: "json"
};
import {
  CAT_ID_MAP_COUNT,
  getCatId,
  getCatIdByRescueOrder,
  getRescueOrder,
  getRescueOrderByCatId,
  normalizeCatId
} from "../src/cat-id-map.js";

const CAT_ID_PATTERN = /^0x[0-9a-f]{10}$/;
const FIXTURES = [
  ["0x00d658d50b", 0],
  ["0x0057774705", 82],
  ["0xff00000ca7", 84],
  ["0x0076fe2589", 25_439]
];

test("mapping artifact is complete, ordered, and unique", () => {
  assert.equal(mapping.count, 25_440);
  assert.equal(CAT_ID_MAP_COUNT, 25_440);
  assert.equal(mapping.catIdsByRescueOrder.length, 25_440);
  assert.equal(Object.keys(mapping.rescueOrderByCatId).length, 25_440);

  const catIds = new Set(mapping.catIdsByRescueOrder);
  assert.equal(catIds.size, 25_440);

  for (let rescueOrder = 0; rescueOrder < 25_440; rescueOrder += 1) {
    const catId = mapping.catIdsByRescueOrder[rescueOrder];
    assert.match(catId, CAT_ID_PATTERN);
    assert.equal(mapping.rescueOrderByCatId[catId], rescueOrder);
  }
});

test("runtime helpers support both directions for every mapping entry", () => {
  for (let rescueOrder = 0; rescueOrder < 25_440; rescueOrder += 1) {
    const catId = getCatIdByRescueOrder(rescueOrder);
    assert.equal(getCatId(rescueOrder), catId);
    assert.equal(getRescueOrderByCatId(catId), rescueOrder);
    assert.equal(getRescueOrder(catId), rescueOrder);
  }
});

test("boundary values and verified fixtures round-trip", () => {
  assert.equal(getCatIdByRescueOrder(0), "0x00d658d50b");
  assert.equal(getCatIdByRescueOrder(25_439), "0x0076fe2589");

  for (const [catId, rescueOrder] of FIXTURES) {
    assert.equal(getRescueOrderByCatId(catId), rescueOrder);
    assert.equal(getCatIdByRescueOrder(rescueOrder), catId);
  }
});

test("CatID normalization accepts case and prefix variants", () => {
  assert.equal(normalizeCatId("0xFF00000CA7"), "0xff00000ca7");
  assert.equal(normalizeCatId("FF00000CA7"), "0xff00000ca7");
  assert.equal(getRescueOrderByCatId("0XFF00000CA7"), 84);
});

test("malformed and unknown CatIDs fail clearly", () => {
  for (const value of ["", "0x1234", "0x123456789g", "0x12345678901", null, 42]) {
    assert.throws(() => normalizeCatId(value), TypeError);
  }
  assert.throws(() => getRescueOrderByCatId("0x0000000000"), {
    name: "RangeError",
    message: "Unknown CatID: 0x0000000000"
  });
});

test("invalid rescue orders fail clearly", () => {
  for (const value of [-1, 25_440, 1.5, NaN, Infinity, "0", null]) {
    assert.throws(() => getCatIdByRescueOrder(value));
  }
});
