const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PODFILE_SETUP_SNIPPET = `require 'fileutils'
project_root = File.expand_path('..', __dir__)
patch_script_path = File.join(project_root, 'scripts', 'apply-package-patches.sh')
generated_code_path = File.join(__dir__, 'build', 'generated')

unless system('sh', patch_script_path)
  raise "Required native patches did not apply cleanly."
end

FileUtils.rm_rf(generated_code_path)

def assert_progressive_blur_codegen!(ios_root)
  props_path = File.join(
    ios_root,
    'build',
    'generated',
    'ios',
    'ReactCodegen',
    'react',
    'renderer',
    'components',
    'ReactNativeBlurViewSpec',
    'Props.h'
  )

  unless File.exist?(props_path)
    raise "Missing generated ReactNativeBlurViewSpec props at #{props_path}"
  end

  props_source = File.read(props_path)
  required_tokens = %w[
    radialCenterX
    radialClearRadius
    revealTrigger
    startRadius
    featherStart
  ]
  missing_tokens = required_tokens.reject { |token| props_source.include?(token) }

  unless missing_tokens.empty?
    raise "ReactNativeBlurViewSpec is missing required native props: #{missing_tokens.join(', ')}"
  end
end
`;

function ensurePodfileSetup(src) {
  if (src.includes("assert_progressive_blur_codegen!")) {
    return src;
  }

  const requireJsonNeedle = "require 'json'\n";
  if (!src.includes(requireJsonNeedle)) {
    throw new Error("Unable to find Podfile JSON require to inject progressive blur setup.");
  }

  return src.replace(requireJsonNeedle, `${requireJsonNeedle}${PODFILE_SETUP_SNIPPET}\n`);
}

function ensurePostInstallAssertion(src) {
  const assertionLine = "    assert_progressive_blur_codegen!(__dir__)\n";
  if (src.includes(assertionLine)) {
    return src;
  }

  const reactNativePostInstallNeedle = `    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
`;

  if (!src.includes(reactNativePostInstallNeedle)) {
    throw new Error("Unable to find react_native_post_install block to inject progressive blur assertion.");
  }

  return src.replace(
    reactNativePostInstallNeedle,
    `${reactNativePostInstallNeedle}\n${assertionLine}`
  );
}

module.exports = function withProgressiveBlurNativeBuild(config) {
  return withDangerousMod(config, [
    'ios',
    async nextConfig => {
      const podfilePath = path.join(nextConfig.modRequest.platformProjectRoot, 'Podfile');
      let podfileSource = fs.readFileSync(podfilePath, 'utf8');

      podfileSource = ensurePodfileSetup(podfileSource);
      podfileSource = ensurePostInstallAssertion(podfileSource);

      fs.writeFileSync(podfilePath, podfileSource);
      return nextConfig;
    },
  ]);
};
