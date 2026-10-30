# Demo script (final review, about 10 minutes)

Start with `docker compose up` (or the manual steps in the README) on a fresh database: the seed creates the
demo data and the six Stock DNA scenarios (illustrative). All passwords are `Password123!`.

**Talking point:** "The audit log records what users did. Stock DNA records what happened to the goods: one
tamper-evident life story per lot, from birth at receipt to death by sale, expiry, damage or recall."

1. **Dashboard** (admin@example.com). Show the KPI cards and the three Stock DNA cards: alive lots, lots that
   died this month by cause, and value lost to expiry and damage this month.
2. **Glass-box reorder** (Purchase Orders → Why?). Every PO line shows its formulas with the real numbers.
3. **Stock DNA list.** Open *Stock DNA* in the sidebar. Switch to *Dead* and search `MLK-DNA-001`.
4. **The milk lot, born to dead in 6 days.** Open it and read the lifeline from top to bottom:
   - born: 500 packets from Initech at Bengaluru, PO and GRN linked;
   - decision note: redistribution plan with its numbers ("can sell 120 x 4 days = 480; holds 100; capacity 380");
   - transfer out and in: 380 packets to Chennai, 1 day in transit;
   - four sales on customer orders;
   - expire with 120 left;
   - write-off;
   - death: expired after about 6 days, shelf life used 100%, value lost ₹3,000.

   Point at the two life bars, the counters with the green invariant tick, and the journey strip (Bengaluru 6.1
   days → Chennai 3.5 days).
5. **Integrity.** Click *Verify integrity*: "Verified" means the per-lot chain and every audit anchor match.
   *Download certificate* gives the PDF with birth certificate, life record and death certificate. *Print label*
   shows the QR.
6. **Scan.** On the Scan page, type the DNA code from the label (or scan it). It opens the same lot. Typing a
   SKU with a batch number also resolves to the lot.
7. **Recall trace.** Stock DNA → *Run recall trace*, batch `BOX-RC-01`:
   - 1 lot, 2 warehouses reached (Bengaluru 200, Chennai 60);
   - 40 boxes shipped on order CO-DNA-R1;
   - 160 still alive.

   Back on the Stock page, a dispatch of batch BOX-RC-01 is refused: "cannot be picked: it is recalled".
8. **Quarantine and returns.** Open `THP-QC-01` (quarantine: Release or Reject buttons). Open `BAT-SO-01` (sold
   out). Its genealogy shows the child lot `BAT-SO-01-R1` created by a customer return, while the parent stays
   sealed.
9. **Tamper evidence (optional, admin shell).** Edit one gene directly in MongoDB, for example
   `db.dnaevents.updateOne({seq: 4}, {$set: {qtyMoved: 999}})`, then click *Verify integrity* on that lot. It
   reports "Broken at event 4". Rewriting the whole chain consistently still fails the audit anchor check.
10. **Decision modules.** Recovery Example A (200 transferred + 100 bought), Redistribution Example B (380 moved,
    120 left), and the Simulator. When an executed plan moves stock, the lot it draws from gains a decision
    note with the plan's numbers.

Close with *Stock DNA → Reconcile all lots* (admin): "All N lots reconcile". The genes, header counters and stock
slices agree.
