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

def apply_fmt_xcode_workaround!(installer)
  base_header_path = File.join(installer.sandbox.root.to_s, 'fmt', 'include', 'fmt', 'base.h')

  if File.exist?(base_header_path)
    header_source = File.read(base_header_path)
    override_marker = "#ifdef FMT_USE_CONSTEVAL\n// Use the provided definition.\n"
    detection_needle = "// Detect consteval, C++20 constexpr extensions and std::is_constant_evaluated.\n#if !defined(__cpp_lib_is_constant_evaluated)\n"

    unless header_source.include?(override_marker)
      unless header_source.include?(detection_needle)
        raise "Unable to locate fmt consteval detection block in #{base_header_path}"
      end

      header_source = header_source.sub(
        detection_needle,
        "// Detect consteval, C++20 constexpr extensions and std::is_constant_evaluated.\n#ifdef FMT_USE_CONSTEVAL\n// Use the provided definition.\n#elif !defined(__cpp_lib_is_constant_evaluated)\n"
      )

      File.write(base_header_path, header_source)
    end
  end

  installer.pods_project.targets.each do |target|
    next unless target.name == 'fmt'

    target.build_configurations.each do |config|
      definitions = config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
      definitions = [definitions] if definitions.is_a?(String)
      definitions = definitions.dup

      unless definitions.include?('FMT_USE_CONSTEVAL=0')
        definitions << 'FMT_USE_CONSTEVAL=0'
      end

      config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = definitions
    end
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
  const fmtWorkaroundLine = "    apply_fmt_xcode_workaround!(installer)\n";
  if (src.includes(assertionLine) && src.includes(fmtWorkaroundLine)) {
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

  let next = src.replace(
    reactNativePostInstallNeedle,
    `${reactNativePostInstallNeedle}\n${fmtWorkaroundLine}${assertionLine}`
  );

  if (!next.includes(fmtWorkaroundLine)) {
    throw new Error("Unable to inject fmt Xcode workaround into Podfile post_install block.");
  }

  return next;
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
