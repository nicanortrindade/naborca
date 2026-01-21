
import {
    calculateAdjustmentFactors,
    getAdjustedItemValues,
    getAdjustedBudgetTotals,
    GlobalAdjustmentV2
} from '../src/utils/globalAdjustment';

// Mock data
const mockItems: any[] = [
    { unitPrice: 100, quantity: 10, description: 'CIMENTO', type: 'material', level: 3 },
    { unitPrice: 200, quantity: 5, description: 'PEDREIRO', type: 'labor', level: 3 },
    { unitPrice: 50, quantity: 20, description: 'AREIA', type: 'material', level: 3 }
];
// Base = (100*10) + (200*5) + (50*20) = 1000 + 1000 + 1000 = 3000
// Material Base = 2000
// BDI = 20%
// Final Raw = 3000 * 1.2 = 3600

const bdi = 20;

function runTest(name: string, settings: GlobalAdjustmentV2 | null, expectedFinal: number) {
    console.log(`\n--- Test: ${name} ---`);
    const totals = getAdjustedBudgetTotals(mockItems, settings, bdi);
    console.log('Totals:', totals);

    // Check diff
    const diff = Math.abs(totals.totalFinal - expectedFinal);
    if (diff < 0.01) {
        console.log('PASS ✅');
    } else {
        console.error(`FAIL 🔴 Expected ${expectedFinal}, got ${totals.totalFinal}`);
        process.exit(1);
    }
}

// 1. Raw (No adjustment)
// Final = 3600
runTest('No Adjustment', null, 3600);

// 2. Percentage (+10%)
// Final = 3600 * 1.1 = 3960
runTest('Percentage +10%', { mode: 'global_all', kind: 'percentage', value: 10 }, 3960);

// 3. Fixed Target Total (4000)
// Final = 4000
runTest('Fixed Target 4000', { mode: 'global_all', kind: 'fixed_target_total', value: 4000 }, 4000);

// 4. Materials Only (+10%)
// Mat Base = 2000. Mat Adjusted Base = 2200.
// Labor Base = 1000. Labor Adjusted Base = 1000.
// Total Base = 3200.
// Final = 3200 * 1.2 = 3840.
runTest('Materials Only +10%', { mode: 'materials_only', kind: 'percentage', value: 10 }, 3840);

console.log('\nAudit Script Completed Successfully');
