# Stock DNA specification

PART C: THE STOCK DNA SPECIFICATION
C.1 The idea in one paragraph

Every lot of stock gets a DNA record: an unforgeable, ordered life story. A lot is born when it enters the system (a purchase receipt, an opening balance, or a customer return). From then on, every change to it is a gene, a DNA event: it is put away, held for quality, moved between warehouses, reserved, picked first-expired-first-out, sold, counted, damaged, flagged for recall, or allowed to expire. Each gene is hash-chained to the one before it, so the history cannot be edited without detection. When the last unit leaves, or the remainder is disposed, the lot dies and its DNA is sealed with a cause of death and a lifespan. Managers can open any lot and see the whole life from birth to death, trace a recall forwards and backwards, and download a life certificate.

Why it is new for this project: the existing audit log (F6) is a system-wide log of actions. Stock DNA is a per-lot lifeline: it follows the goods, not the users, and it ties together receipt, FEFO, transfers, redistribution, recovery, counts and customer orders in one story.

C.2 Vocabulary
Term	Meaning
Lot	One received batch of one product from one source. The unit that carries DNA.
Slice	The part of a lot at one warehouse and bin right now. Slices are the existing StockLevel rows.
Gene	One DNA event. Append-only.
Lifeline	The ordered list of genes for a lot, from birth to death.
Genealogy	The parent and child links between lots (repack, merge, return).
Birth	The first gene of a lot.
Death	The terminal gene that seals the lot. After death no further gene can be added.
Alive	Quantity on hand plus in transit is greater than zero, or the lot is not yet sealed.
C.3 Data model (new collections; names are fixed so the UI and tests agree)
stocklots (the DNA header, one per lot)
Field	Type	Notes
dnaCode	string, unique	Human code, DNA-<SKU>-<YYMMDD>-<4-digit counter>. Counter from the existing counters collection.
product	ObjectId, ref products	
batchNo	string	Supplier or internal batch number.
supplier	ObjectId, ref suppliers	Optional for opening balances.
birth	object	{ type, at, warehouse, bin, qty, unitCost, refType, refId, grnNo, backfilled }. type is purchase_receipt, opening_balance or return_in.
manufactureDate, expiryDate	Date	Optional for non-perishables.
shelfLifeDays	number	Derived when both dates exist.
parentLots	[ObjectId]	For return, merge and repack.
status	enum	See C.4.
qtyBorn	number	Equals birth.qty.
qtyAdded	number	Positive count adjustments after birth.
qtyOnHand	number	Sum of slices. Maintained by the stock service.
qtyInTransit	number	Shipped, not yet received.
qtyOutByCause	object	{ sold, consumed, expired, damaged, shrinkage, recalled, returnedToSupplier, writtenOff }, each a number.
flags	object	{ onHold, recalled, backfilled }.
death	object or null	{ at, cause, lifespanDays, lifeUsedPct, valueLost, approvedBy, note }.
eventCount, headHash	number, string	Seq and hash of the last gene.
createdAt, updatedAt	Date	

Invariant (must hold after every event and is checked by reconcile): qtyBorn + qtyAdded = qtyOnHand + qtyInTransit + sum(qtyOutByCause).

Indexes: dnaCode (unique); { product, status }; { supplier, batchNo }; { expiryDate }; { "flags.recalled": 1 }; { status, "death.at": -1 }.

dnaevents (the genes, append-only, one chain per lot)
Field	Type	Notes
lot	ObjectId	
seq	number	1 for birth, then +1. Unique with lot.
type	enum	The catalogue in C.5.
at	Date	Event time (server time).
actor	ObjectId or null	Null for system events such as the expiry job.
actorRole	string	
warehouse, fromWarehouse, toWarehouse, bin	ObjectId / string	As relevant.
qtyDelta	number	Signed change to the lot's total quantity (0 for moves and flags).
qtyMoved	number	For moves, the quantity that moved.
qtyAfter	{ onHand, inTransit }	Lot totals after the event.
cause	string	For quantity-out and death events.
refType, refId	string, ObjectId	PO, transfer, customer order, recovery plan, redistribution plan, stock count, alert, recall. Store ids only, never customer personal data.
explanation	string	Human-readable reason. For engine-driven events, the real numbers (for example "Redistribution plan RP-12: Chennai can sell 120 x 4 days = 480; holds 100; capacity 380").
evidence	[string]	Optional image or document URLs from the storage adapter.
prevHash, hash	string	SHA-256 chain, section C.6.

