const { withXcodeProject, IOSConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Compile into the application's default Metal library, which SwiftUI loads.
// Keep the source outside generated ios/ so clean prebuilds preserve the effect.
module.exports = function withLaunchBubbleShader(config) {
    return withXcodeProject(config, next => {
        const project = next.modResults;
        const name = next.modRequest.projectName;
        for (const shader of ['LaunchBubble.metal', 'SkeletonMorph.metal']) {
            const filepath = `${name}/${shader}`;
            fs.copyFileSync(path.join(__dirname, 'ios', shader),
                path.join(next.modRequest.platformProjectRoot, filepath));
            if (!project.hasFile(filepath)) {
                const { uuid } = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName: name });
                IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
                    filepath, groupName: name, project, targetUuid: uuid,
                });
            }
            for (const file of Object.values(project.pbxFileReferenceSection())) {
                if (typeof file === 'object' && String(file.path).replaceAll('"', '') === filepath) {
                    file.lastKnownFileType = 'sourcecode.metal';
                }
            }
        }
        return next;
    });
};
