import { test } from "@playwright/test";
for (const name of ["workflow 06: eligible internal prescription and atomic dispense","workflow 07: ineligible external prescription and print","workflow 08: preliminary/final medical reports and print approval","workflow 09: admission, bed conflict, print and discharge"]) test.skip(name, async()=>{});