Indexes: { lot: 1, seq: 1 } unique; { type: 1, at: -1 }; { refType: 1, refId: 1 }; { warehouse: 1, at: -1 }.

dnalinks (genealogy edges)

{ parentLot, childLot, relation ('return' | 'repack' | 'merge'), qty, at, eventId }. Index { parentLot: 1 } and { childLot: 1 }.

A partial transfer does not create a child lot. The lot stays one lot, spread over several slices. Child lots only arise from returns, repacking and merging.

C.4 Life states and allowed transitions

States: quarantine, active, expired, and the terminal (dead) states depleted, expired_disposed, written_off, recalled_destroyed, returned_to_supplier.

From	To	Trigger
(birth)	quarantine	Received with QC hold requested.
(birth)	active	Received and put away.
quarantine	active	QC released.
quarantine	written_off	QC rejected and disposed.
active	expired	Expiry date passed with quantity remaining (daily job or on demand).
active	depleted	Quantity on hand and in transit reaches 0 through sale or consumption.
expired	expired_disposed	Disposal approved.
active or quarantine	written_off	Damage or loss write-off approved.
any alive state	recalled_destroyed or returned_to_supplier	Recall flagged, then resolved by destroy or return.

Rules:

Dead states are terminal. No gene can be added to a dead lot. A customer return of a dead lot creates a new child lot (relation return) that links back to the parent. There is no resurrection.
expired lots are still alive but not sellable. FEFO and dispatch must skip them. They count toward expiry-waste until disposed.
A recalled lot is flagged (flags.recalled) and blocked from dispatch immediately, while it still has a normal alive state.
A transition not in this table must be rejected with a clear error.
C.5 Gene catalogue (event types)

Every type below has a required-fields rule and an effect on the lot counters. Implement it as a table in engines/dnaEngine and test each row.

Type	Meaning	Qty effect
born	Birth (purchase receipt, opening balance, return in).	Sets qtyBorn, qtyOnHand.
qc_hold, qc_release, qc_reject	Quality gate.	None (status and flag).
put_away	Assigned to a bin.	None.
transfer_out	Left a warehouse (transfer shipped).	onHand -= q, inTransit += q.
transfer_in	Arrived at a warehouse (transfer received).	inTransit -= q, onHand += q.
reserve, release_reserve	Allocated to a customer order.	None (a reservation flag with quantity).
pick_fefo	Picked by first-expired-first-out for an order or transfer.	None until dispatched.
dispatch_sale	Shipped to a customer.	onHand -= q, qtyOutByCause.sold += q.
consume	Used in production or internal use.	qtyOutByCause.consumed += q.
count_adjust	Cycle-count variance posted.	Negative: shrinkage. Positive: qtyAdded.
damage	Damaged or lost.	qtyOutByCause.damaged.
expiry_warning	System warning at the configured days before expiry.	None.
expire	Passed expiry with stock left.	Status to expired; no quantity change yet.
recall_flag, recall_clear	Recall raised or cleared by admin.	None (flag).
return_to_supplier	Sent back to the supplier.	qtyOutByCause.returnedToSupplier.
write_off	Disposal approved (expired, damaged, rejected, recalled).	onHand -= q, the matching qtyOutByCause.
decision_note	An approved engine decision touched this lot (rebalance, recovery, redistribution).	None. Carries the explanation with the numbers.
death	Terminal seal.	None. Written once, in the same transaction as the last quantity-out gene.

Death is derived and written automatically by the stock service: when onHand + inTransit reaches 0, or an approved disposal clears the remainder, the service appends the right terminal gene, sets status, and fills death (cause, lifespanDays, lifeUsedPct, valueLost = qty wasted x unitCost when the cause is expiry, damage, recall or write-off, 0 for a normal sale-out).

death.cause values: sold_out, consumed, expired, damaged, recalled, returned_to_supplier, rejected_at_qc, written_off.

