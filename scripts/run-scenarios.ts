import { ScenarioRunner } from '../src/infrastructure/testing/scenario-runner.js';

async function main() {
  console.log('🧪 Starting Automated Role & Game Mode Scenario Test Suite...\n');
  const runner = new ScenarioRunner();
  const results = await runner.runAllScenarios();

  let passedCount = 0;
  for (const res of results) {
    if (res.passed) {
      passedCount++;
      console.log(`✅ [PASS] ${res.name}`);
      console.log(`   └─ ${res.details}`);
    } else {
      console.log(`❌ [FAIL] ${res.name}`);
      console.log(`   └─ ERROR: ${res.details}`);
    }
  }

  console.log(`\n📊 Summary: ${passedCount}/${results.length} Scenarios Passed Successfully.`);
  if (passedCount === results.length) {
    console.log('🎉 All high-priority scenarios are 100% operational!');
    process.exit(0);
  } else {
    console.error('⚠️ Some scenarios failed.');
    process.exit(1);
  }
}

void main();
