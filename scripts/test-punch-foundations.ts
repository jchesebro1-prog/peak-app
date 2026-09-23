import assert from "node:assert/strict";
import { defaultDashboardLayout, resolveDashboardLayout } from "../src/lib/dashboard-layout";
import { parseCatalog } from "../src/app/(app)/catalog/parse";
import { findMeetingLink } from "../src/lib/google/meeting-link";
import { parseMaterialCsv } from "../src/app/(app)/estimator/material-csv";
import { lineMarginOf } from "../src/app/(app)/estimator/pricing";

function testDashboardInheritance() {
  const company = defaultDashboardLayout();
  const resolved = resolveDashboardLayout(company, {
    hidden: ["catalog"],
    order: ["queue"],
  });
  assert.equal(resolved.widgets.find((w) => w.key === "catalog")?.visible, false);
  assert.equal(resolved.widgets[0]?.key, "queue");
  assert.equal(resolved.widgets.find((w) => w.key === "stats")?.visible, true);
}

function testDashboardInvalidOverrideFallsBack() {
  const company = defaultDashboardLayout();
  const resolved = resolveDashboardLayout(company, {
    version: 99,
    hidden: ["not-a-widget"],
    order: ["not-a-widget"],
  });
  assert.deepEqual(resolved, company);
}

function testCatalogMetadataColumns() {
  const parsed = parseCatalog(
    "SKU,Description,Category,Unit,List,Cost,Manufacturer,MFR P/N,MFR M/N,MAP\n" +
      "ETC-S4,Source Four,Fixtures,ea,100,60,ETC,7060A,7060A,95"
  );
  assert.equal(parsed.rows[0]?.mfr, "ETC");
  assert.equal(parsed.rows[0]?.manufacturerPartNumber, "7060A");
  assert.equal(parsed.rows[0]?.manufacturerModelNumber, "7060A");
  assert.equal(parsed.rows[0]?.mapPrice, 95);
}

testDashboardInheritance();
testDashboardInvalidOverrideFallsBack();
testCatalogMetadataColumns();
assert.equal(findMeetingLink("Room 2", "Join us at https://meet.google.com/abc-defg-hij."), "https://meet.google.com/abc-defg-hij");
assert.equal(findMeetingLink("https://example.com/not-a-meeting", "https://zoom.us/j/123"), "https://zoom.us/j/123");
assert.equal(findMeetingLink("In person", "No link here"), "");
const vendorCsv = parseMaterialCsv("description,MFR P/N,quantity,unit,amount\nCable,ETC-123,2,ea,100", { costOnly: true });
assert.equal(vendorCsv.items[0]?.manufacturerPartNumber, "ETC-123");
assert.equal(lineMarginOf(60, 100), 0.4);
console.log("punch foundations: 6 passed");