C.6 Hash chain and anchoring
Per-lot chain: hash = SHA-256(prevHash + "|" + canonicalJSON(fields)), where fields is { lot, seq, type, at, actor, warehouse, fromWarehouse, toWarehouse, bin, qtyDelta, qtyMoved, qtyAfter, cause, refType, refId, explanation }. The first gene uses a genesis hash of 64 zeros. Reuse the repository's existing hashChain helper, and give it a scope argument so audit and DNA chains cannot be swapped.
Chains are per lot, so writes to different lots never block each other.
Anchoring: every DNA event also writes one audit-log entry (action dna.<type>) whose metadata holds the DNA event's hash. Verification checks both: the per-lot chain is intact, and each event hash matches the one anchored in the global audit chain. Tampering with a gene is detected by the lot chain, and tampering with the whole lot's chain is detected by the anchors.
Sequence numbers are assigned inside the transaction with an atomic update of stocklots.eventCount (findOneAndUpdate with the expected count) and retried on conflict, so two requests can never write the same seq.
verify(lot) returns { ok, eventsChecked, firstBrokenSeq, reason, anchoredOk }.
C.7 The one stock choke point

Create services/stockService (or extend the existing one). It exposes these functions, and only these may change quantities:

receiveLot, putAway, shipTransfer, receiveTransfer, reserve, releaseReserve, dispatchFefo, consume, postCountAdjustment, recordDamage, holdLot, releaseLot, rejectLot, flagRecall, clearRecall, disposeLot, returnToSupplier, acceptReturn (creates a child lot).

Each function, inside one transaction:

Validates the transition (C.4) and the quantities.
Updates the StockLevel slices.
Updates the lot header counters.
Appends the DNA gene with its hash.
Appends the audit entry that anchors it.
Writes death, if the lot just died.
After commit, emits the socket events.

Then refactor every existing caller to use the service: PO receipt, manual receive, dispatch, transfers, cycle-count posting, redistribution execution, recovery execution, customer-order shipping. A repo-wide search for direct writes to StockLevel quantities must return only the service. Add a test that fails if another file does it (a simple grep-based test is fine).

dispatchFefo picks lots by earliest expiryDate, skips lots that are expired, quarantine or flags.recalled, and writes one pick_fefo and one dispatch_sale gene per lot it draws from. Its explanation lists each lot and the quantity taken.

C.8 Computed values (pure functions in engines/dnaEngine, no database)

For a lot and a time now:

