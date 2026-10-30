/**
 * Static guard for AC-DNA-2 (C.12 test 20): no file outside services/stockService.ts may write StockLevel
 * quantities, so every quantity change has a matching DNA gene.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src');
const ALLOWED = path.join(SRC, 'services', 'stockService.ts');
const WRITE_METHODS = /StockLevel\s*\.\s*(create|insertMany|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|replaceOne|bulkWrite|deleteOne|deleteMany|findOneAndDelete|findByIdAndDelete)\s*\(/g;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** The text of a call starting at an index, up to its matching closing parenthesis. */
function callText(src: string, start: number): string {
  let depth = 0;
  for (let i = src.indexOf('(', start); i < src.length; i++) {
    if (src[i] === '(') depth++;
    if (src[i] === ')' && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** Lines that write StockLevel quantities in a source text. */
export function stockWriteViolations(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(WRITE_METHODS)) {
    const call = callText(src, m.index!);
    // creating or deleting stock lines always moves quantity; updates only when they touch the quantity field
    if (/create|insertMany|delete|Delete|replaceOne|bulkWrite/.test(m[1]) || /\bquantity\b/.test(call)) out.push(call.split('\n')[0]);
  }
  // quantity assignments on documents loaded from StockLevel and then saved
  for (const v of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*await\s+StockLevel\s*\.\s*find(?:One|ById)\b/g)) {
    for (const m of src.matchAll(new RegExp(`\\b${v[1]}\\.quantity\\s*(\\+|-)?=(?!=)`, 'g'))) out.push(m[0]);
  }
  return out;
}

describe('only the stock service writes StockLevel quantities', () => {
  it('the detector catches direct writes', () => {
    expect(stockWriteViolations(`await StockLevel.updateOne({ _id }, { $inc: { quantity: -5 } });`)).toHaveLength(1);
    expect(stockWriteViolations(`await DemandHistory.updateOne(f, { $inc: { quantity } });`)).toEqual([]);
    expect(stockWriteViolations(`const live = await StockLevel.findOne(f); live.quantity = 3; await live.save();`)).toEqual(['live.quantity =']);
    expect(stockWriteViolations(`await StockLevel.create({ product, quantity: 4 });`)).toHaveLength(1);
    expect(stockWriteViolations(`await StockLevel.updateMany({ product }, { reorderPoint: 5 });`)).toEqual([]);
  });

  it('no file under src/ except services/stockService.ts writes StockLevel quantities', () => {
    const offenders: string[] = [];
    for (const f of files(SRC)) {
      if (f === ALLOWED) continue;
      for (const v of stockWriteViolations(fs.readFileSync(f, 'utf8'))) offenders.push(`${path.relative(SRC, f)}: ${v}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the stock service itself does write them (the guard is not vacuous)', () => {
    expect(stockWriteViolations(fs.readFileSync(ALLOWED, 'utf8')).length).toBeGreaterThan(0);
  });
});
