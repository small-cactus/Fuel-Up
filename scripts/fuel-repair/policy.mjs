export const repairFiles = new Set([
  'src/services/fuel/core.js', 'src/services/fuel/stationData.js', 'src/services/fuel/priceValidation.js',
  'supabase/functions/_shared/core.mjs', 'supabase/functions/_shared/stationData.mjs',
  'supabase/functions/_shared/priceValidation.mjs', 'supabase/functions/_shared/gasPrices.mjs',
  'supabase/functions/gas-prices/index.ts',
]);
export function validateRepairPaths(paths) {
  if (!paths.length) throw new Error('Codex made no repair changes');
  for (const path of paths) {
    if (!repairFiles.has(path) && !/^tests\/gasRepair\.[a-zA-Z0-9_-]+\.test\.mjs$/.test(path)) {
      throw new Error(`Repair changed a protected file: ${path}`);
    }
  }
}
export function incidentCode(value) {
  return /^UPSTREAM_[A-Z0-9_]{1,80}$/.test(value) ? value : 'UPSTREAM_FAILURE';
}
export async function deployWithRollback({ deploy, verify, rollback }) {
  try { await deploy(); await verify(); }
  catch (error) {
    try { await rollback(); }
    catch (rollbackError) { throw new Error(`Deployment failed; rollback also failed: ${rollbackError.message}`, { cause: error }); }
    throw new Error(`Deployment failed; previous code redeployed: ${error.message}`);
  }
}
