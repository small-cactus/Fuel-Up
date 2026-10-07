const { withXcodeProject, withInfoPlist } = require('expo/config-plugins');
const path = require('node:path');
const { build } = require('../scripts/localization/buildResources.cjs');
const locales = ['en', 'es', 'zh-Hans', 'zh-Hant', 'fil', 'vi', 'fr'];
function configure(project, iosRoot) {
  build(path.join(iosRoot, 'FuelUp/Localization'));
  // Folder references preserve .lproj paths and copy the complete language set.
  const target = project.getFirstTarget().uuid;
  if (!project.pbxGroupByName('Resources')) {
    const group = project.addPbxGroup([], 'Resources');
    delete group.pbxGroup.path;
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
  }
  const resourceGroup = project.pbxGroupByName('Resources');
  if (resourceGroup.path === 'undefined') delete resourceGroup.path;
  for (const locale of locales) {
    project.addKnownRegion(locale);
    const resource = `FuelUp/Localization/${locale}.lproj`;
    if (!project.hasFile(resource)) project.addResourceFile(resource, { target, lastKnownFileType: 'folder', sourceTree: 'SOURCE_ROOT' });
  }
  for (const ref of Object.values(project.pbxFileReferenceSection())) {
    if (typeof ref === 'object' && String(ref.path).includes('FuelUp/Localization/')) {
      ref.sourceTree = 'SOURCE_ROOT';
      for (const key of Object.keys(ref)) if (ref[key] === undefined || ref[key] === 'undefined') delete ref[key];
    }
  }
  return project;
}
module.exports = function withFuelUpLocalization(config) {
  config = withInfoPlist(config, next => {
    next.modResults.CFBundleDevelopmentRegion = 'en';
    next.modResults.CFBundleLocalizations = locales;
    return next;
  });
  return withXcodeProject(config, next => {
    configure(next.modResults, next.modRequest.platformProjectRoot);
    return next;
  });
};
module.exports.configure = configure;
