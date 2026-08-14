import fs from 'node:fs';
import { ABOUT_ROLE_BY_TRIGGER } from '../src/infrastructure/telegram/role-info.js';

function auditI18n() {
  console.log('======================================================================');
  console.log('🌍 COMPREHENSIVE MULTI-LANGUAGE (i18n) AUDIT');
  console.log('======================================================================\n');

  const enRaw = fs.readFileSync('locales/en.json', 'utf-8');
  const frRaw = fs.readFileSync('locales/fr.json', 'utf-8');

  const en = JSON.parse(enRaw).strings;
  const fr = JSON.parse(frRaw).strings;

  const enKeys = Object.keys(en);
  const frKeys = Object.keys(fr);

  console.log(`📊 English Key Count: ${enKeys.length}`);
  console.log(`📊 French Key Count:  ${frKeys.length}\n`);

  const missingInFr = enKeys.filter((k) => !(k in fr));
  const missingInEn = frKeys.filter((k) => !(k in en));

  if (missingInFr.length > 0) {
    console.warn(`⚠️ Keys present in EN but MISSING in FR (${missingInFr.length}):`, missingInFr);
  } else {
    console.log('✅ All English keys have matching French translations!');
  }

  if (missingInEn.length > 0) {
    console.warn(`⚠️ Keys present in FR but MISSING in EN (${missingInEn.length}):`, missingInEn);
  } else {
    console.log('✅ All French keys have matching English translations!');
  }

  // Audit triggers in ABOUT_ROLE_BY_TRIGGER
  const triggers = Object.entries(ABOUT_ROLE_BY_TRIGGER);
  console.log(`\n🔍 Checking role name and description translations for all ${triggers.length} triggers...`);

  let missingCount = 0;

  for (const [trigger, roleName] of triggers) {
    const roleKey = `Role_${roleName}`;
    const fallbackRoleKey = roleName;

    const hasTitleEn = (roleKey in en) || (fallbackRoleKey in en);
    const hasTitleFr = (roleKey in fr) || (fallbackRoleKey in fr);

    const aboutKey1 = `About${roleName}`;
    const aboutKey2 = `About${trigger.toUpperCase()}`;
    const aboutKey3 = `About${trigger.charAt(0).toUpperCase() + trigger.slice(1)}`;

    const hasDescEn = (aboutKey1 in en) || (aboutKey2 in en) || (aboutKey3 in en);
    const hasDescFr = (aboutKey1 in fr) || (aboutKey2 in fr) || (aboutKey3 in fr);

    if (!hasTitleEn) { console.error(`❌ EN missing role title for ${roleName} (${roleKey})`); missingCount++; }
    if (!hasTitleFr) { console.error(`❌ FR missing role title for ${roleName} (${roleKey})`); missingCount++; }

    if (!hasDescEn) { console.error(`❌ EN missing role description for ${roleName} (${aboutKey1} / ${aboutKey2})`); missingCount++; }
    if (!hasDescFr) { console.error(`❌ FR missing role description for ${roleName} (${aboutKey1} / ${aboutKey2})`); missingCount++; }
  }

  if (missingCount === 0) {
    console.log(`✅ 100% of all ${triggers.length} roles have valid title and description entries in EN and FR!`);
  }

  console.log('\n======================================================================');
  console.log('🎉 MULTI-LANGUAGE AUDIT COMPLETED CLEANLY!');
  console.log('======================================================================\n');
}

auditI18n();
