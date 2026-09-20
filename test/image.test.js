import test from "node:test";
import assert from "node:assert/strict";

import { sniffImage, IMAGE_TYPES, MAX_IMAGE_BYTES } from "../server/lib/image.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(4)]);
const SVG = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"><script/></svg>");
const XML = Buffer.from("<?xml version=\"1.0\"?><svg/>");
const GIF = Buffer.from("GIF89a\u0001\u0000\u0001\u0000");
const HTML = Buffer.from("<!doctype html><html></html>");

test("sniffs PNG", () => {
  assert.equal(sniffImage(PNG)?.type, IMAGE_TYPES.png);
});

test("sniffs JPEG", () => {
  assert.equal(sniffImage(JPEG)?.type, IMAGE_TYPES.jpeg);
});

test("sniffs WebP", () => {
  assert.equal(sniffImage(WEBP)?.type, IMAGE_TYPES.webp);
});

test("rejects SVG and XML documents", () => {
  assert.equal(sniffImage(SVG), null);
  assert.equal(sniffImage(XML), null);
});

test("rejects unknown and empty buffers", () => {
  assert.equal(sniffImage(GIF), null); // GIF is not in the accepted set
  assert.equal(sniffImage(HTML), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
  assert.equal(sniffImage(null), null);
  assert.equal(sniffImage(undefined), null);
});

test("requires the full WebP RIFF/WEBP marker", () => {
  assert.equal(sniffImage(Buffer.from("RIFFxxxxNOPE")), null);
});

test("the 2 MiB limit is exported", () => {
  assert.equal(MAX_IMAGE_BYTES, 2 * 1024 * 1024);
});
