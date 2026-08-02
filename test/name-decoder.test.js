import assert from "node:assert/strict";
import test from "node:test";

import {
  BLANK_NAME,
  NAME_STATUS,
  REDACTED_CAT_ID,
  decodeMoonCatName
} from "../src/name-decoder.js";

function toBytes32(value) {
  const bytes = new TextEncoder().encode(value);
  assert.ok(bytes.length <= 32, "test fixture must fit in bytes32");
  const padded = new Uint8Array(32);
  padded.set(bytes);
  return `0x${Array.from(padded, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function fromBytes(bytes) {
  const padded = new Uint8Array(32);
  padded.set(bytes);
  return `0x${Array.from(padded, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

test("decodes ASCII, Unicode, emoji, and exact 32-byte text", () => {
  assert.deepEqual(decodeMoonCatName(toBytes32("mister moo")), {
    rawName: toBytes32("mister moo"),
    status: NAME_STATUS.TEXT,
    text: "mister moo"
  });
  assert.equal(decodeMoonCatName(toBytes32("猫 😺")).text, "猫 😺");
  assert.equal(decodeMoonCatName(toBytes32("a".repeat(32))).text, "a".repeat(32));
});

test("terminates at embedded null and distinguishes blank from leading null", () => {
  const embeddedNull = fromBytes([0x63, 0x61, 0x74, 0, 0xff, 0xff]);
  assert.deepEqual(decodeMoonCatName(embeddedNull), {
    rawName: embeddedNull,
    status: NAME_STATUS.TEXT,
    text: "cat"
  });
  assert.deepEqual(decodeMoonCatName(BLANK_NAME), {
    rawName: BLANK_NAME,
    status: NAME_STATUS.BLANK
  });
  assert.deepEqual(decodeMoonCatName(BLANK_NAME, { catId: REDACTED_CAT_ID }), {
    rawName: BLANK_NAME,
    status: NAME_STATUS.BLANK
  });
  const leadingNull = fromBytes([0, 0x63, 0x61, 0x74]);
  assert.deepEqual(decodeMoonCatName(leadingNull), {
    rawName: leadingNull,
    status: NAME_STATUS.LEADING_NULL
  });
});

test("retains invalid UTF-8 as a distinct status", () => {
  const invalidUtf8 = fromBytes([0xc3, 0x28]);
  assert.deepEqual(decodeMoonCatName(invalidUtf8), {
    rawName: invalidUtf8,
    status: NAME_STATUS.INVALID_UTF8
  });
});

test("applies the known redacted CatID override without losing rawName", () => {
  const sourceRawName = "0x4a657773646964392f3131000000000000000000000000000000000000000000";
  assert.deepEqual(decodeMoonCatName(sourceRawName, { catId: REDACTED_CAT_ID }), {
    rawName: sourceRawName,
    status: NAME_STATUS.REDACTED,
    text: "\ufffd"
  });
  assert.equal(decodeMoonCatName(sourceRawName).status, NAME_STATUS.TEXT);
  assert.equal(
    decodeMoonCatName(sourceRawName, {
      catId: "0x1234567890",
      redactedCatIds: new Set(["0X1234567890"])
    }).status,
    NAME_STATUS.REDACTED
  );
  assert.equal(
    decodeMoonCatName(sourceRawName, REDACTED_CAT_ID).status,
    NAME_STATUS.REDACTED
  );
});

test("rejects malformed bytes32 and CatID inputs", () => {
  for (const value of ["", "0x", "0x00", "0x" + "0".repeat(63), "0x" + "0".repeat(65), "0X" + "0".repeat(64), null, 42]) {
    assert.throws(() => decodeMoonCatName(value), TypeError);
  }
  assert.throws(
    () => decodeMoonCatName(toBytes32("cat"), { catId: "0x1234" }),
    TypeError
  );
  assert.throws(
    () => decodeMoonCatName(toBytes32("cat"), { redactedCatIds: ["0x1234"] }),
    TypeError
  );
});
