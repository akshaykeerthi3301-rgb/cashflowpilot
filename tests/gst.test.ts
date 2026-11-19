import { expect, test } from "vitest";
import { amountInWords, gstinCheckChar, isValidGstin, parseAmount, printAmount, wordsToMinor } from "@/deterministic/gst";

test("GSTIN check digit", () => {
  expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true); // widely published valid example
  expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false); // last char changed
  expect(isValidGstin("27AAPFU0939F1Z")).toBe(false);
  expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
});

test("amount in words, Indian and US, round-trips", () => {
  expect(amountInWords(12345678, "INR")).toBe("Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only");
  expect(amountInWords(1_00_00_000_00, "INR")).toBe("Rupees One Crore Only");
  expect(amountInWords(50, "INR")).toBe("Rupees Zero and Fifty Paise Only");
  expect(amountInWords(123456789, "USD")).toBe("US Dollars One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven and Eighty Nine Cents Only");
  for (const v of [50, 1_00_000_00, 12_34_567_89, 99_99_99_999, 7, 100]) {
    expect(wordsToMinor(amountInWords(v, "INR"))).toBe(v);
    expect(wordsToMinor(amountInWords(v, "USD"))).toBe(v);
  }
  expect(wordsToMinor("Rupees Banana Only")).toBeNull();
});

test("printed amounts", () => {
  expect(parseAmount("1,23,456.78")).toBe(12345678);
  expect(parseAmount("Rs. 40,710.00")).toBe(4071000);
  expect(parseAmount("-0.40")).toBe(-40);
  expect(parseAmount("12.5")).toBeNull();
  expect(printAmount(12345678, "INR")).toBe("1,23,456.78");
  expect(printAmount(-40, "INR")).toBe("-0.40");
});