ageDays = now - birth.at.
lifeUsedPct = clamp((now - manufactureDate) / (expiryDate - manufactureDate), 0, 1) when both dates exist, otherwise null.
remainingShelfDays = expiryDate - now.
dwellByLocation: for each warehouse, total days the lot spent there, from the genes.
journey: the ordered list of warehouse hops with arrival time, departure time and transit time.
hops: number of transfers.
holdingCostAccrued = sum over slices of qty x unitCost x holdingRate x days / 365 (use the product's holding-cost setting; label it "estimated").
depletionPct = 1 - qtyOnHand / (qtyBorn + qtyAdded).
lifespanDays at death = death.at - birth.at.

Forward and backward trace:

Backward from a lot: supplier, PO, GRN number, receiving warehouse, and parent lots.
Forward from a lot (or from a supplier plus batch number): every warehouse that received any of it, every customer-order reference it was dispatched against, and every child lot. Use the genes' refType/refId and dnalinks. Return quantities at each step and the quantity still alive.

reconcile: compare, per lot, the genes' running totals, the header counters, and the sum of StockLevel slices. Return a list of drifted lots with the three numbers. A correct system returns an empty list.

C.9 API (prefix /api/dna, all routes need requireAuth)
Method and path	Roles	Purpose
GET /lots	all (supplier sees only own supplier's lots)	List with filters: product, warehouse, supplier, status, alive=true/false, expiringInDays, recalled, q (dnaCode or batchNo), plus page, limit (default 50).
GET /lots/:id	all	Header plus computed values (C.8).
GET /lots/:id/timeline	all	Genes in order, with duration since the previous gene. Customer references are ids only.
GET /lots/:id/genealogy	all	Nodes and edges up (ancestors) and down (descendants).
GET /lots/:id/journey	all	Location hops and dwell times.
GET /lookup?code=	all	Resolve a DNA code (scanned from a label) to a lot id.
POST /lots/:id/verify	admin, manager	Run verify and return the result.
POST /lots/:id/hold, /release	admin, manager	QC hold and release, with a required reason.
POST /lots/:id/reject	admin, manager	QC reject (creates a disposal request).
POST /lots/:id/recall	admin	Flag a recall with a reason. Blocks dispatch at once.
POST /lots/:id/recall/clear	admin	Clear the recall.
POST /lots/:id/dispose	manager requests, admin approves	Write-off with cause (expired, damaged, recalled, rejected_at_qc, written_off), quantity, reason and optional evidence.
POST /lots/:id/return-to-supplier	manager requests, admin approves	Send back.
GET /recall-trace?supplier=&product=&batchNo=	admin, manager	Forward and backward trace for every lot that matches, with quantities and the quantity still alive.
GET /lots/:id/certificate.pdf	admin, manager	Life certificate (C.11).
GET /stats	all	Alive and dead counts, deaths by cause, average lifespan, average life used at death, value lost by cause, expiring-soon count.
POST /reconcile	admin	Run reconcile across all lots.

Every write returns the updated lot header and the new gene. Every list is paginated and scoped by the caller's role and warehouse.

Sockets: after commit, emit dna:event to the room wh:<warehouseId> and the all room with { lotId, dnaCode, type, qtyAfter, at }. Emit dna:death when a lot dies and dna:recall when one is flagged.

Notifications (through the existing notification service): recall flagged (admin and managers), lot expired with stock left, lot died with value lost above a threshold, DNA verification failed.

C.10 Jobs and migration
Expiry job: runs daily and on demand (POST /api/dna/jobs/expiry, admin). For each alive lot with expiryDate in the past and stock left, append expire; for each lot within the configured warning days, append expiry_warning once. It must be idempotent: running it twice adds no duplicate genes.
Backfill: npm run dna:backfill creates a lot for every existing batch with stock, with a born gene of type opening_balance, backfilled: true, and the explanation "Backfilled from existing stock; true birth not recorded". Where the audit log or PO history shows the real receipt, use it for the birth time and source and set backfilled: false. Report how many lots were backfilled. The command is idempotent.
Old Product DNA: migrate any existing DNA events into the new collections if their meaning matches, otherwise archive them in a legacy_* collection and remove their code paths. Record what happened in docs/CHANGELOG_100.md.
C.11 Screens
Sidebar and entry points
A new sidebar item Stock DNA (after Stock). All roles see it; supplier sees own lots only.
The Stock page gets a "DNA" button on every row that opens the lot.
The Scan page: scanning a DNA label opens the lot's life summary with action buttons. Scanning a product QR plus a batch number resolves to the lot.
The Purchase Orders receive dialog shows the DNA codes just created.
Dashboard gets three cards: Alive lots, Died this month by cause (a small bar chart), Value lost to expiry and damage this month.
Insights, Redistribution, Recovery and Simulator: wherever a plan names a batch, show its DNA code as a link and, for executed plans, a decision_note gene is written.
Stock DNA list page

Table with columns: DNA code, product, batch, supplier, status badge, qty on hand, qty born, life used (small bar), expiry date, warehouse(s), last event. Filters: product, warehouse, supplier, status, Alive / Dead / All, expiring in N days, recalled only, and a search box. Buttons: Export CSV, Run recall trace, Scan label.

Lot detail page (the heart of the feature)
Header card: DNA code, product, batch, supplier, status badge, a QR of the DNA code (qrcode.react), and buttons: Print label, Download certificate, Verify integrity, and (by role and state) Hold, Release, Recall, Dispose, Return to supplier.
Life bars: "Shelf life used" (time) and "Stock used up" (quantity), each with its percentage and the remaining days or units.
Counters: born, on hand, in transit, and out by cause (sold, expired, damaged, shrinkage, recalled, returned, written off), plus a check mark if the invariant holds.
Lifeline: a vertical timeline from Born at the top to Death (or "Still alive") at the bottom. Each gene shows an icon by type, the time, the actor, the quantity change, the location move, the explanation, and the time since the previous gene. Genes linked to a PO, transfer, order, plan or count are links. Birth and death are visually distinct.
Journey: the warehouse hops as a horizontal strip with dwell days at each stop, and (when the Maps adapter is real) a map; with the mock driver show the strip only.
Genealogy: a small tree: parent lots above, this lot, child lots below, drawn with plain SVG.
Slices: a table of where the stock is right now (warehouse, bin, quantity).
Integrity badge: "Verified" or "Broken at event N", with the time of the last check.
Recall trace page

Inputs: supplier, product, batch number. Output: a table of every matching lot with its status, then for each lot a forward-trace summary: warehouses reached, quantity per warehouse, quantity dispatched against customer-order references, and quantity still on hand. A "Flag recall on all matching lots" button (admin) and a CSV export.

Life certificate (PDF, pdfkit)

Two-part document. Birth certificate: DNA code, product, batch, supplier, birth time, warehouse, quantity, expiry. Life record: the full gene list. For a dead lot, a Death certificate section: cause, date, lifespan, shelf life used, value lost. Footer: the head hash and a note "Verified on <date>" or "Not verified".

Label

A print-friendly page with the DNA QR, DNA code, product name, batch, expiry date and receiving date. Label size is selectable (small and large).

C.12 Tests for Stock DNA (all must pass)

Unit (no database), in tests/unit/dna*.test.js:

Every row of the gene catalogue applies the right counter effect.
The invariant qtyBorn + qtyAdded = onHand + inTransit + sum(out) holds after random valid sequences of 200 events (property-style test with a seeded random generator).
The transition table accepts every allowed move and rejects every other move.
The hash chain verifies; editing one field, deleting one event, reordering two events, and appending after death each fail with the right firstBrokenSeq.
lifeUsedPct, remainingShelfDays, dwellByLocation, journey and holdingCostAccrued on a fixed example.
Forward and backward trace on a fixed genealogy with a split into a return child lot.
FEFO picking skips expired, quarantined and recalled lots, and draws across two lots in the right order.

Integration (Supertest with a replica-set MongoDB): 8. PO receipt creates a lot with a born gene, an audit anchor, and a DNA code. 9. Receive, put away, transfer out, transfer in, dispatch to depletion: the lot dies with cause sold_out, the sealed death object is correct, and further events are rejected. 10. Partial transfer keeps one lot with two slices, and the counters match StockLevel. 11. Expiry job: a lot past expiry becomes expired, cannot be dispatched, and disposal kills it with cause expired and the correct valueLost. Running the job twice adds no duplicate gene. 12. Recall: flag a lot, dispatch is refused, the forward trace lists the warehouses and orders reached, clearing the recall allows dispatch again. 13. Customer return of a dead lot creates a child lot linked by dnalinks. 14. Cycle count with a shortfall posts count_adjust and shrinkage; with a surplus posts qtyAdded. 15. Executed redistribution and recovery plans append decision_note genes containing the plan numbers. 16. Tamper test: change one stored gene directly in the database; verify reports the exact firstBrokenSeq, and the anchor check reports the mismatch. 17. Concurrency: two simultaneous dispatches on the same lot both succeed or one fails cleanly; seq has no gaps and no duplicates. 18. RBAC: supplier sees only own lots and no customer references; staff cannot recall or dispose; manager can request disposal but not approve it. 19. reconcile returns an empty list after the whole scenario suite. 20. A static test proves no file outside the stock service writes StockLevel quantities.

C.13 Seed scenarios (illustrative data, labelled as such)

npm run seed (and npm run seed:dna) must create these named lots so every screen has something to show:

Milk, born to dead in 6 days: 500 packets received at Bengaluru with 6 days of shelf life. Put away, transferred (380 packets) to Chennai through an executed redistribution plan, sold through customer orders at Chennai, while the remaining 120 at Bengaluru expire and are written off. Shows birth, move, sales, expiry and death with value lost.
USB-C cable, long life: received at Chennai, several dispatches, a count adjustment, still alive.
A recalled lot: two warehouses hold it, one customer order was shipped from it; the recall flag blocks further dispatch and the trace shows where it went.
A quarantined lot waiting for QC release.
A depleted lot (sold out, death cause sold_out) and a return child lot linked to it.
A backfilled lot with the "true birth not recorded" note.
C.14 Acceptance checklist for Stock DNA
AC-DNA-1: every lot has a unique DNA code and a born gene.
AC-DNA-2: no stock quantity changes without a matching gene (checked by reconcile and the static test).
AC-DNA-3: a lot dies exactly once, with a cause, a lifespan and a value lost, and its DNA then rejects new genes.
AC-DNA-4: verify detects an edited, deleted or reordered gene and names the first broken event.
AC-DNA-5: every gene is anchored in the global audit chain, and the anchor check passes on untouched data.
AC-DNA-6: FEFO never draws from expired, quarantined or recalled lots.
AC-DNA-7: a recall trace shows every warehouse and order reference reached by a batch, and the quantity still alive.
AC-DNA-8: the lot page shows birth, every gene and death in order, with working links, the QR, both life bars and the integrity badge.
AC-DNA-9: the PDF life certificate downloads for alive and dead lots.
AC-DNA-10: supplier users see only their own lots, and no customer references.
AC-DNA-11: the seed creates the six scenarios and the milk lot shows its full born-to-dead story in the UI.
AC-DNA-12: no old "Product DNA" code path remains in parallel.
